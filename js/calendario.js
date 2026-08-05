// ============================================================================
// calendario.js — selección de mes + vista mensual con notas por día.
// ============================================================================

import { getCurrentUser } from './auth.js?v10';
import { getCalendarMonth, saveCalendarMonth } from './data-store.js?v10';
import { captureElementToImage } from './export.js?v10';
import { openModal, closeModal, showToast, openDownloadModal } from './ui-helpers.js?v10';
import {
  MESES_ES, getAvailableMonths, getMonthMeta, getGuatemalaParts,
  escapeHtml, capitalize, debounce, fetchWithRetry, describeFirestoreError
} from './utils.js?v10';

let monthState = { key: null, notes: {} };
// Token del mes que se está cargando: si el usuario navega a otro mes
// antes de que termine, esa respuesta tardía se descarta.
let monthToken = 0;

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

  const [y, m] = monthKey.split('-').map(Number);
  document.getElementById('calendario-month-title').textContent = `${capitalize(MESES_ES[m - 1])} ${y}`;

  const currentUser = getCurrentUser();
  if (!currentUser) { showToast('Tu sesión no está activa. Vuelve a iniciar sesión.', true); return; }
  const uid = currentUser.uid;

  let notes = {};
  let loadError = null;
  try {
    notes = await fetchWithRetry(() => getCalendarMonth(uid, monthKey), { label: 'calendario' });
  } catch (e) {
    loadError = e;
    console.error('Error al cargar calendario:', e);
  }

  if (myToken !== monthToken) return;

  monthState = { key: monthKey, notes: { ...notes } };

  paintGrid(y, m);

  if (loadError) {
    setCalStatus(`No se pudieron cargar las notas guardadas — esto NO significa que se hayan borrado. ${describeFirestoreError(loadError)}`, 'error');
    showToast('No se pudieron cargar las notas del mes.', true);
  } else {
    setCalStatus('');
  }

  document.getElementById('btn-save-calendar').onclick = () => saveNow();
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

const scheduleAutosave = debounce(() => saveNow(true), 1200);

async function saveNow(isAuto) {
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
    setCalStatus('Guardado ✓', 'saved');
    if (!isAuto) showToast('Calendario guardado');
  } catch (e) {
    console.error('Error al guardar calendario:', e);
    setCalStatus(describeFirestoreError(e), 'error');
    if (!isAuto) showToast(describeFirestoreError(e), true);
  }
}

function setCalStatus(text, cls) {
  const el = document.getElementById('calendar-save-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'save-status' + (cls ? ' ' + cls : '');
}
