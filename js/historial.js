import { AGENDAS, getAgendaConfig, computeGrandTotal } from './agenda-configs.js?v23';
import { getCurrentUser } from './auth.js?v23';
import { listAgendaHistory } from './data-store.js?v23';
import { escapeHtml, formatSavedTimestamp, round2, fetchWithRetry, describeFirestoreError } from './utils.js?v23';

let listToken = 0;

export function renderHistorialSelect(navigate) {
  const grid = document.getElementById('historial-person-grid');

  grid.innerHTML = AGENDAS.map(a => `
    <button class="person-tile" data-agenda="${a.id}">
      <div class="p-name">${escapeHtml(a.personName)}</div>
      <div class="p-role">${escapeHtml(a.processName)}</div>
    </button>
  `).join('');

  grid.querySelectorAll('[data-agenda]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigate('historial-list', btn.dataset.agenda);
    });
  });
}

export async function renderHistorialList(agendaId, navigate) {
  const myToken = ++listToken;

  const config = getAgendaConfig(agendaId);
  if (!config) return;

  document.getElementById('historial-list-title').textContent =
    `${config.personName} — ${config.processName}`;

  const container = document.getElementById('historial-list-container');

  container.innerHTML = `
    <div class="empty-state">
      <div class="spinner" style="margin:0 auto;"></div>
    </div>
  `;

  const user = getCurrentUser();

  if (!user) {
    container.innerHTML = `
      <div class="empty-state">
        Debes iniciar sesión nuevamente.
      </div>
    `;
    return;
  }

  let list = [];

  try {
    list = await fetchWithRetry(() => listAgendaHistory(user.uid, agendaId), { label: 'historial' });
  } catch (e) {
    console.error('ERROR HISTORIAL:', e);
    if (myToken !== listToken) return;
    container.innerHTML = `
      <div class="empty-state">
        No se pudo cargar el historial — esto NO significa que esté vacío.<br>${escapeHtml(describeFirestoreError(e))}
        <div style="margin-top:12px;"><button class="btn btn-sm btn-outline" id="historial-retry">Reintentar</button></div>
      </div>
    `;
    const retryBtn = document.getElementById('historial-retry');
    if (retryBtn) retryBtn.addEventListener('click', () => renderHistorialList(agendaId, navigate));
    return;
  }

  if (myToken !== listToken) return;

  if (!list.length) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <polyline points="12 7 12 12 15.5 14"/>
        </svg>
        Todavía no hay agendas guardadas para ${escapeHtml(config.personName)}.
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(item => {
    const [y, m, d] = (item.dateKey || '').split('-');

    let savedDate = new Date();

    if (item.savedAt) {
      try {
        if (typeof item.savedAt.toDate === 'function') {
          savedDate = item.savedAt.toDate();
        }
      } catch (_) {}
    }

    const ts = formatSavedTimestamp(savedDate);

    const dateSuffix = (item.dateKey || '').slice(10);
    const sessionLabel = dateSuffix === '-AM' ? 'AM' : (dateSuffix === '-PM' ? 'PM' : '');

    let ptsHtml = '';

    if (config.hasPoints) {
      const gt = round2(
        computeGrandTotal(
          config,
          item.rows || [],
          item.extraColumns || []
        )
      );

      ptsHtml = `<div class="h-pts">${gt.toFixed(2)} pts</div>`;
    }

    return `
      <button class="history-item" data-datekey="${item.dateKey}">
        <div>
          <div class="h-date">${d || '--'}/${m || '--'}/${y || '----'}${sessionLabel ? ` <span class="agenda-panel-label">${sessionLabel}</span>` : ''}</div>
          <div class="h-time">Guardado ${ts.date} · ${ts.time}</div>
        </div>
        ${ptsHtml}
      </button>
    `;
  }).join('');

  container.querySelectorAll('[data-datekey]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigate('agenda', agendaId, btn.dataset.datekey);
    });
  });
}
