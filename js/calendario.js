import { getCurrentUser } from './auth.js?v23';
import { getCalendarMonth, saveCalendarMonth } from './data-store.js?v23';
import { forceReconnectFirestore } from './firebase-config.js?v23';
import { captureElementToImage } from './export.js?v23';
import { openModal, closeModal, showToast, openDownloadModal } from './ui-helpers.js?v23';
import {
  MESES_ES, getAvailableMonths, getMonthMeta, getGuatemalaParts,
  escapeHtml, capitalize, debounce, fetchWithRetry, describeFirestoreError, withTimeout
} from './utils.js?v23';

let monthState = { key: null, notes: {} };
let currentGridYear = null;
let currentGridMonth = null;
let monthToken = 0;
let notesReady = false;

function noteHtmlOf(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return escapeHtml(raw);
  if (typeof raw === 'object') {
    if (typeof raw.html === 'string') return raw.html;
    if (typeof raw.text === 'string') {
      const esc = escapeHtml(raw.text);
      return raw.underline ? `<u>${esc}</u>` : esc;
    }
  }
  return '';
}
function noteHasContent(raw) {
  const html = noteHtmlOf(raw);
  return !!(html && html.replace(/<[^>]*>/g, '').trim() !== '');
}

function sanitizeNoteHtml(rootNode) {
  const walk = (node) => {
    let out = '';
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += escapeHtml(child.textContent);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        const inner = walk(child);
        if (tag === 'u') {
          out += inner ? `<u>${inner}</u>` : '';
        } else if (tag === 'br') {
          out += '<br>';
        } else if (tag === 'div' || tag === 'p') {
          out += (out ? '<br>' : '') + inner;
        } else {
          out += inner;
        }
      }
    });
    return out;
  };
  return walk(rootNode);
}

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
    const rawNote = monthState.notes[String(d).padStart(2, '0')];
    const noteHtml = noteHtmlOf(rawNote);
    const hasNote = noteHasContent(rawNote);
    html += `
      <div class="calendar-day ${isToday ? 'today' : ''}" data-day="${d}">
        <span class="d-num">${d}</span>
        ${hasNote ? `<div class="d-note">${noteHtml}</div>` : ''}
      </div>`;
  }
  container.innerHTML = html;
  if (container.dataset.delegated !== '1') {
    container.dataset.delegated = '1';
    container.addEventListener('click', (e) => {
      const el = e.target.closest('[data-day]');
      if (!el || !container.contains(el)) return;
      openDayNoteModal(parseInt(el.dataset.day, 10), currentGridYear, currentGridMonth);
    });
  }
  currentGridYear = year;
  currentGridMonth = month;
}

function openDayNoteModal(day, year, month) {
  const key = String(day).padStart(2, '0');
  const raw = monthState.notes[key];
  const currentHtml = noteHtmlOf(raw);
  const box = openModal(`
    <h3>Nota del día ${day} de ${MESES_ES[month - 1]}</h3>
    <p>Escribe la nota, selecciona el texto que quieras y usa "Subrayar" para resaltar solo esa parte.</p>
    <div class="day-note-toolbar">
      <button type="button" class="btn btn-outline btn-sm" id="day-note-underline-btn">Subrayar selección</button>
    </div>
    <div id="day-note-input" class="day-note-editable" contenteditable="true"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="day-note-cancel">Cancelar</button>
      <button class="btn btn-brass" id="day-note-save">Guardar nota</button>
    </div>
  `);
  const editable = box.querySelector('#day-note-input');
  editable.innerHTML = currentHtml;
  editable.focus();

  try { document.execCommand('styleWithCSS', false, false); } catch (_) {}

  box.querySelector('#day-note-underline-btn').addEventListener('click', () => {
    editable.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      showToast('Selecciona el texto que quieres subrayar', true);
      return;
    }
    document.execCommand('underline');
  });

  editable.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  box.querySelector('#day-note-cancel').addEventListener('click', closeModal);
  box.querySelector('#day-note-save').addEventListener('click', () => {
    const plainText = editable.textContent || '';
    if (plainText.trim() === '') {
      delete monthState.notes[key];
    } else {
      monthState.notes[key] = { html: sanitizeNoteHtml(editable) };
    }
    closeModal();
    paintGrid(year, month);
    scheduleAutosave();
  });
}

const scheduleAutosave = debounce(() => saveNow(true), 1500);

async function saveNow(isAuto) {
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
