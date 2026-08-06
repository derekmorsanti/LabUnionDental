// ============================================================================
// agenda.js — la hoja tipo Excel de cada agenda: render, interacción de
// casillas (clic = X, doble clic = número), cálculo de puntos en tiempo
// real, columnas dinámicas, filas, guardado y descarga.
//
// ----------------------------------------------------------------------------
// INSTANCIAS AM/PM
// ----------------------------------------------------------------------------
// La mayoría de agendas (Eliu, Abner, Dina, Astryd) se renderizan como una
// sola "instancia" — igual que antes. La agenda de Cony (config.splitAmPm)
// se renderiza como DOS instancias independientes, 'am' y 'pm', una junto a
// la otra (ver .agenda-split-grid en css/styles.css).
//
// Cada instancia tiene:
//   - su propio estado en memoria (panels[key])
//   - sus propios elementos del DOM, generados dinámicamente con ids
//     sufijados ("-am" / "-pm"); las agendas sin split usan key='' y por
//     lo tanto los MISMOS ids que existían antes (agenda-table,
//     agenda-thead, btn-save-agenda, etc.), así que su comportamiento no
//     cambió en absoluto.
//   - su propio documento en Firestore: se reutiliza EXACTAMENTE la misma
//     colección/estructura de siempre (users/{uid}/agendas/{agendaId}_{dateKey}),
//     sólo que para Cony la dateKey lleva un sufijo "-AM" / "-PM"
//     (p. ej. "2026-08-01-AM" y "2026-08-01-PM"). El campo agendaId
//     guardado dentro del documento sigue siendo 'cony' en ambos casos,
//     así que Historial sigue encontrando y listando las dos tandas de
//     cada día sin ningún cambio en data-store.js.
//   - sus propias columnas dinámicas (+/-): se guardan bajo un id de
//     almacenamiento propio ('cony-am' / 'cony-pm') en la colección
//     agendaConfigs, para que agregar una columna en AM no la agregue
//     también en PM.
//   - su propio debounce de autoguardado, para que escribir en una tabla
//     nunca dispare ni interfiera con el guardado de la otra.
// ============================================================================

import {
  getAgendaConfig, getAllPointColumns, computeRowTotal, computeGrandTotal,
  computeColumnSum, defaultRow, cellUnits, FALLBACK_POINT_VALUE
} from './agenda-configs.js?v12';
import { getCurrentUser } from './auth.js?v12';
import {
  getAgendaDay, autosaveAgendaDay, saveAgendaDay,
  getAgendaExtraColumns, saveAgendaExtraColumns
} from './data-store.js?v12';
import {
  dateKeyToday, formatAgendaHeaderDate, debounce, escapeHtml, toNumber, generateId, round2,
  fetchWithRetry, describeFirestoreError
} from './utils.js?v12';
import { openModal, closeModal, showToast, openDownloadModal } from './ui-helpers.js?v12';
import { captureElementToImage } from './export.js?v12';

// ----------------------------------------------------------------------------
// Botón "AGREGAR" por fila: crea una fila nueva en OTRA agenda (Yesos,
// Metales, Tallado, Encerado o Pretallado), copiando SOLO doctor/paciente,
// descripción y unidad. No requiere que la agenda destino esté abierta —
// escribe directamente en su documento del día en Firestore, reutilizando
// exactamente el mismo esquema que usa el resto de la app.
// ----------------------------------------------------------------------------
const AGREGAR_TARGETS = [
  { label: 'Yesos', agendaId: 'cony' },
  { label: 'Metales', agendaId: 'abner' },
  { label: 'Tallado', agendaId: 'astryd' },
  { label: 'Encerado', agendaId: 'dina' },
  { label: 'Pretallado', agendaId: 'eliu' }
];

const DEFAULT_ROW_COUNT = 12;

// Estado de cada instancia visible actualmente, indexado por key ('' cuando
// la agenda no está dividida; 'am' / 'pm' cuando sí lo está).
let panels = {};
// Contador de "token" de carga POR instancia — evita que una respuesta
// tardía de red (p. ej. al reintentar tras un error, o si el usuario
// navega rápido entre agendas) sobrescriba datos más nuevos ya en
// pantalla. Cada instancia tiene su propio contador para que un
// reintento en AM nunca invalide lo que ya está cargado en PM.
let instTokens = {};
// Funciones de autoguardado (debounced), una por instancia — así el
// guardado automático de AM y PM nunca comparten temporizador.
let autosaveFns = {};

function nextToken(key) {
  instTokens[key] = (instTokens[key] || 0) + 1;
  return instTokens[key];
}

/** Definición de instancias a renderizar según la config de la agenda. */
function getInstances(config) {
  if (config.splitAmPm) {
    return [
      { key: 'am', label: 'AM' },
      { key: 'pm', label: 'PM' }
    ];
  }
  return [{ key: '', label: '' }];
}

/** Sufijo de id para una key de instancia ('' → sin sufijo, igual que antes). */
function suf(key) { return key ? `-${key}` : ''; }
/** Construye el id completo de un elemento para una instancia dada. */
function eid(base, key) { return `${base}${suf(key)}`; }
/** getElementById ya resuelto contra la instancia. */
function g(base, key) { return document.getElementById(eid(base, key)); }

function showLoadWarning(message, key) {
  const el = g('agenda-load-warning', key);
  if (!el) return;
  el.innerHTML = `
    <div style="background:var(--rust-wash);color:var(--rust);border-radius:8px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13.5px;">
      <span>${escapeHtml(message)}</span>
      <button class="btn btn-sm btn-outline" id="${eid('agenda-retry-load', key)}" style="flex-shrink:0;">Reintentar</button>
    </div>`;
  el.classList.remove('hidden');
  const retryBtn = g('agenda-retry-load', key);
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      const p = panels[key];
      if (!p) return;
      loadInstance(p.config, p.agendaId, p.uid, p.baseDateKey, { key: key || null, label: p.label || null });
    });
  }
}

function hideLoadWarning(key) {
  const el = g('agenda-load-warning', key);
  if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
}

// ----------------------------------------------------------------------------
// Construcción del DOM (uno o dos paneles, según la agenda)
// ----------------------------------------------------------------------------
function panelHtml(config, inst) {
  const key = inst.key || '';
  const labelBadge = inst.label ? ` <span class="agenda-panel-label">${escapeHtml(inst.label)}</span>` : '';
  return `
    <div class="agenda-panel" data-instance="${escapeHtml(key)}">
      <div class="agenda-header-bar">
        <div class="agenda-title-block">
          <h2 id="${eid('agenda-title', key)}">${escapeHtml(config.personName)} — ${escapeHtml(config.processName)}${labelBadge}</h2>
          <div class="agenda-subtitle" id="${eid('agenda-subtitle', key)}">—</div>
        </div>
        <div class="agenda-toolbar">
          <div class="agenda-points-badge hidden" id="${eid('agenda-points-badge', key)}">0 <span>pts</span></div>
          <button class="btn btn-icon" id="${eid('btn-add-col', key)}" title="Agregar columna">+</button>
          <button class="btn btn-icon" id="${eid('btn-remove-col', key)}" title="Eliminar última columna">−</button>
          <button class="btn btn-outline btn-sm" id="${eid('btn-download-agenda', key)}">Descargar</button>
          <button class="btn btn-brass btn-sm" id="${eid('btn-save-agenda', key)}">Guardar</button>
        </div>
      </div>

      <div id="${eid('agenda-load-warning', key)}" class="hidden" style="margin-bottom:14px;"></div>

      <div class="table-scroll">
        <table class="agenda-table" id="${eid('agenda-table', key)}">
          <thead id="${eid('agenda-thead', key)}"></thead>
          <tbody id="${eid('agenda-tbody', key)}"></tbody>
          <tfoot id="${eid('agenda-tfoot', key)}"></tfoot>
        </table>
      </div>

      <div class="agenda-footer-bar">
        <button class="btn btn-ghost btn-sm add-row-btn" id="${eid('btn-add-row', key)}">+ Agregar fila</button>
        <span class="save-status" id="${eid('agenda-save-status', key)}"></span>
      </div>
    </div>`;
}

function buildContainer(config, instances) {
  const container = document.getElementById('agenda-container');
  if (!container) return;
  if (instances.length > 1) {
    container.innerHTML = `<div class="agenda-split-grid">${instances.map(i => panelHtml(config, i)).join('')}</div>`;
  } else {
    container.innerHTML = panelHtml(config, instances[0]);
  }
}

// ----------------------------------------------------------------------------
// Entrada principal
// ----------------------------------------------------------------------------
export async function renderAgenda(agendaId, navigate, dateKeyOverride) {
  const config = getAgendaConfig(agendaId);
  if (!config) return;

  // dateKeyOverride puede venir de Historial con sufijo "-AM"/"-PM"
  // (p. ej. "2026-08-01-AM"). La dateKey base siempre son los primeros
  // 10 caracteres ("AAAA-MM-DD"); a partir de ahí cada instancia arma su
  // propia dateKey completa.
  const baseDateKey = dateKeyOverride ? dateKeyOverride.slice(0, 10) : dateKeyToday();

  const currentUser = getCurrentUser();
  if (!currentUser) {
    showToast('Tu sesión no está activa. Vuelve a iniciar sesión.', true);
    return;
  }
  const uid = currentUser.uid;

  const instances = getInstances(config);

  // Estado limpio para esta agenda (se descarta cualquier panel de la
  // agenda anterior que estuviera en memoria).
  panels = {};
  instTokens = {};

  buildContainer(config, instances);

  // Cada instancia carga y se pinta de forma totalmente independiente;
  // un error en AM no bloquea ni afecta la carga de PM (o viceversa).
  await Promise.all(instances.map(inst => loadInstance(config, agendaId, uid, baseDateKey, inst)));
}

async function loadInstance(config, agendaId, uid, baseDateKey, inst) {
  const key = inst.key || '';
  const label = inst.label || '';
  const myToken = nextToken(key);

  // dateKey real en Firestore para esta instancia: sin cambios para
  // agendas normales; con sufijo "-AM"/"-PM" para las divididas.
  const dateKey = label ? `${baseDateKey}-${label}` : baseDateKey;
  // Id de almacenamiento para las columnas dinámicas (+/-) de esta
  // instancia: independiente entre AM y PM, sin tocar data-store.js.
  const storageAgendaId = key ? `${agendaId}-${key}` : agendaId;

  const subtitleEl = g('agenda-subtitle', key);
  if (subtitleEl) subtitleEl.textContent = 'Cargando…';
  hideLoadWarning(key);

  let existing = null;
  let loadError = null;
  try {
    existing = await fetchWithRetry(() => getAgendaDay(uid, agendaId, dateKey), { label: 'cargar agenda' });
  } catch (e) {
    loadError = e;
    console.error(`Error al cargar agenda (${agendaId}${suf(key)}):`, e);
  }

  // Si mientras esto cargaba el usuario ya navegó a otra agenda, o se
  // disparó otro reintento de ESTA MISMA instancia, no pintar esta
  // respuesta tardía encima de lo que ahora está en pantalla.
  if (instTokens[key] !== myToken) return;

  let rows, extraColumns, meta;
  if (existing) {
    rows = (existing.rows && existing.rows.length) ? existing.rows : [defaultRow()];
    extraColumns = existing.extraColumns || [];
    meta = existing.meta || {};
  } else {
    extraColumns = [];
    if (!loadError) {
      try {
        extraColumns = await fetchWithRetry(() => getAgendaExtraColumns(uid, storageAgendaId), { label: 'columnas' });
      } catch (e) {
        extraColumns = [];
      }
      if (instTokens[key] !== myToken) return;
    }
    rows = Array.from({ length: DEFAULT_ROW_COUNT }, () => defaultRow());
    meta = {};
  }

  const [yy, mm, dd] = baseDateKey.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('es-GT', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(yy, mm - 1, dd)));
  const labelSuffix = label ? ` · ${label}` : '';
  if (subtitleEl) {
    subtitleEl.textContent =
      `${formatAgendaHeaderDate({ day: dd, month: mm }, weekday)} ${config.processName.toUpperCase()}${labelSuffix}`;
  }

  panels[key] = {
    key, label, agendaId, storageAgendaId, config,
    dateKey, baseDateKey, uid, rows, extraColumns, meta
  };

  renderTable(key);
  wireToolbar(key);

  if (loadError) {
    const msg = `No se pudieron cargar los datos guardados de esta agenda — esto NO significa que se hayan borrado. ${describeFirestoreError(loadError)}`;
    showToast(msg, true);
    showLoadWarning(msg, key);
  }
}

// ----------------------------------------------------------------------------
// Construcción de columnas
// ----------------------------------------------------------------------------
function buildColumnList(key) {
  const state = panels[key];
  const cols = [...state.config.leadingColumns];
  if (state.config.hasPoints) {
    cols.push(...state.config.pointColumns);
    if (state.config.extraColumn) cols.push(state.config.extraColumn);
    state.extraColumns.forEach(dc => cols.push({ ...dc, kind: dc.kind || 'point', removable: true }));
  } else {
    state.extraColumns.forEach(dc => cols.push({ ...dc, kind: dc.kind || 'text', removable: true }));
  }
  return cols;
}

// ----------------------------------------------------------------------------
// Render completo (encabezado + cuerpo + pie) de UNA instancia
// ----------------------------------------------------------------------------
function renderTable(key) {
  const state = panels[key];
  if (!state) return;
  const cols = buildColumnList(key);
  const thead = g('agenda-thead', key);
  const headCells = cols.map(c => {
    if (c.kind === 'text') {
      const cls = c.id === 'doctor' ? 'col-doctor' : 'col-desc';
      return `<th class="${cls}">${escapeHtml(c.label)}</th>`;
    }
    const weightLabel = c.kind === 'point-extra-eliu'
      ? '(× UNIDAD)'
      : `(${(c.weight != null ? c.weight : FALLBACK_POINT_VALUE)})`;
    return `<th>${escapeHtml(c.label)}<span class="col-weight">${weightLabel}</span></th>`;
  }).join('');
  const totalTh = state.config.hasPoints ? `<th class="col-total">${escapeHtml(state.config.totalLabel)}</th>` : '';
  thead.innerHTML = `<tr>${headCells}${totalTh}<th class="row-actions-col"></th></tr>`;

  renderBody(key);
  renderFooter(key);
  updatePointsBadge(key);
}

function renderBody(key) {
  const state = panels[key];
  if (!state) return;
  const cols = buildColumnList(key);
  const tbody = g('agenda-tbody', key);

  tbody.innerHTML = state.rows.map(row => {
    const tds = cols.map(c => {
      const val = (row.cells[c.id] !== undefined && row.cells[c.id] !== null) ? row.cells[c.id] : '';
      if (c.kind === 'text') {
        const cls = c.id === 'doctor' ? 'col-doctor' : 'col-desc';
        return `<td class="${cls}"><input class="cell-text" type="text" value="${escapeHtml(val)}" data-row="${row.id}" data-col="${c.id}"></td>`;
      }
      const isMarked = val === 'X';
      const hasNumber = val !== '' && val !== 'X';
      const cls = ['cell-point', isMarked ? 'marked' : '', hasNumber ? 'has-number' : ''].filter(Boolean).join(' ');
      const display = isMarked ? '<span class="mark-x">X</span>' : (hasNumber ? escapeHtml(String(val)) : '');
      return `<td class="${cls}" data-row="${row.id}" data-col="${c.id}">${display}</td>`;
    }).join('');

    const totalTd = state.config.hasPoints
      ? `<td class="cell-total">${round2(computeRowTotal(state.config, row, state.extraColumns)).toFixed(2)}</td>`
      : '';

    return `<tr>${tds}${totalTd}<td class="row-actions-col"><button class="row-agregar-btn" data-agregar="${row.id}" title="Agregar a otra agenda">→</button><button class="row-delete-btn" data-delrow="${row.id}" title="Eliminar fila">✕</button></td></tr>`;
  }).join('');

  wireBodyEvents(key);
}

function renderFooter(key) {
  const state = panels[key];
  if (!state) return;
  const cols = buildColumnList(key);
  const tfoot = g('agenda-tfoot', key);

  let totalCells = '';
  cols.forEach((c, i) => {
    if (i === 0) totalCells += `<td class="foot-label">Total</td>`;
    else if (c.kind === 'text' && c.summedInFooter) totalCells += `<td>${round2(computeColumnSum(state.rows, c.id))}</td>`;
    else totalCells += `<td></td>`;
  });
  const grandTotalTd = state.config.hasPoints
    ? `<td>${round2(computeGrandTotal(state.config, state.rows, state.extraColumns)).toFixed(2)}</td>`
    : '';
  let html = `<tr>${totalCells}${grandTotalTd}<td></td></tr>`;

  if (!state.config.hasPoints) {
    let diffCells = '';
    cols.forEach((c, i) => {
      if (i === 0) {
        diffCells += `<td class="foot-label">Diferencia</td>`;
      } else if (c.kind === 'text' && c.summedInFooter) {
        const sum = computeColumnSum(state.rows, c.id);
        const meta = toNumber(state.meta[c.id]);
        diffCells += `<td>${round2(sum - meta)} <input type="number" class="meta-input" data-metacol="${c.id}" value="${meta}" title="Meta del día"></td>`;
      } else {
        diffCells += `<td></td>`;
      }
    });
    html += `<tr class="row-diff">${diffCells}<td></td></tr>`;
  }

  tfoot.innerHTML = html;

  if (!state.config.hasPoints) {
    tfoot.querySelectorAll('[data-metacol]').forEach(inp => {
      inp.addEventListener('change', (e) => {
        state.meta[e.target.dataset.metacol] = e.target.value;
        renderFooter(key);
        scheduleAutosave(key);
      });
    });
  }
}

function updatePointsBadge(key) {
  const state = panels[key];
  if (!state) return;
  const badge = g('agenda-points-badge', key);
  if (!badge) return;
  if (!state.config.hasPoints) { badge.classList.add('hidden'); return; }
  badge.classList.remove('hidden');
  const gt = round2(computeGrandTotal(state.config, state.rows, state.extraColumns));
  badge.innerHTML = `${gt.toFixed(2)} <span>pts</span>`;
}

// ----------------------------------------------------------------------------
// Interacción de celdas (todo escoteado a la instancia `key`)
// ----------------------------------------------------------------------------
function wireBodyEvents(key) {
  const tbody = g('agenda-tbody', key);
  if (!tbody) return;

  tbody.querySelectorAll('.cell-text').forEach(input => {
    input.addEventListener('input', (e) => {
      const state = panels[key];
      if (!state) return;
      const row = state.rows.find(r => r.id === e.target.dataset.row);
      if (!row) return;
      row.cells[e.target.dataset.col] = e.target.value;
      refreshTotalsOnly(key);
      scheduleAutosave(key);
    });
  });

  tbody.querySelectorAll('td.cell-point').forEach(td => {
    td.addEventListener('click', () => handlePointClick(key, td));
    td.addEventListener('dblclick', (e) => { e.preventDefault(); handlePointDblClick(key, td); });
  });

  tbody.querySelectorAll('[data-agregar]').forEach(btn => {
    btn.addEventListener('click', () => openAgregarModal(key, btn.dataset.agregar));
  });

  tbody.querySelectorAll('[data-delrow]').forEach(btn => {
    btn.addEventListener('click', () => {
      const state = panels[key];
      if (!state) return;
      if (state.rows.length <= 1) { showToast('Debe quedar al menos una fila', true); return; }
      if (!confirm('¿Eliminar esta fila?')) return;
      state.rows = state.rows.filter(r => r.id !== btn.dataset.delrow);
      renderBody(key); renderFooter(key); updatePointsBadge(key); scheduleAutosave(key);
    });
  });
}

function refreshTotalsOnly(key) {
  const state = panels[key];
  if (!state) return;
  if (state.config.hasPoints) {
    const trs = document.querySelectorAll(`#${eid('agenda-tbody', key)} tr`);
    trs.forEach((tr, idx) => {
      const row = state.rows[idx];
      if (!row) return;
      const cell = tr.querySelector('td.cell-total');
      if (cell) cell.textContent = round2(computeRowTotal(state.config, row, state.extraColumns)).toFixed(2);
    });
  }
  renderFooter(key);
  updatePointsBadge(key);
}

function handlePointClick(key, td) {
  const state = panels[key];
  if (!state) return;
  const row = state.rows.find(r => r.id === td.dataset.row);
  if (!row) return;
  const cur = row.cells[td.dataset.col];
  row.cells[td.dataset.col] = (cur === 'X') ? '' : 'X';
  renderBody(key); renderFooter(key); updatePointsBadge(key); scheduleAutosave(key);
}

function handlePointDblClick(key, td) {
  const state = panels[key];
  if (!state) return;
  const row = state.rows.find(r => r.id === td.dataset.row);
  if (!row) return;
  const current = row.cells[td.dataset.col];
  const currentNum = (current && current !== 'X') ? current : '';

  const box = openModal(`
    <h3>Ingresar cantidad</h3>
    <p>Número de unidades completadas en esta casilla.</p>
    <div class="field">
      <input type="number" id="cell-number-input" min="0" step="0.01"
        value="${escapeHtml(currentNum)}"
        style="width:100%;padding:11px 13px;border:1.5px solid var(--line-strong);border-radius:8px;">
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="cell-number-clear">Borrar</button>
      <button class="btn btn-brass" id="cell-number-save">Guardar</button>
    </div>
  `);
  const input = box.querySelector('#cell-number-input');
  input.focus(); input.select();

  const commit = (val) => {
    row.cells[td.dataset.col] = val;
    closeModal();
    renderBody(key); renderFooter(key); updatePointsBadge(key); scheduleAutosave(key);
  };
  box.querySelector('#cell-number-save').addEventListener('click', () => commit(input.value.trim()));
  box.querySelector('#cell-number-clear').addEventListener('click', () => commit(''));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(input.value.trim()); });
}

// ----------------------------------------------------------------------------
// Modal "AGREGAR": elegir a qué agenda enviar una copia de esta fila
// ----------------------------------------------------------------------------
function extractRowLeadValues(state, row) {
  const doctor = row.cells['doctor'] || '';
  const desc = row.cells['desc'] || '';
  let unidad = '';
  for (const key of ['unidad', 'unid', 'cant']) {
    if (row.cells[key] !== undefined && row.cells[key] !== '') { unidad = row.cells[key]; break; }
  }
  return { doctor, desc, unidad };
}

function openAgregarModal(key, rowId) {
  const state = panels[key];
  if (!state) return;
  const row = state.rows.find(r => r.id === rowId);
  if (!row) return;
  const values = extractRowLeadValues(state, row);

  const box = openModal(`
    <h3>Agregar a otra agenda</h3>
    <p>Se creará una fila nueva con doctor/paciente, descripción y unidad. Los demás campos quedan vacíos para editar ahí.</p>
    <div class="modal-actions" style="flex-wrap:wrap;justify-content:center;">
      ${AGREGAR_TARGETS.map(t => `<button class="btn btn-outline" data-target="${t.agendaId}">${escapeHtml(t.label)}</button>`).join('')}
    </div>
  `);
  box.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', async () => {
      closeModal();
      try {
        await addRowToOtherAgenda(state.uid, btn.dataset.target, values);
        const target = AGREGAR_TARGETS.find(t => t.agendaId === btn.dataset.target);
        showToast(`Fila agregada a la agenda de ${target ? target.label : btn.dataset.target}`);
      } catch (e) {
        console.error('Error al agregar fila a otra agenda:', e);
        showToast(describeFirestoreError(e), true);
      }
    });
  });
}

/** Crea una fila nueva en la agenda destino (hoy), sin necesidad de tenerla abierta. */
async function addRowToOtherAgenda(uid, targetAgendaId, values) {
  const targetConfig = getAgendaConfig(targetAgendaId);
  if (!targetConfig) return;

  const baseDateKey = dateKeyToday();
  // Cony está dividida en AM/PM: la fila nueva se agrega a la tanda AM por defecto.
  const dateKey = targetConfig.splitAmPm ? `${baseDateKey}-AM` : baseDateKey;

  const existing = await fetchWithRetry(() => getAgendaDay(uid, targetAgendaId, dateKey), { retries: 1, label: 'agregar fila' });
  const rows = (existing && existing.rows) ? [...existing.rows] : [];
  const extraColumns = (existing && existing.extraColumns) || [];
  const meta = (existing && existing.meta) || {};

  const newRow = defaultRow();
  const leadIds = targetConfig.leadingColumns.map(c => c.id);
  if (leadIds.includes('doctor')) newRow.cells['doctor'] = values.doctor;
  if (leadIds.includes('desc')) newRow.cells['desc'] = values.desc;
  // Unidad: usa la primera columna numérica de "cantidad" que tenga la agenda destino.
  const unidadTargetId = ['unidad', 'unid', 'cant'].find(id => leadIds.includes(id));
  if (unidadTargetId) newRow.cells[unidadTargetId] = values.unidad;

  rows.push(newRow);

  await fetchWithRetry(
    () => autosaveAgendaDay(uid, targetAgendaId, dateKey, { rows, extraColumns, meta }),
    { retries: 1, label: 'agregar fila' }
  );
}

// ----------------------------------------------------------------------------
// Barra de herramientas: guardar, agregar/quitar fila y columna, descargar
// (una barra por instancia — AM y PM tienen botones y estado 100% propios)
// ----------------------------------------------------------------------------
function wireToolbar(key) {
  const saveBtn = g('btn-save-agenda', key);
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const state = panels[key];
      if (!state) return;
      setSaveStatus(key, 'Guardando…', 'saving');
      try {
        await fetchWithRetry(() => saveAgendaDay(state.uid, state.agendaId, state.dateKey, {
          rows: state.rows, extraColumns: state.extraColumns, meta: state.meta
        }), { label: 'guardar agenda' });
        setSaveStatus(key, 'Guardado ✓', 'saved');
        showToast(state.label ? `Agenda (${state.label}) guardada en el historial` : 'Agenda guardada en el historial');
      } catch (e) {
        console.error(`Error al guardar agenda (${state.agendaId}${suf(key)}):`, e);
        setSaveStatus(key, 'Error al guardar', 'error');
        showToast(describeFirestoreError(e), true);
      }
    };
  }

  const addRowBtn = g('btn-add-row', key);
  if (addRowBtn) {
    addRowBtn.onclick = () => {
      const state = panels[key];
      if (!state) return;
      state.rows.push(defaultRow());
      renderBody(key); renderFooter(key); updatePointsBadge(key); scheduleAutosave(key);
    };
  }

  const addColBtn = g('btn-add-col', key);
  if (addColBtn) {
    addColBtn.onclick = () => {
      const state = panels[key];
      if (!state) return;
      openAddColumnModal(key, state.config.hasPoints);
    };
  }

  const removeColBtn = g('btn-remove-col', key);
  if (removeColBtn) {
    removeColBtn.onclick = () => {
      const state = panels[key];
      if (!state) return;
      if (!state.extraColumns.length) { showToast('No hay columnas agregadas para eliminar', true); return; }
      if (!confirm('¿Eliminar la última columna agregada? Esta acción no se puede deshacer.')) return;
      const removed = state.extraColumns.pop();
      state.rows.forEach(r => { delete r.cells[removed.id]; });
      fetchWithRetry(() => saveAgendaExtraColumns(state.uid, state.storageAgendaId, state.extraColumns), { retries: 1, label: 'columnas' })
        .catch(e => console.error('Error al guardar columnas:', e));
      renderTable(key);
      scheduleAutosave(key);
      showToast('Columna eliminada');
    };
  }

  const downloadBtn = g('btn-download-agenda', key);
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      openDownloadModal(async (format) => {
        const state = panels[key];
        if (!state) return;
        try {
          const fname = `${state.config.personName}_${state.config.processName}_${state.dateKey}`;
          await captureElementToImage(g('agenda-table', key), fname, format);
          showToast('Descarga iniciada');
        } catch (e) {
          showToast('No se pudo generar la imagen', true);
        }
      });
    };
  }
}

function openAddColumnModal(key, isPoint) {
  const box = openModal(`
    <h3>Agregar columna</h3>
    <p>${isPoint ? `Esta columna usará el valor de respaldo: 1 punto = ${FALLBACK_POINT_VALUE}.` : 'Columna de texto libre, sin cálculo de puntos.'}</p>
    <div class="field">
      <label for="new-col-name">Nombre de la columna</label>
      <input type="text" id="new-col-name" placeholder="${isPoint ? 'Ej. PULIDO' : 'Ej. OBSERVACIONES'}">
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="new-col-cancel">Cancelar</button>
      <button class="btn btn-brass" id="new-col-save">Agregar</button>
    </div>
  `);
  const input = box.querySelector('#new-col-name');
  input.focus();
  box.querySelector('#new-col-cancel').addEventListener('click', closeModal);

  const commit = async () => {
    const state = panels[key];
    if (!state) return;
    const name = input.value.trim();
    if (!name) { showToast('Escribe un nombre para la columna', true); return; }
    const col = isPoint
      ? { id: generateId('col'), label: name.toUpperCase(), weight: FALLBACK_POINT_VALUE }
      : { id: generateId('col'), label: name.toUpperCase(), kind: 'text' };
    state.extraColumns.push(col);
    closeModal();
    try {
      await fetchWithRetry(() => saveAgendaExtraColumns(state.uid, state.storageAgendaId, state.extraColumns), { retries: 1, label: 'columnas' });
    } catch (e) {
      console.error('Error al guardar columnas:', e);
    }
    renderTable(key);
    scheduleAutosave(key);
    showToast('Columna agregada');
  };
  box.querySelector('#new-col-save').addEventListener('click', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
}

// ----------------------------------------------------------------------------
// Guardado
// ----------------------------------------------------------------------------
function setSaveStatus(key, text, cls) {
  const el = g('agenda-save-status', key);
  if (!el) return;
  el.textContent = text;
  el.className = 'save-status' + (cls ? ' ' + cls : '');
}

/** Devuelve (creando si hace falta) la función de autoguardado debounced propia de esta instancia. */
function getAutosaveFn(key) {
  if (!autosaveFns[key]) {
    autosaveFns[key] = debounce(async () => {
      const state = panels[key];
      if (!state) return;
      setSaveStatus(key, 'Guardando…', 'saving');
      try {
        await fetchWithRetry(() => autosaveAgendaDay(state.uid, state.agendaId, state.dateKey, {
          rows: state.rows, extraColumns: state.extraColumns, meta: state.meta
        }), { retries: 1, label: 'autoguardado' });
        setSaveStatus(key, 'Guardado automáticamente', 'saved');
      } catch (e) {
        console.error(`Error en autoguardado (${state.agendaId}${suf(key)}):`, e);
        setSaveStatus(key, 'No se pudo guardar automáticamente', 'error');
      }
    }, 1500);
  }
  return autosaveFns[key];
}

function scheduleAutosave(key) {
  getAutosaveFn(key)();
}
