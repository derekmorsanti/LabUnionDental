// ============================================================================
// control-general.js — módulo de gestión de registros/casos, organizado por
// MES (agosto 2026 → diciembre 2027). Un documento por registro en Firestore
// (users/{uid}/controlGeneral/{id}), con un campo `monthKey` ("AAAA-MM") que
// indica a qué mes pertenece la fila. Usa los catálogos de Datos para
// alimentar sus listas desplegables.
// ============================================================================

import { getCurrentUser } from './auth.js?v23';
import {
  listControlGeneral, saveControlGeneralRecord, deleteControlGeneralRecord,
  getAgendaDay, autosaveAgendaDay
} from './data-store.js?v23';
import { getAgendaConfig, defaultRow } from './agenda-configs.js?v23';
import { ensureCatalogsLoaded, getCatalogItems } from './datos.js?v23';
import { UNIDADES_1_32 } from './datos-seed.js?v23';
import {
  escapeHtml, debounce, toNumber, round2, generateId, dateKeyToday,
  getAvailableMonths, MESES_ES, capitalize, getGuatemalaParts,
  fetchWithRetry, describeFirestoreError
} from './utils.js?v23';
import { openModal, closeModal, showToast } from './ui-helpers.js?v23';

let records = [];        // TODOS los registros del usuario (una sola carga por sesión)
let uid = null;
let loaded = false;
let loadingPromise = null;
let searchText = '';
let currentMonthKey = null; // null = pantalla de selección de mes
const autosaveFns = {};
let resumenVisible = false;
let selectedDoctor = null;

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
// Selección de mes (enero 2026 → diciembre 2028)
// ----------------------------------------------------------------------------
function paintMonthSelect() {
  const container = document.getElementById('cg-container');
  const months = getAvailableMonths(2026, 1, 2028, 12);
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
        <button class="btn btn-outline btn-sm" id="cg-resumen-btn">${resumenVisible ? 'Ocultar resumen' : 'Resumen por Doctor'}</button>
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
            <th>Total</th><th>Abono Acum.</th><th>Fecha 1</th><th>Abono</th><th>Fecha 2</th><th>Abono</th><th>Fecha 3</th><th>Abono</th><th>PEND. DE PAGAR</th><th>Status</th><th class="col-desc">Observaciones</th><th></th>
          </tr>
        </thead>
        <tbody id="cg-tbody"></tbody>
      </table>
    </div>
    <div class="agenda-footer-bar">
      <button class="btn btn-ghost btn-sm add-row-btn" id="cg-add-row">+ Agregar fila</button>
      <span class="save-status" id="cg-save-status"></span>
    </div>
    <div id="cg-resumen-container"></div>
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
  document.getElementById('cg-resumen-btn').addEventListener('click', toggleResumenDoctores);

  paintRows();
  if (resumenVisible) renderResumenDoctores();
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
      <td class="col-desc"><input type="text" class="cell-text" data-f="observaciones" value="${escapeHtml(rec.observaciones || '')}" style="min-width:150px;"></td>
      <td class="row-actions-col">
        <button class="row-agregar-btn" data-agregar="${rec.id}" title="Agregar a una agenda">→</button>
        <button class="row-delete-btn" data-delrec="${rec.id}" title="Eliminar registro">✕</button>
      </td>
    </tr>
  `;
}

function wireRowEvents() {
  const tbody = document.getElementById('cg-tbody');
  if (!tbody || tbody.dataset.delegated === '1') return;
  tbody.dataset.delegated = '1';

  tbody.addEventListener('input', (e) => {
    const input = e.target.closest('[data-f]');
    if (!input) return;
    onFieldChange(e);
  });
  tbody.addEventListener('change', (e) => {
    const input = e.target.closest('[data-f]');
    if (!input) return;
    onFieldChange(e);
  });

  tbody.addEventListener('click', (e) => {
    const agregarBtn = e.target.closest('[data-agregar]');
    if (agregarBtn) { openAgregarModal(agregarBtn.dataset.agregar); return; }
    const delBtn = e.target.closest('[data-delrec]');
    if (delBtn) { deleteRecord(delBtn.dataset.delrec); return; }
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
  refreshResumenIfVisible();
  showToast('Fila agregada');
}

function deleteRecord(id) {
  if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
  records = records.filter(r => r.id !== id);
  paintRows();
  refreshResumenIfVisible();
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
        .then(() => refreshResumenIfVisible())
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

// ----------------------------------------------------------------------------
// RESUMEN POR DOCTOR + ESTADO DE CUENTA
// Reutiliza `records` (ya cargados en memoria por loadRecordsOnce) y las
// funciones de cálculo existentes (computeTotal/computeAbonoAcumulado/
// computeSaldo). No vuelve a pedir nada a Firestore.
// ----------------------------------------------------------------------------
function toggleResumenDoctores() {
  resumenVisible = !resumenVisible;
  const btn = document.getElementById('cg-resumen-btn');
  if (btn) btn.textContent = resumenVisible ? 'Ocultar resumen' : 'Resumen por Doctor';
  const container = document.getElementById('cg-resumen-container');
  if (!container) return;
  if (!resumenVisible) {
    container.innerHTML = '';
    selectedDoctor = null;
    return;
  }
  renderResumenDoctores();
}

function computeDoctorSummary() {
  const map = new Map();
  for (const rec of records) {
    const doctor = (rec.doctor || '').trim();
    if (!doctor) continue;
    const total = computeTotal(rec);
    const abonado = computeAbonoAcumulado(rec);
    const saldo = round2(total - abonado);
    const entry = map.get(doctor) || { doctor, totalGenerado: 0, totalAbonado: 0, saldoPendiente: 0 };
    entry.totalGenerado = round2(entry.totalGenerado + total);
    entry.totalAbonado = round2(entry.totalAbonado + abonado);
    entry.saldoPendiente = round2(entry.saldoPendiente + saldo);
    map.set(doctor, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.saldoPendiente - a.saldoPendiente);
}

function renderResumenDoctores() {
  const container = document.getElementById('cg-resumen-container');
  if (!container) return;
  const summary = computeDoctorSummary();

  container.innerHTML = `
    <div class="agenda-header-bar" style="margin-top:26px;">
      <div class="agenda-title-block">
        <h2>Resumen por Doctor</h2>
        <div class="agenda-subtitle">Totales acumulados de todos los registros cargados. Clic en un doctor para ver su estado de cuenta.</div>
      </div>
    </div>
    <div class="table-scroll">
      <table class="agenda-table" id="cg-resumen-table">
        <thead>
          <tr><th class="col-doctor">Doctor</th><th>Total</th><th>Abonado</th><th>PEND. DE PAGAR</th></tr>
        </thead>
        <tbody>
          ${summary.length ? summary.map(s => `
            <tr data-doctor="${escapeHtml(s.doctor)}" class="cg-doctor-row${selectedDoctor === s.doctor ? ' row-selected' : ''}">
              <td class="col-doctor">${escapeHtml(s.doctor)}</td>
              <td class="mono">Q${s.totalGenerado.toFixed(2)}</td>
              <td class="mono">Q${s.totalAbonado.toFixed(2)}</td>
              <td class="mono ${s.saldoPendiente > 0 ? 'cg-saldo-pendiente' : 'cg-saldo-ok'}">Q${s.saldoPendiente.toFixed(2)}</td>
            </tr>
          `).join('') : `<tr><td colspan="4"><div class="empty-state">No hay registros con doctor asignado.</div></td></tr>`}
        </tbody>
      </table>
    </div>
    <div id="cg-estado-cuenta-inline"></div>
  `;

  container.querySelectorAll('.cg-doctor-row').forEach(tr => {
    tr.addEventListener('click', () => handleDoctorClick(tr.dataset.doctor));
  });

  if (selectedDoctor && summary.some(s => s.doctor === selectedDoctor)) {
    renderEstadoCuenta(selectedDoctor);
  } else if (selectedDoctor) {
    selectedDoctor = null;
  }
}

function handleDoctorClick(doctor) {
  selectedDoctor = doctor;
  const container = document.getElementById('cg-resumen-container');
  if (container) {
    container.querySelectorAll('.cg-doctor-row').forEach(tr => {
      tr.classList.toggle('row-selected', tr.dataset.doctor === doctor);
    });
  }
  renderEstadoCuenta(doctor);
}

function formatIsoDateDMY(iso) {
  if (!iso) return '';
  const parts = String(iso).split('-');
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

function renderEstadoCuenta(doctor) {
  const inline = document.getElementById('cg-estado-cuenta-inline');
  if (!inline) return;

  const list = records.filter(r => (r.doctor || '').trim() === doctor);
  const pendientes = list.filter(r => (r.status || '').toUpperCase() !== 'CANCELADO');
  const cancelados = list.filter(r => (r.status || '').toUpperCase() === 'CANCELADO');

  let totalGeneral = 0, totalAbonado = 0, saldoPendiente = 0;
  for (const r of list) {
    totalGeneral = round2(totalGeneral + computeTotal(r));
    totalAbonado = round2(totalAbonado + computeAbonoAcumulado(r));
    saldoPendiente = round2(saldoPendiente + computeSaldo(r));
  }

  const sectionTotals = (arr) => arr.reduce((acc, r) => {
    acc.total = round2(acc.total + computeTotal(r));
    acc.abono = round2(acc.abono + computeAbonoAcumulado(r));
    acc.saldo = round2(acc.saldo + computeSaldo(r));
    return acc;
  }, { total: 0, abono: 0, saldo: 0 });

  const rowsHtml = (arr) => arr.map(r => `
    <tr>
      <td>${escapeHtml(formatIsoDateDMY(r.fechaIngreso) || '—')}</td>
      <td class="col-desc">${escapeHtml(r.paciente || '—')}</td>
      <td class="col-desc">${escapeHtml(r.descripcion || '—')}</td>
      <td class="mono">Q${computeTotal(r).toFixed(2)}</td>
      <td class="mono">Q${computeAbonoAcumulado(r).toFixed(2)}</td>
      <td class="mono ${computeSaldo(r) > 0 ? 'cg-saldo-pendiente' : 'cg-saldo-ok'}">Q${computeSaldo(r).toFixed(2)}</td>
    </tr>
  `).join('');

  const tableWithTotal = (arr, emptyLabel) => {
    const t = sectionTotals(arr);
    return `
      <div class="table-scroll">
        <table class="agenda-table">
          <thead><tr><th>Fecha</th><th class="col-desc">Paciente</th><th class="col-desc">Descripción</th><th>Total</th><th>Abono</th><th>PEND. DE PAGAR</th></tr></thead>
          <tbody>
            ${arr.length ? rowsHtml(arr) : `<tr><td colspan="6"><div class="empty-state">${emptyLabel}</div></td></tr>`}
            <tr class="cg-total-row">
              <td colspan="3">TOTAL</td>
              <td class="mono">Q${t.total.toFixed(2)}</td>
              <td class="mono">Q${t.abono.toFixed(2)}</td>
              <td class="mono ${t.saldo > 0 ? 'cg-saldo-pendiente' : 'cg-saldo-ok'}">Q${t.saldo.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  };

  const fechaLabel = formatIsoDateDMY(dateKeyToday());

  inline.innerHTML = `
    <div class="cg-estado-letterhead">
      <div class="cg-estado-doc-label">DR(A). ${escapeHtml(doctor)}</div>
      <img src="assets/images-removebg-preview.png" alt="Unión Dental" class="cg-estado-logo">
      <div class="cg-estado-fecha-label">FECHA: ${escapeHtml(fechaLabel)}</div>
    </div>
    <h3 style="margin:14px 0 8px;">Pendientes</h3>
    ${tableWithTotal(pendientes, 'Sin registros pendientes.')}
    <h3 style="margin:18px 0 8px;">Cancelados</h3>
    ${tableWithTotal(cancelados, 'Sin registros cancelados.')}
    <div class="agenda-footer-bar" style="margin-top:14px;gap:20px;">
      <span class="mono">Total General: Q${totalGeneral.toFixed(2)}</span>
      <span class="mono">Total Abonado: Q${totalAbonado.toFixed(2)}</span>
      <span class="mono ${saldoPendiente > 0 ? 'cg-saldo-pendiente' : 'cg-saldo-ok'}">PEND. DE PAGAR: Q${saldoPendiente.toFixed(2)}</span>
    </div>
  `;
}

function refreshResumenIfVisible() {
  if (!resumenVisible) return;
  renderResumenDoctores();
}