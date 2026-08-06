// ============================================================================
// control-general.js — módulo de gestión de registros/casos, organizado por
// MES (agosto 2026 → diciembre 2027). Un documento por registro en Firestore
// (users/{uid}/controlGeneral/{id}), con un campo `monthKey` ("AAAA-MM") que
// indica a qué mes pertenece la fila. Usa los catálogos de Datos para
// alimentar sus listas desplegables.
// ============================================================================

import { getCurrentUser } from './auth.js?v12';
import {
  listControlGeneral, saveControlGeneralRecord, deleteControlGeneralRecord,
  getAgendaDay, autosaveAgendaDay
} from './data-store.js?v12';
import { getAgendaConfig, defaultRow } from './agenda-configs.js?v12';
import { ensureCatalogsLoaded, getCatalogItems } from './datos.js?v12';
import { UNIDADES_1_32 } from './datos-seed.js?v12';
import {
  escapeHtml, debounce, toNumber, round2, generateId, dateKeyToday,
  getAvailableMonths, MESES_ES, capitalize, getGuatemalaParts,
  fetchWithRetry, describeFirestoreError
} from './utils.js?v12';
import { openModal, closeModal, showToast } from './ui-helpers.js?v12';

let records = [];        // TODOS los registros del usuario (una sola carga por sesión)
let uid = null;
let loaded = false;
let loadingPromise = null;
let searchText = '';
let currentMonthKey = null; // null = pantalla de selección de mes
const autosaveFns = {};

// Fila → agenda destino: doctor/px, descripción y cantidad se copian tal cual.
const AGREGAR_TARGETS = [
  { label: 'Metales', agendaId: 'abner' },
  { label: 'Pretallado', agendaId: 'eliu' },
  { label: 'Tallado', agendaId: 'astryd' },
  { label: 'Yesos', agendaId: 'cony' },
  { label: 'Encerado', agendaId: 'dina' }
];

function emptyRecord(monthKey) {
  return {
    id: generateId('cg'),
    monthKey,
    fechaIngreso: '',
    noOrden: '',
    factEstimado: '',
    doctor: '',
    paciente: '',
    descripcion: '',
    unidades: '',
    costo: '',
    color: '',
    fecha1: '',
    abono1: '',
    fecha2: '',
    abono2: '',
    fecha3: '',
    abono3: '',
    etapa: '',
    correccion: '',
    destino: '',
    fechaRequerida: '',
    fechaSalida: '',
    observaciones: '',
    status: ''
  };
}

function computeTotal(rec) { return round2(toNumber(rec.unidades) * toNumber(rec.costo)); }
function computeAbonoAcumulado(rec) { return round2(toNumber(rec.abono1) + toNumber(rec.abono2) + toNumber(rec.abono3)); }
function computeSaldo(rec) { return round2(computeTotal(rec) - computeAbonoAcumulado(rec)); }
function computeTiempo(rec) {
  if (!rec.fechaRequerida || !rec.fechaSalida) return '';
  const a = new Date(rec.fechaRequerida + 'T00:00:00');
  const b = new Date(rec.fechaSalida + 'T00:00:00');
  if (isNaN(a) || isNaN(b)) return '';
  return Math.round((b - a) / 86400000);
}

// ----------------------------------------------------------------------------
async function loadRecordsOnce() {
  if (loaded) return records;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    records = await fetchWithRetry(() => listControlGeneral(uid), { label: 'control general' });
    loaded = true;
    return records;
  })();
  try { return await loadingPromise; } finally { loadingPromise = null; }
}

export async function renderControlGeneral(navigate) {
  const container = document.getElementById('cg-container');
  if (!container) return;

  const user = getCurrentUser();
  if (!user) { showToast('Tu sesión no está activa. Vuelve a iniciar sesión.', true); return; }
  uid = user.uid;

  currentMonthKey = null;
  paintMonthSelect();

  // Catálogos y registros se cargan en segundo plano (no bloquean la
  // pantalla de selección de mes) y se reutilizan sin volver a pedirlos a
  // Firebase mientras dure la sesión.
  ensureCatalogsLoaded(uid).catch(() => {});
  loadRecordsOnce().catch(e => {
    console.error('Error al cargar Control General:', e);
    showToast(describeFirestoreError(e), true);
  });
}

// ----------------------------------------------------------------------------
// Selección de mes (agosto 2026 → diciembre 2027)
// ----------------------------------------------------------------------------
function paintMonthSelect() {
  const container = document.getElementById('cg-container');
  const months = getAvailableMonths();
  const now = getGuatemalaParts();

  container.innerHTML = `
    <p class="select-prompt">¿A qué mes deseas acceder?</p>
    <div class="month-grid" id="cg-month-grid">
      ${months.map(m => {
        const isCurrent = m.year === now.year && m.month === now.month;
        return `
          <button class="month-tile ${isCurrent ? 'is-current' : ''}" data-month="${m.key}">
            <div class="m-name">${MESES_ES[m.month - 1]}</div>
            <div class="m-year">${m.year}</div>
          </button>`;
      }).join('')}
    </div>
  `;

  container.querySelectorAll('[data-month]').forEach(btn => {
    btn.addEventListener('click', () => openMonth(btn.dataset.month));
  });
}

async function openMonth(monthKey) {
  currentMonthKey = monthKey;
  searchText = '';
  showMonthLoading();
  await Promise.all([ensureCatalogsLoaded(uid), loadRecordsOnce()]);
  paintMonthTable();
}

function showMonthLoading() {
  const container = document.getElementById('cg-container');
  if (!container || document.getElementById('cg-month-loading')) return;
  const loadingEl = document.createElement('div');
  loadingEl.id = 'cg-month-loading';
  loadingEl.className = 'empty-state';
  loadingEl.style.marginTop = '14px';
  loadingEl.innerHTML = '<div class="spinner" style="margin:0 auto;"></div><p style="margin-top:10px;">Cargando…</p>';
  container.appendChild(loadingEl);
}

// ----------------------------------------------------------------------------
// Tabla del mes seleccionado
// ----------------------------------------------------------------------------
function monthRecords() {
  return records.filter(r => r.monthKey === currentMonthKey);
}

function filteredRecords() {
  const list = monthRecords();
  if (!searchText.trim()) return list;
  const q = searchText.trim().toLowerCase();
  return list.filter(r =>
    String(r.noOrden || '').toLowerCase().includes(q) ||
    String(r.paciente || '').toLowerCase().includes(q) ||
    String(r.doctor || '').toLowerCase().includes(q) ||
    String(r.destino || '').toLowerCase().includes(q)
  );
}

function datalistHtml(id, items) {
  return `<datalist id="${id}">${items.map(v => `<option value="${escapeHtml(String(v))}">`).join('')}</datalist>`;
}

function paintMonthTable() {
  const container = document.getElementById('cg-container');
  const [y, m] = currentMonthKey.split('-').map(Number);
  const monthLabel = `${capitalize(MESES_ES[m - 1])} ${y}`;

  const doctores = getCatalogItems('doctores');
  const etapas = getCatalogItems('etapas');
  const destinos = getCatalogItems('destinos');
  const correcciones = getCatalogItems('correccion');
  const costos = getCatalogItems('costos');

  container.innerHTML = `
    <button class="back-link" id="cg-back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      Control General
    </button>
    <div class="agenda-header-bar">
      <div class="agenda-title-block">
        <h2>${escapeHtml(monthLabel)}</h2>
        <div class="agenda-subtitle">Registro de casos del mes — costos, abonos y estado.</div>
      </div>
      <div class="agenda-toolbar">
        <input type="text" id="cg-search" class="datos-search" style="min-width:260px;" placeholder="Buscar por No. orden, paciente, doctor o destino…" value="${escapeHtml(searchText)}">
        <button class="btn btn-brass btn-sm" id="cg-save">Guardar</button>
      </div>
    </div>
    <div class="table-scroll">
      <table class="agenda-table cg-table" id="cg-table">
        <thead>
          <tr>
            <th>Fecha ingreso</th><th>No. Orden</th><th>Fact. Estimado</th><th class="col-doctor">Doctor</th>
            <th class="col-desc">Paciente</th><th class="col-desc">Descripción</th><th>Unidades</th>
            <th>Costo C/U</th><th>Color</th><th class="col-desc">Etapa</th><th class="col-desc">Corr/Rep</th>
            <th class="col-desc">Destino</th><th>F. Requerida</th><th>F. Salida</th><th>Tiempo</th>
            <th>Total</th><th>Abono Acum.</th><th class="col-desc">Observaciones</th><th>Fecha 1</th><th>Abono</th><th>Fecha 2</th><th>Abono</th><th>Fecha 3</th><th>Abono</th><th>Saldo</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody id="cg-tbody"></tbody>
      </table>
    </div>
    <div class="agenda-footer-bar">
      <button class="btn btn-ghost btn-sm add-row-btn" id="cg-add-row">+ Agregar fila</button>
      <span class="save-status" id="cg-save-status"></span>
    </div>
    ${datalistHtml('cg-dl-doctor', doctores)}
    ${datalistHtml('cg-dl-etapa', etapas)}
    ${datalistHtml('cg-dl-destino', destinos)}
    ${datalistHtml('cg-dl-correccion', correcciones)}
    ${datalistHtml('cg-dl-costo', costos)}
  `;

  document.getElementById('cg-back').addEventListener('click', () => {
    currentMonthKey = null;
    paintMonthSelect();
  });
  document.getElementById('cg-search').addEventListener('input', (e) => {
    searchText = e.target.value;
    paintRows();
  });
  document.getElementById('cg-add-row').addEventListener('click', addNewRow);
  document.getElementById('cg-save').addEventListener('click', saveAllMonth);

  paintRows();
}

function paintRows() {
  const tbody = document.getElementById('cg-tbody');
  if (!tbody) return;
  const statuses = getCatalogItems('status');
  const list = filteredRecords();

  tbody.innerHTML = list.length
    ? list.map((rec, idx) => rowHtml(rec, statuses, idx)).join('')
    : `<tr><td colspan="27"><div class="empty-state">Sin registros este mes. Usa "+ Agregar fila" para empezar.</div></td></tr>`;

  wireRowEvents();
}

function rowHtml(rec, statuses, idx) {
  const total = computeTotal(rec);
  const abonoAcum = computeAbonoAcumulado(rec);
  const saldo = computeSaldo(rec);
  const tiempo = computeTiempo(rec);
  const isCancelado = (rec.status || '').toUpperCase() === 'CANCELADO';

  return `
    <tr data-id="${rec.id}" data-idx="${idx}" class="${isCancelado ? 'cg-row-cancelado' : ''}">
      <td><input type="date" class="cell-text" data-f="fechaIngreso" value="${escapeHtml(rec.fechaIngreso || '')}"></td>
      <td><input type="text" class="cell-text" data-f="noOrden" value="${escapeHtml(rec.noOrden || '')}" style="min-width:80px;"></td>
      <td><input type="text" class="cell-text" data-f="factEstimado" value="${escapeHtml(rec.factEstimado || '')}" style="min-width:90px;"></td>
      <td class="col-doctor"><input type="text" class="cell-text" list="cg-dl-doctor" data-f="doctor" value="${escapeHtml(rec.doctor || '')}" style="min-width:150px;"></td>
      <td class="col-desc"><input type="text" class="cell-text" data-f="paciente" value="${escapeHtml(rec.paciente || '')}" style="min-width:150px;"></td>
      <td class="col-desc"><input type="text" class="cell-text" data-f="descripcion" value="${escapeHtml(rec.descripcion || '')}" style="min-width:150px;"></td>
      <td>
        <select class="cell-text" data-f="unidades">
          <option value="">—</option>
          ${UNIDADES_1_32.map(n => `<option value="${n}" ${String(rec.unidades) === String(n) ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </td>
      <td><input type="number" step="0.01" class="cell-text" list="cg-dl-costo" data-f="costo" value="${rec.costo !== '' && rec.costo != null ? rec.costo : ''}" style="min-width:80px;"></td>
      <td><input type="text" class="cell-text" data-f="color" value="${escapeHtml(rec.color || '')}" style="min-width:100px;"></td>
      <td class="col-desc"><input type="text" class="cell-text" list="cg-dl-etapa" data-f="etapa" value="${escapeHtml(rec.etapa || '')}" style="min-width:140px;"></td>
      <td class="col-desc"><input type="text" class="cell-text" list="cg-dl-correccion" data-f="correccion" value="${escapeHtml(rec.correccion || '')}" style="min-width:140px;"></td>
      <td class="col-desc"><input type="text" class="cell-text" list="cg-dl-destino" data-f="destino" value="${escapeHtml(rec.destino || '')}" style="min-width:150px;"></td>
      <td><input type="date" class="cell-text" data-f="fechaRequerida" value="${escapeHtml(rec.fechaRequerida || '')}"></td>
      <td><input type="date" class="cell-text" data-f="fechaSalida" value="${escapeHtml(rec.fechaSalida || '')}"></td>
      <td class="cell-total mono">${tiempo === '' ? '—' : tiempo}</td>
      <td class="cell-total mono">Q${total.toFixed(2)}</td>
      <td class="cell-total mono">Q${abonoAcum.toFixed(2)}</td>
      <td class="col-desc"><input type="text" class="cell-text" data-f="observaciones" value="${escapeHtml(rec.observaciones || '')}" style="min-width:150px;"></td>
      <td><input type="date" class="cell-text" data-f="fecha1" value="${escapeHtml(rec.fecha1 || '')}"></td>
      <td><input type="number" step="0.01" class="cell-text" data-f="abono1" value="${rec.abono1 !== '' && rec.abono1 != null ? rec.abono1 : ''}" style="min-width:80px;"></td>
      <td><input type="date" class="cell-text" data-f="fecha2" value="${escapeHtml(rec.fecha2 || '')}"></td>
      <td><input type="number" step="0.01" class="cell-text" data-f="abono2" value="${rec.abono2 !== '' && rec.abono2 != null ? rec.abono2 : ''}" style="min-width:80px;"></td>
      <td><input type="date" class="cell-text" data-f="fecha3" value="${escapeHtml(rec.fecha3 || '')}"></td>
      <td><input type="number" step="0.01" class="cell-text" data-f="abono3" value="${rec.abono3 !== '' && rec.abono3 != null ? rec.abono3 : ''}" style="min-width:80px;"></td>
      <td class="cell-total mono ${saldo > 0 ? 'cg-saldo-pendiente' : 'cg-saldo-ok'}">Q${saldo.toFixed(2)}</td>
      <td>
        <select class="cell-text" data-f="status">
          <option value="">—</option>
          ${statuses.map(s => `<option value="${escapeHtml(s)}" ${rec.status === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
        </select>
      </td>
      <td class="row-actions-col">
        <button class="row-agregar-btn" data-agregar="${rec.id}" title="Agregar a una agenda">→</button>
        <button class="row-delete-btn" data-delrec="${rec.id}" title="Eliminar registro">✕</button>
      </td>
    </tr>
  `;
}

function wireRowEvents() {
  const tbody = document.getElementById('cg-tbody');
  if (!tbody) return;

  tbody.querySelectorAll('[data-f]').forEach(input => {
    input.addEventListener('input', onFieldChange);
    input.addEventListener('change', onFieldChange);
  });

  tbody.querySelectorAll('[data-agregar]').forEach(btn => {
    btn.addEventListener('click', () => openAgregarModal(btn.dataset.agregar));
  });

  tbody.querySelectorAll('[data-delrec]').forEach(btn => {
    btn.addEventListener('click', () => deleteRecord(btn.dataset.delrec));
  });
}

function onFieldChange(e) {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const rec = records.find(r => r.id === tr.dataset.id);
  if (!rec) return;
  rec[e.target.dataset.f] = e.target.value;
  refreshRowTotalsOnly(tr, rec);
  scheduleAutosave(rec);
}

function refreshRowTotalsOnly(tr, rec) {
  const total = computeTotal(rec);
  const abonoAcum = computeAbonoAcumulado(rec);
  const saldo = computeSaldo(rec);
  const tiempo = computeTiempo(rec);
  const totals = tr.querySelectorAll('.cell-total');
  if (totals[0]) totals[0].textContent = (tiempo === '' ? '—' : tiempo);
  if (totals[1]) totals[1].textContent = `Q${total.toFixed(2)}`;
  if (totals[2]) totals[2].textContent = `Q${abonoAcum.toFixed(2)}`;
  if (totals[3]) {
    totals[3].textContent = `Q${saldo.toFixed(2)}`;
    totals[3].classList.toggle('cg-saldo-pendiente', saldo > 0);
    totals[3].classList.toggle('cg-saldo-ok', saldo <= 0);
  }
  tr.classList.toggle('cg-row-cancelado', (rec.status || '').toUpperCase() === 'CANCELADO');
}

// ----------------------------------------------------------------------------
// "+ Agregar fila" — reemplaza al antiguo "Nuevo registro"
// ----------------------------------------------------------------------------
function setSaveStatus(text, cls) {
  const el = document.getElementById('cg-save-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'save-status' + (cls ? ' ' + cls : '');
}

async function saveAllMonth() {
  setSaveStatus('Guardando…', 'saving');
  try {
    const list = monthRecords();
    for (const rec of list) {
      await fetchWithRetry(() => saveControlGeneralRecord(uid, rec.id, { ...rec }), { retries: 1, label: 'guardar registro' });
    }
    setSaveStatus('Guardado ✓', 'saved');
    showToast('Control General guardado');
  } catch (e) {
    console.error('Error al guardar Control General:', e);
    setSaveStatus('Error al guardar', 'error');
    showToast(describeFirestoreError(e), true);
  }
}

function addNewRow() {
  const rec = emptyRecord(currentMonthKey);
  records.push(rec);
  saveRecordNow(rec);
  paintRows();
  showToast('Fila agregada');
}

function deleteRecord(id) {
  if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
  records = records.filter(r => r.id !== id);
  paintRows();
  fetchWithRetry(() => deleteControlGeneralRecord(uid, id), { retries: 1, label: 'eliminar registro' })
    .then(() => showToast('Registro eliminado'))
    .catch(e => { console.error('Error al eliminar registro:', e); showToast(describeFirestoreError(e), true); });
}

function saveRecordNow(rec) {
  fetchWithRetry(() => saveControlGeneralRecord(uid, rec.id, { ...rec }), { retries: 1, label: 'guardar registro' })
    .catch(e => console.error('Error al guardar registro:', e));
}

function scheduleAutosave(rec) {
  if (!autosaveFns[rec.id]) {
    autosaveFns[rec.id] = debounce(() => {
      fetchWithRetry(() => saveControlGeneralRecord(uid, rec.id, { ...rec }), { retries: 1, label: 'guardar registro' })
        .catch(e => { console.error('Error al guardar registro:', e); showToast(describeFirestoreError(e), true); });
    }, 900);
  }
  autosaveFns[rec.id]();
}

// ----------------------------------------------------------------------------
// Botón "AGREGAR" por fila → crear fila en la agenda del día correspondiente,
// en la misma posición lógica (índice) dentro de esa agenda.
// ----------------------------------------------------------------------------
function openAgregarModal(recId) {
  const rec = records.find(r => r.id === recId);
  if (!rec) return;
  const idx = filteredRecords().findIndex(r => r.id === recId);

  const box = openModal(`
    <h3>Agregar a una agenda</h3>
    <p>Se creará una fila nueva con Doctor/PX, Descripción y Cantidad. Los demás campos quedan vacíos para editar ahí.</p>
    <div class="modal-actions" style="flex-wrap:wrap;justify-content:center;">
      ${AGREGAR_TARGETS.map(t => `<button class="btn btn-outline" data-target="${t.agendaId}">${escapeHtml(t.label)}</button>`).join('')}
    </div>
  `);
  box.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', async () => {
      closeModal();
      try {
        await addRowToAgenda(btn.dataset.target, rec, idx);
        const target = AGREGAR_TARGETS.find(t => t.agendaId === btn.dataset.target);
        showToast(`Fila agregada a la agenda de ${target ? target.label : btn.dataset.target}`);
      } catch (e) {
        console.error('Error al agregar fila a la agenda:', e);
        showToast(describeFirestoreError(e), true);
      }
    });
  });
}

async function addRowToAgenda(targetAgendaId, rec, position) {
  const targetConfig = getAgendaConfig(targetAgendaId);
  if (!targetConfig) return;

  const baseDateKey = rec.fechaIngreso || dateKeyToday();
  const dateKey = targetConfig.splitAmPm ? `${baseDateKey}-AM` : baseDateKey;

  const existing = await fetchWithRetry(() => getAgendaDay(uid, targetAgendaId, dateKey), { retries: 1, label: 'agregar fila' });
  const rows = (existing && existing.rows) ? [...existing.rows] : [];
  const extraColumns = (existing && existing.extraColumns) || [];
  const meta = (existing && existing.meta) || {};

  const newRow = defaultRow();
  const leadIds = targetConfig.leadingColumns.map(c => c.id);
  if (leadIds.includes('doctor')) newRow.cells['doctor'] = rec.doctor || '';
  if (leadIds.includes('desc')) newRow.cells['desc'] = rec.descripcion || '';
  const unidadTargetId = ['unidad', 'unid', 'cant'].find(id => leadIds.includes(id));
  if (unidadTargetId) newRow.cells[unidadTargetId] = rec.unidades || '';

  const insertAt = Math.max(0, Math.min(position >= 0 ? position : rows.length, rows.length));
  rows.splice(insertAt, 0, newRow);

  await fetchWithRetry(
    () => autosaveAgendaDay(uid, targetAgendaId, dateKey, { rows, extraColumns, meta }),
    { retries: 1, label: 'agregar fila' }
  );
}