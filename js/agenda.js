// ============================================================================
// agenda.js — la hoja tipo Excel de cada agenda: render, interacción de
// casillas (clic = X, doble clic = número), cálculo de puntos en tiempo
// real, columnas dinámicas, filas, guardado y descarga.
// ============================================================================

import {
  getAgendaConfig, getAllPointColumns, computeRowTotal, computeGrandTotal,
  computeColumnSum, defaultRow, cellUnits, FALLBACK_POINT_VALUE
} from './agenda-configs.js?v9';
import { getCurrentUser } from './auth.js?v9';
import {
  getAgendaDay, autosaveAgendaDay, saveAgendaDay,
  getAgendaExtraColumns, saveAgendaExtraColumns
} from './data-store.js?v9';
import {
  dateKeyToday, formatAgendaHeaderDate, debounce, escapeHtml, toNumber, generateId, round2,
  fetchWithRetry, describeFirestoreError
} from './utils.js?v9';
import { openModal, closeModal, showToast, openDownloadModal } from './ui-helpers.js?v9';
import { captureElementToImage } from './export.js?v9';

const DEFAULT_ROW_COUNT = 12;

let state = null;
// Token de la carga más reciente: si el usuario navega a otra agenda antes
// de que una carga anterior termine, esa respuesta tardía se descarta en
// vez de sobrescribir lo que ya está en pantalla (condición de carrera).
let renderToken = 0;

function showLoadWarning(message, agendaId, navigate, dk) {
  const el = document.getElementById('agenda-load-warning');
  if (!el) return;
  el.innerHTML = `
    <div style="background:var(--rust-wash);color:var(--rust);border-radius:8px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13.5px;">
      <span>${escapeHtml(message)}</span>
      <button class="btn btn-sm btn-outline" id="agenda-retry-load" style="flex-shrink:0;">Reintentar</button>
    </div>`;
  el.classList.remove('hidden');
  document.getElementById('agenda-retry-load').addEventListener('click', () => {
    renderAgenda(agendaId, navigate, dk);
  });
}

function hideLoadWarning() {
  const el = document.getElementById('agenda-load-warning');
  if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
}

export async function renderAgenda(agendaId, navigate, dateKeyOverride) {
  const myToken = ++renderToken;

  const config = getAgendaConfig(agendaId);
  if (!config) return;

  const dk = dateKeyOverride || dateKeyToday();
  const currentUser = getCurrentUser();
  if (!currentUser) {
    showToast('Tu sesión no está activa. Vuelve a iniciar sesión.', true);
    return;
  }
  const uid = currentUser.uid;

  document.getElementById('agenda-title').textContent = `${config.personName} — ${config.processName}`;
  document.getElementById('agenda-subtitle').textContent = 'Cargando…';
  hideLoadWarning();

  let existing = null;
  let loadError = null;
  try {
    existing = await fetchWithRetry(() => getAgendaDay(uid, agendaId, dk), { label: 'cargar agenda' });
  } catch (e) {
    loadError = e;
    console.error('Error al cargar agenda:', e);
  }

  // Si mientras esto cargaba el usuario ya navegó a otra agenda, no pintar
  // esta respuesta tardía encima de lo que ahora está en pantalla.
  if (myToken !== renderToken) return;

  let rows, extraColumns, meta;
  if (existing) {
    rows = (existing.rows && existing.rows.length) ? existing.rows : [defaultRow()];
    extraColumns = existing.extraColumns || [];
    meta = existing.meta || {};
  } else {
    extraColumns = [];
    if (!loadError) {
      try {
        extraColumns = await fetchWithRetry(() => getAgendaExtraColumns(uid, agendaId), { label: 'columnas' });
      } catch (e) {
        extraColumns = [];
      }
      if (myToken !== renderToken) return;
    }
    rows = Array.from({ length: DEFAULT_ROW_COUNT }, () => defaultRow());
    meta = {};
  }

  const [yy, mm, dd] = dk.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('es-GT', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(yy, mm - 1, dd)));
  document.getElementById('agenda-subtitle').textContent =
    `${formatAgendaHeaderDate({ day: dd, month: mm }, weekday)} ${config.processName.toUpperCase()}`;

  state = { agendaId, config, dateKey: dk, uid, rows, extraColumns, meta };

  renderTable();
  wireToolbar();

  if (loadError) {
    const msg = `No se pudieron cargar los datos guardados de esta agenda — esto NO significa que se hayan borrado. ${describeFirestoreError(loadError)}`;
    showToast(msg, true);
    showLoadWarning(msg, agendaId, navigate, dk);
  }
}

// ----------------------------------------------------------------------------
// Construcción de columnas
// ----------------------------------------------------------------------------
function buildColumnList() {
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
// Render completo (encabezado + cuerpo + pie)
// ----------------------------------------------------------------------------
function renderTable() {
  const cols = buildColumnList();
  const thead = document.getElementById('agenda-thead');
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

  renderBody();
  renderFooter();
  updatePointsBadge();
}

function renderBody() {
  const cols = buildColumnList();
  const tbody = document.getElementById('agenda-tbody');

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

    return `<tr>${tds}${totalTd}<td class="row-actions-col"><button class="row-delete-btn" data-delrow="${row.id}" title="Eliminar fila">✕</button></td></tr>`;
  }).join('');

  wireBodyEvents();
}

function renderFooter() {
  const cols = buildColumnList();
  const tfoot = document.getElementById('agenda-tfoot');

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
        renderFooter();
        scheduleAutosave();
      });
    });
  }
}

function updatePointsBadge() {
  const badge = document.getElementById('agenda-points-badge');
  if (!state.config.hasPoints) { badge.classList.add('hidden'); return; }
  badge.classList.remove('hidden');
  const gt = round2(computeGrandTotal(state.config, state.rows, state.extraColumns));
  badge.innerHTML = `${gt.toFixed(2)} <span>pts</span>`;
}

// ----------------------------------------------------------------------------
// Interacción de celdas
// ----------------------------------------------------------------------------
function wireBodyEvents() {
  const tbody = document.getElementById('agenda-tbody');

  tbody.querySelectorAll('.cell-text').forEach(input => {
    input.addEventListener('input', (e) => {
      const row = state.rows.find(r => r.id === e.target.dataset.row);
      if (!row) return;
      row.cells[e.target.dataset.col] = e.target.value;
      refreshTotalsOnly();
      scheduleAutosave();
    });
  });

  tbody.querySelectorAll('td.cell-point').forEach(td => {
    td.addEventListener('click', () => handlePointClick(td));
    td.addEventListener('dblclick', (e) => { e.preventDefault(); handlePointDblClick(td); });
  });

  tbody.querySelectorAll('[data-delrow]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.rows.length <= 1) { showToast('Debe quedar al menos una fila', true); return; }
      if (!confirm('¿Eliminar esta fila?')) return;
      state.rows = state.rows.filter(r => r.id !== btn.dataset.delrow);
      renderBody(); renderFooter(); updatePointsBadge(); scheduleAutosave();
    });
  });
}

function refreshTotalsOnly() {
  if (state.config.hasPoints) {
    const trs = document.querySelectorAll('#agenda-tbody tr');
    trs.forEach((tr, idx) => {
      const row = state.rows[idx];
      if (!row) return;
      const cell = tr.querySelector('td.cell-total');
      if (cell) cell.textContent = round2(computeRowTotal(state.config, row, state.extraColumns)).toFixed(2);
    });
  }
  renderFooter();
  updatePointsBadge();
}

function handlePointClick(td) {
  const row = state.rows.find(r => r.id === td.dataset.row);
  if (!row) return;
  const cur = row.cells[td.dataset.col];
  row.cells[td.dataset.col] = (cur === 'X') ? '' : 'X';
  renderBody(); renderFooter(); updatePointsBadge(); scheduleAutosave();
}

function handlePointDblClick(td) {
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
    renderBody(); renderFooter(); updatePointsBadge(); scheduleAutosave();
  };
  box.querySelector('#cell-number-save').addEventListener('click', () => commit(input.value.trim()));
  box.querySelector('#cell-number-clear').addEventListener('click', () => commit(''));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(input.value.trim()); });
}

// ----------------------------------------------------------------------------
// Barra de herramientas: guardar, agregar/quitar fila y columna, descargar
// ----------------------------------------------------------------------------
function wireToolbar() {
  document.getElementById('btn-save-agenda').onclick = async () => {
    setSaveStatus('Guardando…', 'saving');
    try {
      await fetchWithRetry(() => saveAgendaDay(state.uid, state.agendaId, state.dateKey, {
        rows: state.rows, extraColumns: state.extraColumns, meta: state.meta
      }), { label: 'guardar agenda' });
      setSaveStatus('Guardado ✓', 'saved');
      showToast('Agenda guardada en el historial');
    } catch (e) {
      console.error('Error al guardar agenda:', e);
      setSaveStatus('Error al guardar', 'error');
      showToast(describeFirestoreError(e), true);
    }
  };

  document.getElementById('btn-add-row').onclick = () => {
    state.rows.push(defaultRow());
    renderBody(); renderFooter(); updatePointsBadge(); scheduleAutosave();
  };

  document.getElementById('btn-add-col').onclick = () => {
    state.config.hasPoints ? openAddColumnModal(true) : openAddColumnModal(false);
  };

  document.getElementById('btn-remove-col').onclick = () => {
    if (!state.extraColumns.length) { showToast('No hay columnas agregadas para eliminar', true); return; }
    if (!confirm('¿Eliminar la última columna agregada? Esta acción no se puede deshacer.')) return;
    const removed = state.extraColumns.pop();
    state.rows.forEach(r => { delete r.cells[removed.id]; });
    fetchWithRetry(() => saveAgendaExtraColumns(state.uid, state.agendaId, state.extraColumns), { retries: 1, label: 'columnas' })
      .catch(e => console.error('Error al guardar columnas:', e));
    renderTable();
    scheduleAutosave();
    showToast('Columna eliminada');
  };

  document.getElementById('btn-download-agenda').onclick = () => {
    openDownloadModal(async (format) => {
      try {
        const fname = `${state.config.personName}_${state.config.processName}_${state.dateKey}`;
        await captureElementToImage(document.getElementById('agenda-table'), fname, format);
        showToast('Descarga iniciada');
      } catch (e) {
        showToast('No se pudo generar la imagen', true);
      }
    });
  };
}

function openAddColumnModal(isPoint) {
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
    const name = input.value.trim();
    if (!name) { showToast('Escribe un nombre para la columna', true); return; }
    const col = isPoint
      ? { id: generateId('col'), label: name.toUpperCase(), weight: FALLBACK_POINT_VALUE }
      : { id: generateId('col'), label: name.toUpperCase(), kind: 'text' };
    state.extraColumns.push(col);
    closeModal();
    try {
      await fetchWithRetry(() => saveAgendaExtraColumns(state.uid, state.agendaId, state.extraColumns), { retries: 1, label: 'columnas' });
    } catch (e) {
      console.error('Error al guardar columnas:', e);
    }
    renderTable();
    scheduleAutosave();
    showToast('Columna agregada');
  };
  box.querySelector('#new-col-save').addEventListener('click', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
}

// ----------------------------------------------------------------------------
// Guardado
// ----------------------------------------------------------------------------
function setSaveStatus(text, cls) {
  const el = document.getElementById('agenda-save-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'save-status' + (cls ? ' ' + cls : '');
}

const debouncedAutosave = debounce(async () => {
  if (!state) return;
  setSaveStatus('Guardando…', 'saving');
  try {
    await fetchWithRetry(() => autosaveAgendaDay(state.uid, state.agendaId, state.dateKey, {
      rows: state.rows, extraColumns: state.extraColumns, meta: state.meta
    }), { retries: 1, label: 'autoguardado' });
    setSaveStatus('Guardado automáticamente', 'saved');
  } catch (e) {
    console.error('Error en autoguardado:', e);
    setSaveStatus('No se pudo guardar automáticamente', 'error');
  }
}, 1500);

function scheduleAutosave() { debouncedAutosave(); }
