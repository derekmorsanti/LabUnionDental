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
} from './agenda-configs.js?v31';
import { getCurrentUser } from './auth.js?v31';
import {
  getAgendaDay, autosaveAgendaDay, saveAgendaDay,
  getAgendaExtraColumns, saveAgendaExtraColumns
} from './data-store.js?v31';
import {
  dateKeyToday, formatAgendaHeaderDate, debounce, escapeHtml, toNumber, generateId, round2,
  fetchWithRetry, describeFirestoreError, markAgendaAsSynced, shiftSaturdayToMonday,
  cacheAgendaDayWrite, getCachedAgendaDayWrite,
  saveAgendaDraft, getAgendaDraft, clearAgendaDraft, listAgendaDrafts,
  buildRescheduleId, getRescheduleQueue, enqueueReschedule, dequeueReschedule
} from './utils.js?v31';
import { openModal, closeModal, showToast, openDownloadModal } from './ui-helpers.js?v31';
import { captureElementToImage } from './export.js?v31';

// ----------------------------------------------------------------------------
// Botón "AGREGAR" por fila: crea una fila nueva en OTRA agenda (Yesos,
// Metales, Tallado, Encerado o Pretallado), copiando SOLO doctor/paciente,
// descripción y unidad. No requiere que la agenda destino esté abierta —
// escribe directamente en su documento del día en Firestore, reutilizando
// exactamente el mismo esquema que usa el resto de la app.
// ----------------------------------------------------------------------------
const AGREGAR_TARGETS = [
  { label: 'Yesos', agendaId: 'cony' },
  { label: 'Encerado', agendaId: 'dina' },
  { label: 'Metales', agendaId: 'abner' },
  { label: 'Pretallado', agendaId: 'eliu' },
  { label: 'Tallado', agendaId: 'astryd' }
];

const DEFAULT_ROW_COUNT = 12;

// Paleta de colores disponibles para pintar el texto de una fila completa
// (5 colores, sin negro/por-defecto). Flujo: clic en una fila para
// seleccionarla (se resalta) → clic en un color → el texto de TODA esa
// fila cambia de inmediato a ese color y se guarda en row.rowColor.
const CELL_COLORS = [
  { key: 'red', label: 'Rojo', hex: '#dc2626' },
  { key: 'blue', label: 'Azul', hex: '#2563eb' },
  { key: 'green', label: 'Verde', hex: '#16a34a' },
  { key: 'orange', label: 'Naranja', hex: '#ea580c' },
  { key: 'yellow', label: 'Amarillo', hex: '#eab308' }
];
const RED_COLUMN_HEX = '#dc2626';

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

      <div class="cell-color-picker" id="${eid('cell-color-picker', key)}">
        <span class="ccp-label">Color de fila: </span>
        ${CELL_COLORS.map(c => `<button type="button" class="ccp-swatch" data-color="${c.key}" style="background:${c.hex};" title="${escapeHtml(c.label)}"></button>`).join('')}
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

  // Los paneles de ESTA agenda se crean primero — loadInstance sigue
  // siendo 100% no bloqueante (pinta de inmediato, Firebase va en
  // segundo plano; ver loadInstance/loadAgendaInBackground, sin tocar).
  // Iniciar las cargas AQUÍ (antes de procesar colas pendientes) es lo
  // que garantiza que, si un reagendado pendiente apunta a esta misma
  // agenda+día, encuentre `panels[...]` ya poblado y pueda reflejar la
  // fila en vivo sin depender de una ventana de tiempo/caché.
  const loadPromises = instances.map(inst => loadInstance(config, agendaId, uid, baseDateKey, inst));

  // Ahora sí, en segundo plano y sin bloquear nada de lo anterior, se
  // reintentan reagendados y borradores de guardado que hubieran quedado
  // pendientes (p. ej. porque Firebase estaba offline en el momento).
  console.log('[RESCHEDULE] QUEUE START');
  flushRescheduleQueue(uid);
  flushAgendaDrafts(uid);

  // Cada instancia carga y se pinta de forma totalmente independiente;
  // un error en AM no bloquea ni afecta la carga de PM (o viceversa).
  await Promise.all(loadPromises);
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
  hideLoadWarning(key);

  // ------------------------------------------------------------------
  // RENDER INMEDIATO: nunca se espera a Firestore para mostrar la
  // agenda. Prioridad de qué se pinta primero:
  //   1) Borrador local duradero (localStorage) — sobrevive a un F5 y es
  //      la fuente más confiable si hubo ediciones que Firestore todavía
  //      no confirmó (p. ej. estaba offline).
  //   2) Caché en memoria de una escritura reciente ya CONFIRMADA por
  //      Firestore (vive ~20s, útil justo después de guardar/reagendar).
  //   3) Tabla vacía por defecto.
  // La carga/verificación real contra el servidor ocurre DESPUÉS, en
  // segundo plano, y nunca puede pisar silenciosamente un borrador local
  // más nuevo que lo que el propio Firestore reporta como última
  // actualización (ver loadAgendaInBackground/reconcileAgendaWithServer).
  // ------------------------------------------------------------------
  const draftEntry = getAgendaDraft(agendaId, dateKey);
  const cachedWrite = !draftEntry ? getCachedAgendaDayWrite(agendaId, dateKey) : null;
  const source = (draftEntry ? draftEntry.data : null) || cachedWrite;

  let rows, extraColumns, meta, redColumns;
  if (source) {
    rows = (source.rows && source.rows.length) ? source.rows : [defaultRow()];
    extraColumns = source.extraColumns || [];
    meta = source.meta || {};
    redColumns = source.redColumns || {};
  } else {
    rows = Array.from({ length: DEFAULT_ROW_COUNT }, () => defaultRow());
    extraColumns = [];
    meta = {};
    redColumns = {};
  }
  normalizeRowColors(rows);

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
    dateKey, baseDateKey, uid, rows, extraColumns, meta,
    redColumns, selectedRowId: null
  };

  renderTable(key);
  wireToolbar(key);

  if (draftEntry) {
    // Había cambios locales sin confirmar (el borrador ya estaba en
    // localStorage de ANTES de esta carga, con su savedAt original
    // intacto): se intenta sincronizarlos contra Firestore de inmediato,
    // en segundo plano, sin volver a "tocar" el borrador ni su marca de
    // tiempo — sincronizar no es una edición nueva.
    getAutosaveFn(key)();
  }

  // ------------------------------------------------------------------
  // Carga real contra Firestore, SIEMPRE en segundo plano — nunca
  // bloquea ni retrasa lo que el usuario ya está viendo. Si el
  // documento existe y el usuario no ha escrito nada todavía, se aplica
  // y se repinta solo. Si Firestore está offline, no se bloquea nada:
  // se avisa con el banner/reintentar de siempre y se reintenta solo
  // más tarde (reconexión o próxima apertura), sin tocar lo ya pintado.
  // ------------------------------------------------------------------
  if (cachedWrite) markAgendaAsSynced(storageAgendaId);
  loadAgendaInBackground(agendaId, uid, dateKey, storageAgendaId, key, myToken, { hadCache: !!cachedWrite });
}

/** Normaliza filas viejas: `colors` (color por casilla) → `rowColor` (color de fila completa). */
function normalizeRowColors(rows) {
  rows.forEach(r => {
    if (r.rowColor === undefined || r.rowColor === null) {
      if (r.colors && typeof r.colors === 'object') {
        const firstColorKey = Object.values(r.colors)[0];
        r.rowColor = CELL_COLORS.some(c => c.key === firstColorKey) ? firstColorKey : null;
      } else {
        r.rowColor = null;
      }
    }
    delete r.colors;
  });
}

/**
 * Carga (o verifica) la agenda contra Firestore en segundo plano, sin que
 * el usuario tenga que esperarla para ver la tabla. Si encuentra datos y
 * el usuario no escribió nada mientras tanto, los aplica; si el
 * documento del día no existe pero sí hay columnas dinámicas guardadas
 * para esta agenda, también las aplica. Si Firestore está offline, no
 * bloquea ni "corrompe" nada: solo avisa y reintenta solo más tarde.
 */
/**
 * True si hay AHORA MISMO (lectura en vivo, no una marca de tiempo vieja
 * guardada en el panel) un borrador local sin confirmar que sea más nuevo
 * que la última actualización real que reporta Firestore. Si no hay
 * ningún borrador pendiente (ya se confirmó y se borró, o nunca hubo
 * ediciones), el servidor es seguro de aplicar aunque la tabla en
 * pantalla ya tenga contenido — el contenido por sí solo NO es motivo
 * para bloquear la sincronización para siempre.
 */
function draftIsNewerThanServer(agendaId, dateKey, existing) {
  const entry = getAgendaDraft(agendaId, dateKey);
  if (!entry) return false;
  const serverMillis = (existing && existing.updatedAt && typeof existing.updatedAt.toMillis === 'function')
    ? existing.updatedAt.toMillis()
    : 0;
  return entry.savedAt > serverMillis;
}

async function loadAgendaInBackground(agendaId, uid, dateKey, storageAgendaId, key, myToken, opts = {}) {
  let existing = null;
  let loadError = null;
  try {
    existing = await fetchWithRetry(() => getAgendaDay(uid, agendaId, dateKey), { retries: 2, delayMs: 700, label: 'cargar agenda' });
    markAgendaAsSynced(storageAgendaId);
  } catch (e) {
    loadError = e;
    console.error(`Error al cargar agenda (${agendaId}${suf(key)}):`, e);
  }

  // Si mientras esto cargaba el usuario ya navegó a otra agenda, o se
  // disparó otro reintento de ESTA MISMA instancia, no pintar esta
  // respuesta tardía encima de lo que ahora está en pantalla.
  if (instTokens[key] !== myToken) return;

  if (loadError) {
    const msg = `No se pudieron cargar los datos guardados de esta agenda — esto NO significa que se hayan borrado. ${describeFirestoreError(loadError)}`;
    showToast(msg, true);
    showLoadWarning(msg, key);

    // Justo después de F5, el canal de Firestore a veces todavía no
    // terminó de abrirse (falso "offline" transitorio) — se reintenta
    // solo, en segundo plano, antes de dejarle al usuario únicamente el
    // botón manual de "Reintentar". Nunca bloquea la interfaz.
    setTimeout(async () => {
      const recovered = await reconcileAgendaWithServer(
        agendaId, uid, dateKey, storageAgendaId, key, myToken,
        { retries: 2, delayMs: 800, label: 'reintento automático' }
      );
      if (recovered && instTokens[key] === myToken) hideLoadWarning(key);
    }, 1500);
    return;
  }

  const state = panels[key];
  if (!state) return;

  if (existing) {
    const skip = draftIsNewerThanServer(agendaId, dateKey, existing);
    if (!skip) {
      state.rows = (existing.rows && existing.rows.length) ? existing.rows : state.rows;
      state.extraColumns = existing.extraColumns || state.extraColumns;
      state.meta = existing.meta || state.meta;
      state.redColumns = existing.redColumns || state.redColumns;
      normalizeRowColors(state.rows);
      clearAgendaDraft(agendaId, dateKey);
      renderTable(key);
    }
    return;
  }

  // No hay documento del día todavía: si al menos hay columnas dinámicas
  // guardadas para esta agenda, se aplican (sin tocar filas si hay un
  // borrador local sin confirmar de por medio).
  if (!draftIsNewerThanServer(agendaId, dateKey, existing)) {
    try {
      const extraColumns = await fetchWithRetry(() => getAgendaExtraColumns(uid, storageAgendaId), { retries: 1, label: 'columnas' });
      if (instTokens[key] !== myToken) return;
      if (extraColumns && extraColumns.length && !draftIsNewerThanServer(agendaId, dateKey, existing)) {
        state.extraColumns = extraColumns;
        renderTable(key);
      }
    } catch (e) {
      // Columnas dinámicas son un detalle menor: si falla, no se avisa ni se bloquea nada.
    }
  }
}

/**
 * Vuelve a consultar el documento real de la agenda en el servidor y, si
 * encuentra datos guardados que el panel en pantalla todavía no tiene (y el
 * usuario no ha escrito nada localmente todavía, para no pisar su trabajo
 * en curso), los aplica y repinta. Se usa para el reintento automático tras
 * un error de carga. Devuelve true si terminó sin error (haya encontrado
 * datos o no), false si la consulta en sí falló.
 */
async function reconcileAgendaWithServer(agendaId, uid, dateKey, storageAgendaId, key, myToken, opts = {}) {
  let existing = null;
  try {
    existing = await fetchWithRetry(
      () => getAgendaDay(uid, agendaId, dateKey),
      { retries: opts.retries != null ? opts.retries : 1, delayMs: opts.delayMs != null ? opts.delayMs : 700, label: opts.label || 'verificación' }
    );
  } catch (e) {
    return false;
  }

  if (instTokens[key] !== myToken) return true;

  markAgendaAsSynced(storageAgendaId);
  if (!existing) return true;

  const state = panels[key];
  if (!state) return true;

  if (draftIsNewerThanServer(agendaId, dateKey, existing)) return true;

  state.rows = (existing.rows && existing.rows.length) ? existing.rows : state.rows;
  state.extraColumns = existing.extraColumns || state.extraColumns;
  state.meta = existing.meta || state.meta;
  state.redColumns = existing.redColumns || state.redColumns;
  normalizeRowColors(state.rows);
  clearAgendaDraft(agendaId, dateKey);

  renderTable(key);
  return true;
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
function headCellHtml(c, redColumns) {
  const isRed = !!(redColumns && redColumns[c.id]);
  const redCls = isRed ? ' col-red-active' : '';
  if (c.kind === 'text') {
    const cls = (c.id === 'doctor' ? 'col-doctor' : 'col-desc') + ' col-clickable' + redCls;
    return `<th class="${cls}" data-colid="${escapeHtml(c.id)}" title="Clic para resaltar esta columna en rojo">${escapeHtml(c.label)}</th>`;
  }
  const weightLabel = c.kind === 'point-extra-eliu'
    ? '(× UNIDAD)'
    : `(${(c.weight != null ? c.weight : FALLBACK_POINT_VALUE)})`;
  return `<th class="col-clickable${redCls}" data-colid="${escapeHtml(c.id)}" title="Clic para resaltar esta columna en rojo">${escapeHtml(c.label)}<span class="col-weight">${weightLabel}</span></th>`;
}

function renderTable(key) {
  const state = panels[key];
  if (!state) return;
  const cols = buildColumnList(key);
  const thead = g('agenda-thead', key);
  const headCells = cols.map(c => headCellHtml(c, state.redColumns)).join('');
  const totalTh = state.config.hasPoints ? `<th class="col-total">${escapeHtml(state.config.totalLabel)}</th>` : '';
  thead.innerHTML = `<tr>${headCells}${totalTh}<th class="row-actions-col"></th></tr>`;
  wireHeadEvents(key);

  renderBody(key, cols);
  renderFooter(key, cols);
  updatePointsBadge(key);
}

// ----------------------------------------------------------------------------
// Clic en el encabezado de una columna: alterna el texto de esa columna en
// rojo (delegado una sola vez sobre el <thead>, igual que wireBodyEvents).
// ----------------------------------------------------------------------------
function wireHeadEvents(key) {
  const thead = g('agenda-thead', key);
  if (!thead || thead.dataset.delegated === '1') return;
  thead.dataset.delegated = '1';
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-colid]');
    if (!th) return;
    const state = panels[key];
    if (!state) return;
    if (!state.redColumns) state.redColumns = {};
    const colId = th.dataset.colid;
    state.redColumns[colId] = !state.redColumns[colId];
    renderTable(key);
    scheduleAutosave(key);
  });
}

function renderBody(key, precomputedCols) {
  const state = panels[key];
  if (!state) return;
  const cols = precomputedCols || buildColumnList(key);
  const tbody = g('agenda-tbody', key);

  tbody.innerHTML = state.rows.map(row => {
    const rowColorDef = row.rowColor ? CELL_COLORS.find(cc => cc.key === row.rowColor) : null;
    const rowHex = rowColorDef ? rowColorDef.hex : null;
    const isSelected = state.selectedRowId === row.id;

    const tds = cols.map(c => {
      const val = (row.cells[c.id] !== undefined && row.cells[c.id] !== null) ? row.cells[c.id] : '';
      const isRedCol = !!(state.redColumns && state.redColumns[c.id]);
      const finalHex = isRedCol ? RED_COLUMN_HEX : rowHex;
      if (c.kind === 'text') {
        const cls = c.id === 'doctor' ? 'col-doctor' : 'col-desc';
        const inputStyle = finalHex ? ` style="color:${finalHex};"` : '';
        return `<td class="${cls}"><input class="cell-text" type="text" value="${escapeHtml(val)}" data-row="${row.id}" data-col="${c.id}"${inputStyle}></td>`;
      }
      const isMarked = val === 'X';
      const hasNumber = val !== '' && val !== 'X';
      const cls = ['cell-point', isMarked ? 'marked' : '', hasNumber ? 'has-number' : ''].filter(Boolean).join(' ');
      const spanStyle = finalHex ? ` style="color:${finalHex};border-color:${finalHex};"` : '';
      const display = isMarked ? `<span class="mark-x"${spanStyle}>X</span>` : (hasNumber ? `<span${spanStyle}>${escapeHtml(String(val))}</span>` : '');
      return `<td class="${cls}" data-row="${row.id}" data-col="${c.id}">${display}</td>`;
    }).join('');

    const totalTd = state.config.hasPoints
      ? `<td class="cell-total">${round2(computeRowTotal(state.config, row, state.extraColumns)).toFixed(2)}</td>`
      : '';

    return `<tr data-row="${row.id}" class="${isSelected ? 'row-selected' : ''}">${tds}${totalTd}<td class="row-actions-col"><button class="row-agregar-btn" data-agregar="${row.id}" title="Agregar a otra agenda">→</button><button class="row-delete-btn" data-delrow="${row.id}" title="Eliminar fila">✕</button></td></tr>`;
  }).join('');

  wireBodyEvents(key);
  syncColorPicker(key);
}

/** Refleja en la paleta de colores cuál color (si alguno) tiene la fila actualmente seleccionada. */
function syncColorPicker(key) {
  const state = panels[key];
  if (!state) return;
  const colorPicker = g('cell-color-picker', key);
  if (!colorPicker) return;
  const row = state.rows.find(r => r.id === state.selectedRowId);
  const currentColor = row ? row.rowColor : null;
  colorPicker.querySelectorAll('[data-color]').forEach(b => {
    b.classList.toggle('active', !!currentColor && b.dataset.color === currentColor);
  });
}

function renderFooter(key, precomputedCols) {
  const state = panels[key];
  if (!state) return;
  const cols = precomputedCols || buildColumnList(key);
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
function selectRow(key, rowId) {
  const state = panels[key];
  if (!state || state.selectedRowId === rowId) return;
  state.selectedRowId = rowId;
  const tbody = g('agenda-tbody', key);
  if (tbody) {
    tbody.querySelectorAll('tr[data-row]').forEach(tr => {
      tr.classList.toggle('row-selected', tr.dataset.row === rowId);
    });
  }
  syncColorPicker(key);
}

function wireBodyEvents(key) {
  const tbody = g('agenda-tbody', key);
  if (!tbody || tbody.dataset.delegated === '1') return;
  tbody.dataset.delegated = '1';

  tbody.addEventListener('input', (e) => {
    const input = e.target.closest('.cell-text');
    if (!input || !tbody.contains(input)) return;
    selectRow(key, input.dataset.row);
    const state = panels[key];
    if (!state) return;
    const row = state.rows.find(r => r.id === input.dataset.row);
    if (!row) return;
    row.cells[input.dataset.col] = input.value;
    refreshTotalsOnly(key);
    scheduleAutosave(key);
  });

  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-row]');
    if (tr) selectRow(key, tr.dataset.row);

    const agregarBtn = e.target.closest('[data-agregar]');
    if (agregarBtn) {
      console.log('[RESCHEDULE] Agregar clicked', agregarBtn.dataset.agregar);
      openAgregarModal(key, agregarBtn.dataset.agregar);
      return;
    }

    const delBtn = e.target.closest('[data-delrow]');
    if (delBtn) {
      const state = panels[key];
      if (!state) return;
      if (state.rows.length <= 1) { showToast('Debe quedar al menos una fila', true); return; }
      if (!confirm('¿Eliminar esta fila?')) return;
      state.rows = state.rows.filter(r => r.id !== delBtn.dataset.delrow);
      if (state.selectedRowId === delBtn.dataset.delrow) state.selectedRowId = null;
      renderBody(key); renderFooter(key); updatePointsBadge(key); scheduleAutosave(key);
      return;
    }

    const pointTd = e.target.closest('td.cell-point');
    if (pointTd) { handlePointClick(key, pointTd); return; }
  });

  tbody.addEventListener('dblclick', (e) => {
    const pointTd = e.target.closest('td.cell-point');
    if (pointTd) { e.preventDefault(); handlePointDblClick(key, pointTd); }
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
  selectRow(key, row.id);
  const colId = td.dataset.col;
  const cur = row.cells[colId];
  row.cells[colId] = (cur === 'X') ? '' : 'X';
  renderBody(key); renderFooter(key); updatePointsBadge(key); scheduleAutosave(key);
}

function handlePointDblClick(key, td) {
  const state = panels[key];
  if (!state) return;
  const row = state.rows.find(r => r.id === td.dataset.row);
  if (!row) return;
  selectRow(key, row.id);
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
  console.log('[RESCHEDULE] openAgregarModal', key, rowId);
  const state = panels[key];
  if (!state) { console.error('[RESCHEDULE] ERROR: no hay panel activo para key=', key); return; }
  const row = state.rows.find(r => r.id === rowId);
  if (!row) { console.error('[RESCHEDULE] ERROR: no se encontró la fila', rowId); return; }
  const values = extractRowLeadValues(state, row);

  const box = openModal(`
    <h3>Agregar a otra agenda</h3>
    <p>Se creará una fila nueva con doctor/paciente, descripción y unidad. Los demás campos quedan vacíos para editar ahí.</p>
    <div class="field">
      <label for="agregar-fecha">Fecha destino</label>
      <input type="date" id="agregar-fecha" value="${dateKeyToday()}">
    </div>
    <p style="font-size:12.5px;color:var(--ink-muted);margin-top:-10px;margin-bottom:18px;">Si la fecha elegida cae en sábado, se reagenda automáticamente al lunes siguiente.</p>
    <div class="modal-actions" style="flex-wrap:wrap;justify-content:center;">
      ${AGREGAR_TARGETS.map(t => `<button class="btn btn-outline" data-target="${t.agendaId}">${escapeHtml(t.label)}</button>`).join('')}
    </div>
  `);
  const fechaInput = box.querySelector('#agregar-fecha');

  box.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetAgendaId = btn.dataset.target;
      console.log('[RESCHEDULE] confirmar reagendamiento', targetAgendaId);
      const target = AGREGAR_TARGETS.find(t => t.agendaId === targetAgendaId);
      const targetLabel = target ? target.label : targetAgendaId;
      const rawDate = (fechaInput && fechaInput.value) ? fechaInput.value : dateKeyToday();
      closeModal();

      try {
        console.log('[RESCHEDULE] iniciando reagendamiento');
        const finalDateKey = await addRowToOtherAgenda(state.uid, targetAgendaId, values, rawDate, {
          agendaId: state.agendaId, dateKey: state.dateKey, rowId
        });
        const wasShifted = finalDateKey !== rawDate;
        showToast(
          wasShifted
            ? `Fila agregada a la agenda de ${targetLabel} — reagendada al lunes ${finalDateKey} (la fecha elegida caía en sábado)`
            : `Fila agregada a la agenda de ${targetLabel} (${finalDateKey})`
        );
      } catch (e) {
        console.error('[RESCHEDULE] ERROR:', e);
        showToast(
          `No se pudo confirmar el reagendado a ${targetLabel} por ahora (sin conexión) — doctor/descripción/unidad quedaron guardados y se reintentará solo en cuanto vuelva la señal.`,
          true
        );
      }
    });
  });
}

/**
 * Punto de entrada principal del reagendado (se conserva con este nombre
 * porque es lo que llama el modal de "Agregar a otra agenda"). Arma el
 * `pending` (SOLO doctor/descripción/unidad + metadatos de ruteo — nunca
 * casillas) y lo delega a scheduleReschedule/performReschedule, que son
 * quienes de verdad guardan la cola persistente y hablan con Firebase.
 * Si Firebase no confirma de inmediato, el pending YA quedó en la cola
 * (scheduleReschedule lo encola antes de intentar) y esta función lanza
 * el error para que el modal avise al usuario — no se pierde nada.
 * Devuelve la fecha (YYYY-MM-DD) final usada si se confirmó al instante.
 */
async function addRowToOtherAgenda(uid, targetAgendaId, values, rawDateKey, sourceInfo) {
  console.log('[RESCHEDULE] addRowToOtherAgenda', { targetAgendaId, values, rawDateKey, sourceInfo });

  const targetConfig = getAgendaConfig(targetAgendaId);
  if (!targetConfig) {
    const err = new Error(`No se encontró la configuración de la agenda destino "${targetAgendaId}".`);
    console.error('[RESCHEDULE] ERROR:', err);
    throw err;
  }

  const baseDateKey = shiftSaturdayToMonday(rawDateKey || dateKeyToday());
  const targetDateKey = targetConfig.splitAmPm ? `${baseDateKey}-AM` : baseDateKey;

  // Solo estos 3 valores viajan al reagendar — nunca las casillas
  // marcadas del origen.
  const pending = {
    rescheduleId: buildRescheduleId({
      sourceAgendaId: (sourceInfo && sourceInfo.agendaId) || '',
      sourceDateKey: (sourceInfo && sourceInfo.dateKey) || '',
      sourceRowId: (sourceInfo && sourceInfo.rowId) || '',
      targetAgendaId, targetDateKey
    }),
    sourceAgendaId: (sourceInfo && sourceInfo.agendaId) || '',
    sourceDateKey: (sourceInfo && sourceInfo.dateKey) || '',
    sourceRowId: (sourceInfo && sourceInfo.rowId) || '',
    targetAgendaId, targetDateKey,
    doctor: values.doctor, descripcion: values.desc, unidad: values.unidad,
    createdAt: Date.now()
  };

  const result = await scheduleReschedule(uid, pending);
  if (!result.ok) {
    throw result.error || new Error('No se pudo confirmar el reagendado (sin conexión); quedó en la cola y se reintentará automáticamente.');
  }
  return baseDateKey;
}

/**
 * Guarda el pending en la cola persistente ANTES de tocar Firebase (para
 * no perderlo si falla), intenta escribirlo, y solo lo saca de la cola si
 * Firebase confirma. Nunca deja el pending a medias ni lo vacía por un
 * fallo de red.
 */
async function scheduleReschedule(uid, pending) {
  console.log('[RESCHEDULE] scheduleReschedule', pending.rescheduleId);
  enqueueReschedule(pending);
  try {
    await performReschedule(uid, pending);
    dequeueReschedule(pending.rescheduleId);
    return { ok: true };
  } catch (e) {
    console.error('[RESCHEDULE] ERROR:', e);
    return { ok: false, error: e };
  }
}

/**
 * Escribe (o actualiza) SOLO doctor/descripción/unidad en la fila destino,
 * identificada por pending.rescheduleId para ser idempotente — un mismo
 * pending puede reintentarse varias veces sin crear filas duplicadas ni
 * pisar casillas/marcas/columnas que ya existan en el destino.
 */
async function performReschedule(uid, pending) {
  console.log('[RESCHEDULE] performReschedule START', {
    targetAgendaId: pending.targetAgendaId,
    targetDateKey: pending.targetDateKey,
    rescheduleId: pending.rescheduleId
  });
  const targetConfig = getAgendaConfig(pending.targetAgendaId);
  if (!targetConfig) {
    const err = new Error(`No se encontró la configuración de la agenda destino "${pending.targetAgendaId}".`);
    console.error('[RESCHEDULE] ERROR:', err);
    throw err;
  }

  const storageAgendaId = targetConfig.splitAmPm ? `${pending.targetAgendaId}-am` : pending.targetAgendaId;
  const targetInstanceKey = targetConfig.splitAmPm ? 'am' : '';

  // Se prioriza cualquier copia ya conocida (caché reciente o el panel
  // realmente abierto en pantalla) antes de depender de una lectura de
  // red — reduce la ventana en la que un "offline" transitorio de
  // Firestore puede bloquear el reagendado.
  let existing = getCachedAgendaDayWrite(pending.targetAgendaId, pending.targetDateKey);
  if (!existing) {
    const livePanel = panels[targetInstanceKey];
    if (livePanel && livePanel.agendaId === pending.targetAgendaId && livePanel.dateKey === pending.targetDateKey) {
      existing = {
        rows: livePanel.rows, extraColumns: livePanel.extraColumns,
        meta: livePanel.meta, redColumns: livePanel.redColumns
      };
    }
  }
  if (!existing) {
    console.log('[RESCHEDULE] leyendo agenda destino desde Firestore antes de escribir');
    try {
      existing = await fetchWithRetry(
        () => getAgendaDay(uid, pending.targetAgendaId, pending.targetDateKey),
        { retries: 4, delayMs: 900, label: 'reagendar' }
      );
      console.log('[RESCHEDULE] lectura destino OK', { encontroDocumento: !!existing, filas: existing && existing.rows ? existing.rows.length : 0 });
    } catch (readErr) {
      console.error('[RESCHEDULE] ERROR leyendo agenda destino:', readErr);
      throw readErr;
    }
  }

  const rows = (existing && existing.rows && existing.rows.length) ? [...existing.rows] : [];
  // Columnas/meta/colores rojos: SIEMPRE los del destino (Abner), nunca
  // se traen ni se mezclan con los del origen (Dina) — la estructura de
  // columnas de la agenda destino no se toca en absoluto.
  const extraColumns = (existing && existing.extraColumns) || [];
  const meta = (existing && existing.meta) || {};
  const redColumns = (existing && existing.redColumns) || {};

  const leadIds = targetConfig.leadingColumns.map(c => c.id);
  const unidadTargetId = ['unidad', 'unid', 'cant'].find(id => leadIds.includes(id));

  let targetRow = rows.find(r => r.rescheduleId === pending.rescheduleId);
  if (targetRow) {
    // Ya existía (de un intento anterior de este mismo reagendado): se
    // actualizan SOLO estos 3 campos, todo lo demás de la fila queda
    // intacto (casillas, marcas, color de fila, etc.). NUNCA se
    // sobrescriben casillas ya marcadas en esa fila.
    console.log('[RESCHEDULE] fila destino ya existía (reintento) — actualizando solo doctor/desc/unidad');
    targetRow.cells = { ...targetRow.cells };
    if (leadIds.includes('doctor')) targetRow.cells['doctor'] = pending.doctor;
    if (leadIds.includes('desc')) targetRow.cells['desc'] = pending.descripcion;
    if (unidadTargetId) targetRow.cells[unidadTargetId] = pending.unidad;
  } else {
    console.log('[RESCHEDULE] creando fila nueva en destino con doctor/desc/unidad únicamente');
    targetRow = defaultRow();
    targetRow.rescheduleId = pending.rescheduleId;
    const cellsToCopy = {};
    if (leadIds.includes('doctor')) cellsToCopy['doctor'] = pending.doctor;
    if (leadIds.includes('desc')) cellsToCopy['desc'] = pending.descripcion;
    if (unidadTargetId) cellsToCopy[unidadTargetId] = pending.unidad;
    targetRow.cells = cellsToCopy;
    rows.push(targetRow);
  }

  console.log('[RESCHEDULE] Firebase write START', { targetAgendaId: pending.targetAgendaId, targetDateKey: pending.targetDateKey, totalFilas: rows.length });
  try {
    await fetchWithRetry(
      () => autosaveAgendaDay(uid, pending.targetAgendaId, pending.targetDateKey, { rows, extraColumns, meta, redColumns }),
      { retries: 4, delayMs: 900, label: 'reagendar' }
    );
    console.log('[RESCHEDULE] Firebase write SUCCESS');
  } catch (writeErr) {
    console.error('[RESCHEDULE] Firebase write ERROR:', writeErr);
    throw writeErr;
  }

  console.log('[RESCHEDULE] updating cache');
  markAgendaAsSynced(storageAgendaId);
  cacheAgendaDayWrite(pending.targetAgendaId, pending.targetDateKey, { rows, extraColumns, meta, redColumns });

  console.log('[RESCHEDULE] updating destination panel');
  const openPanel = panels[targetInstanceKey];
  console.log('[RESCHEDULE] DESTINATION PANEL', {
    targetInstanceKey,
    panelExists: !!openPanel,
    panelAgendaId: openPanel ? openPanel.agendaId : null,
    panelDateKey: openPanel ? openPanel.dateKey : null,
    esperadoAgendaId: pending.targetAgendaId,
    esperadoDateKey: pending.targetDateKey
  });
  if (openPanel && openPanel.agendaId === pending.targetAgendaId && openPanel.dateKey === pending.targetDateKey) {
    // Si la agenda destino (misma agenda + mismo día) ya está abierta en
    // pantalla, se actualiza SOLO esa fila puntual (doctor/desc/unidad) —
    // nunca se reemplaza toda la tabla ni se toca la estructura de
    // columnas/config del panel, que sigue siendo la del destino. Nunca
    // se pisan casillas/marcas ya existentes en esa fila.
    let liveRow = openPanel.rows.find(r => r.rescheduleId === pending.rescheduleId);
    if (liveRow) {
      liveRow.cells = { ...liveRow.cells, ...targetRow.cells };
    } else {
      openPanel.rows.push({ ...targetRow, cells: { ...targetRow.cells } });
    }
    console.log('[RESCHEDULE] BEFORE RENDER (panel destino abierto en esta pestaña)');
    renderBody(targetInstanceKey);
    renderFooter(targetInstanceKey);
    updatePointsBadge(targetInstanceKey);
  } else {
    console.log('[RESCHEDULE] panel destino no está abierto en esta pestaña ahora mismo — se verá al abrirlo (caché reciente o carga en segundo plano de Firestore)');
  }
  console.log('[RESCHEDULE] COMPLETE', pending.rescheduleId);
}

/**
 * Reintenta todos los reagendados que quedaron pendientes (p. ej. porque
 * Firebase estaba offline cuando se intentaron). Se llama al abrir
 * Agendas y al recuperar la conexión — nunca depende únicamente de un
 * setTimeout suelto. Idempotente: reintentar un pending ya confirmado no
 * duplica nada gracias a rescheduleId.
 */
let flushingRescheduleQueue = false;
async function flushRescheduleQueue(uid) {
  if (flushingRescheduleQueue) return;
  flushingRescheduleQueue = true;
  try {
    const queue = getRescheduleQueue();
    for (const pending of queue) {
      try {
        await performReschedule(uid, pending);
        dequeueReschedule(pending.rescheduleId);
      } catch (e) {
        console.error('[RESCHEDULE] ERROR:', pending.rescheduleId, e);
      }
    }
  } finally {
    flushingRescheduleQueue = false;
  }
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
      const payload = {
        rows: state.rows, extraColumns: state.extraColumns, meta: state.meta, redColumns: state.redColumns
      };
      const payloadJson = JSON.stringify(payload);
      saveAgendaDraft(state.agendaId, state.dateKey, payload);
      try {
        await fetchWithRetry(() => saveAgendaDay(state.uid, state.agendaId, state.dateKey, payload), { label: 'guardar agenda' });
        markAgendaAsSynced(state.storageAgendaId);
        cacheAgendaDayWrite(state.agendaId, state.dateKey, payload);
        // Igual que en el autoguardado: solo se borra si el borrador
        // sigue siendo EXACTAMENTE el que se acaba de confirmar — si el
        // usuario editó de nuevo mientras esta escritura estaba en
        // curso, ese borrador más nuevo no se toca aquí.
        const stillCurrent = getAgendaDraft(state.agendaId, state.dateKey);
        if (stillCurrent && JSON.stringify(stillCurrent.data) === payloadJson) {
          clearAgendaDraft(state.agendaId, state.dateKey);
        }
        setSaveStatus(key, 'Guardado ✓', 'saved');
        showToast(state.label ? `Agenda (${state.label}) guardada en el historial` : 'Agenda guardada en el historial');
      } catch (e) {
        console.error(`Error al guardar agenda (${state.agendaId}${suf(key)}):`, e);
        setSaveStatus(key, 'No se pudo guardar — se reintentará solo (tus cambios están a salvo localmente)', 'error');
        showToast(describeFirestoreError(e), true);
      }
    };
  }

  const colorPicker = g('cell-color-picker', key);
  if (colorPicker) {
    colorPicker.querySelectorAll('[data-color]').forEach(btn => {
      btn.onclick = () => {
        const state = panels[key];
        if (!state) return;
        if (!state.selectedRowId) {
          showToast('Primero haz clic en una fila para seleccionarla', true);
          return;
        }
        const row = state.rows.find(r => r.id === state.selectedRowId);
        if (!row) return;
        const colorKey = btn.dataset.color;
        row.rowColor = (row.rowColor === colorKey) ? null : colorKey;
        renderBody(key);
        renderFooter(key);
        scheduleAutosave(key);
      };
    });
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
      const payload = {
        rows: state.rows, extraColumns: state.extraColumns, meta: state.meta, redColumns: state.redColumns
      };
      const payloadJson = JSON.stringify(payload);
      try {
        await fetchWithRetry(() => autosaveAgendaDay(state.uid, state.agendaId, state.dateKey, payload), { retries: 1, label: 'autoguardado' });
        markAgendaAsSynced(state.storageAgendaId);
        cacheAgendaDayWrite(state.agendaId, state.dateKey, payload);
        // Solo se borra el borrador local si sigue siendo EXACTAMENTE el
        // mismo que se acaba de confirmar — si el usuario volvió a editar
        // mientras esta escritura estaba en curso, scheduleAutosave ya
        // guardó un borrador más nuevo, y ese no se toca aquí (Firestore
        // lo recibirá en el próximo ciclo del debounce).
        const stillCurrent = getAgendaDraft(state.agendaId, state.dateKey);
        if (stillCurrent && JSON.stringify(stillCurrent.data) === payloadJson) {
          clearAgendaDraft(state.agendaId, state.dateKey);
        }
        setSaveStatus(key, 'Guardado automáticamente', 'saved');
      } catch (e) {
        console.error(`Error en autoguardado (${state.agendaId}${suf(key)}):`, e);
        // El borrador NO se toca: sigue en localStorage tal cual, listo
        // para reintentarse (flushAgendaDrafts) sin perder nada.
        setSaveStatus(key, 'No se pudo guardar — se reintentará solo (tus cambios están a salvo localmente)', 'error');
      }
    }, 1500);
  }
  return autosaveFns[key];
}

function scheduleAutosave(key) {
  const state = panels[key];
  if (state) {
    // Se guarda de inmediato, de forma síncrona — nunca hay una ventana
    // en la que el usuario ya editó pero todavía no exista un borrador
    // duradero. El envío real a Firestore sigue debounced (abajo).
    saveAgendaDraft(state.agendaId, state.dateKey, {
      rows: state.rows, extraColumns: state.extraColumns, meta: state.meta, redColumns: state.redColumns
    });
  }
  getAutosaveFn(key)();
}

let flushingAgendaDrafts = false;
/**
 * Reintenta enviar a Firestore todos los borradores duraderos pendientes
 * (de cualquier agenda+día, no solo la que está abierta ahora mismo) —
 * por ejemplo, los que quedaron sin confirmar porque Firestore estaba
 * offline en una sesión anterior y el navegador se cerró o se recargó la
 * página. Se salta cualquier agenda+día que ya tenga un panel abierto en
 * pantalla (ese panel ya se sincroniza solo con su propio autoguardado),
 * para no disparar dos escrituras simultáneas del mismo dato.
 */
async function flushAgendaDrafts(uid) {
  if (flushingAgendaDrafts) return;
  flushingAgendaDrafts = true;
  try {
    const drafts = listAgendaDrafts();
    for (const { agendaId, dateKey } of drafts) {
      const openInstanceKey = Object.keys(panels).find(k => {
        const p = panels[k];
        return p && p.agendaId === agendaId && p.dateKey === dateKey;
      });
      if (openInstanceKey !== undefined) continue;

      const draftBefore = getAgendaDraft(agendaId, dateKey);
      if (!draftBefore) continue;
      const draftBeforeDataJson = JSON.stringify(draftBefore.data);

      try {
        await fetchWithRetry(() => autosaveAgendaDay(uid, agendaId, dateKey, draftBefore.data), { retries: 1, delayMs: 700, label: 'sincronizar borrador' });
        cacheAgendaDayWrite(agendaId, dateKey, draftBefore.data);
        markAgendaAsSynced(agendaId);
        // Igual que en el autoguardado normal: solo se borra si nadie lo
        // cambió mientras se enviaba.
        const draftAfter = getAgendaDraft(agendaId, dateKey);
        if (draftAfter && JSON.stringify(draftAfter.data) === draftBeforeDataJson) {
          clearAgendaDraft(agendaId, dateKey);
        }
      } catch (e) {
        console.error('[DRAFT] No se pudo sincronizar un borrador pendiente todavía:', agendaId, dateKey, e);
      }
    }
  } finally {
    flushingAgendaDrafts = false;
  }
}

window.addEventListener('online', () => {
  const currentUser = getCurrentUser();
  if (currentUser) {
    flushAgendaDrafts(currentUser.uid);
    flushRescheduleQueue(currentUser.uid);
  }
});
