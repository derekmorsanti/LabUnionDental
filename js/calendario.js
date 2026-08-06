// ============================================================================
// calendario.js — selección de mes + vista mensual con notas por día.
// ============================================================================

import { getCurrentUser } from './auth.js?v12';
import { getCalendarMonth, saveCalendarMonth } from './data-store.js?v12';
import { forceReconnectFirestore } from './firebase-config.js?v12';
import { captureElementToImage } from './export.js?v12';
import { openModal, closeModal, showToast, openDownloadModal } from './ui-helpers.js?v12';
import {
  MESES_ES, getAvailableMonths, getMonthMeta, getGuatemalaParts,
  escapeHtml, capitalize, debounce, fetchWithRetry, describeFirestoreError, withTimeout
} from './utils.js?v12';

let monthState = { key: null, notes: {} };
// Token del mes que se está cargando: si el usuario navega a otro mes
// antes de que termine, esa respuesta tardía se descarta.
let monthToken = 0;
// true una vez que las notas guardadas de Firestore terminaron de cargar
// (o falló la carga) para el mes actualmente abierto.
let notesReady = false;

export function renderCalendarioSelect(navigate) {
  const grid = document.getElementById('calendario-month-grid');
  const months = getAvailableMonths();
  const now = getGuatemalaParts();
  grid.innerHTML = months.map(m => {
    const isCurrent = m.year === now.year && m.month === now.month;
    return `
      <button class="month-tile ${isCurrent ? 'is-current' : ''}" data-month="${m.key}">
        <div class="m-name">${MESES_ES[m.month - 1]}</div>
        <div class="m-year">${m.year}</div>
      </button>`;
  }).join('');
  grid.querySelectorAll('[data-month]').forEach(btn => {
    btn.addEventListener('click', () => navigate('calendario-month', btn.dataset.month));
  });
}

export async function renderCalendarioMonth(monthKey, navigate) {
  const myToken = ++monthToken;
  notesReady = false;

  const [y, m] = monthKey.split('-').map(Number);
  document.getElementById('calendario-month-title').textContent = `${capitalize(MESES_ES[m - 1])} ${y}`;

  const currentUser = getCurrentUser();
  if (!currentUser) { showToast('Tu sesión no está activa. Vuelve a iniciar sesión.', true); return; }
  const uid = currentUser.uid;

  // Pinta la rejilla del calendario de inmediato, sin esperar a Firestore,
  // para que siempre haya un calendario visible aunque la carga de notas
  // tarde o falle (p. ej. sin conexión) — igual que Agendas.
  monthState = { key: monthKey, notes: {} };
  paintGrid(y, m);

  const saveBtn = document.getElementById('btn-save-calendar');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.onclick = null; }
  setCalStatus('Cargando…', 'saving');

  document.getElementById('btn-download-calendar').onclick = () => {
    openDownloadModal(async (format) => {
      try {
        await captureElementToImage(document.getElementById('calendar-card'), `calendario_${monthState.key}`, format);
        showToast('Descarga iniciada');
      } catch (e) {
        showToast('No se pudo generar la imagen', true);
      }
    });
  };

  let notes = {};
  let loadError = null;
  try {
    notes = await withTimeout(
      fetchWithRetry(() => getCalendarMonth(uid, monthKey), { label: 'calendario' }),
      10000,
      'La carga del calendario tardó demasiado.'
    );
  } catch (e) {
    loadError = e;
    console.error('Error al cargar calendario:', e);
  }

  if (myToken !== monthToken) return;

  notesReady = true;
  // Combina las notas cargadas con cualquier nota que el usuario ya haya
  // escrito localmente mientras se esperaba la respuesta de Firestore.
  monthState = { key: monthKey, notes: { ...notes, ...monthState.notes } };
  paintGrid(y, m);

  if (saveBtn) { saveBtn.disabled = false; saveBtn.onclick = () => saveNow(); }

  if (loadError) {
    setCalStatus(
      `No se pudieron cargar las notas guardadas — esto NO significa que se hayan borrado. ${describeFirestoreError(loadError)}`,
      'error',
      async () => {
        setCalStatus('Reconectando…', 'saving');
        try { await forceReconnectFirestore(); } catch (_) {}
        renderCalendarioMonth(monthKey, navigate);
      }
    );
    showToast('No se pudieron cargar las notas del mes.', true);
  } else {
    setCalStatus('');
  }
}

function paintGrid(year, month) {
  const { firstWeekday, daysInMonth } = getMonthMeta(year, month);
  const today = getGuatemalaParts();
  const isCurrentMonth = today.year === year && today.month === month;

  const container = document.getElementById('calendar-days');
  let html = '';
  for (let i = 0; i < firstWeekday; i++) html += `<div class="calendar-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = isCurrentMonth && today.day === d;
    const note = monthState.notes[String(d).padStart(2, '0')] || '';
    html += `
      <div class="calendar-day ${isToday ? 'today' : ''}" data-day="${d}">
        <span class="d-num">${d}</span>
        ${note ? `<div class="d-note">${escapeHtml(note)}</div>` : ''}
      </div>`;
  }
  container.innerHTML = html;
  container.querySelectorAll('[data-day]').forEach(el => {
    el.addEventListener('click', () => openDayNoteModal(parseInt(el.dataset.day, 10), year, month));
  });
}

function openDayNoteModal(day, year, month) {
  const key = String(day).padStart(2, '0');
  const current = monthState.notes[key] || '';
  const box = openModal(`
    <h3>Nota del día ${day} de ${MESES_ES[month - 1]}</h3>
    <p>Escribe o edita la nota para este día.</p>
    <textarea id="day-note-input">${escapeHtml(current)}</textarea>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="day-note-cancel">Cancelar</button>
      <button class="btn btn-brass" id="day-note-save">Guardar nota</button>
    </div>
  `);
  const input = box.querySelector('#day-note-input');
  input.focus();
  box.querySelector('#day-note-cancel').addEventListener('click', closeModal);
  box.querySelector('#day-note-save').addEventListener('click', () => {
    const val = input.value;
    if (val.trim() === '') delete monthState.notes[key];
    else monthState.notes[key] = val;
    closeModal();
    paintGrid(year, month);
    scheduleAutosave();
  });
}

const scheduleAutosave = debounce(() => saveNow(true), 1500);

async function saveNow(isAuto) {
  // Mientras las notas guardadas todavía se están cargando, no autoguardar
  // para no sobreescribir notas de otros días con un estado incompleto
  // (el botón "Guardar" manual está deshabilitado hasta que esto termine).
  if (!notesReady) return;

  setCalStatus('Guardando…', 'saving');
  const currentUser = getCurrentUser();
  if (!currentUser) {
    setCalStatus('Tu sesión no está activa.', 'error');
    if (!isAuto) showToast('Tu sesión no está activa. Vuelve a iniciar sesión.', true);
    return;
  }
  try {
    const uid = currentUser.uid;
    await fetchWithRetry(() => saveCalendarMonth(uid, monthState.key, monthState.notes), { retries: isAuto ? 1 : 2, label: 'guardar calendario' });
    setCalStatus(isAuto ? 'Guardado automáticamente' : 'Guardado ✓', 'saved');
    if (!isAuto) showToast('Calendario guardado');
  } catch (e) {
    console.error('Error al guardar calendario:', e);
    setCalStatus(isAuto ? 'No se pudo guardar automáticamente' : describeFirestoreError(e), 'error');
    if (!isAuto) showToast(describeFirestoreError(e), true);
  }
}

function setCalStatus(text, cls, retryFn) {
  const el = document.getElementById('calendar-save-status');
  if (!el) return;
  el.className = 'save-status' + (cls ? ' ' + cls : '');
  if (retryFn) {
    el.innerHTML = `${escapeHtml(text)} <button class="btn btn-sm btn-outline" id="cal-retry-btn" style="margin-left:8px;">Reintentar</button>`;
    const btn = document.getElementById('cal-retry-btn');
    if (btn) btn.addEventListener('click', retryFn);
  } else {
    el.textContent = text;
  }
}