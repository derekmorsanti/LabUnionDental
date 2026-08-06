// ============================================================================
// dashboard.js — saludo dinámico + fecha (hora de Guatemala) + tarjetas.
// ============================================================================

import { AGENDAS } from './agenda-configs.js?v12';
import { getGuatemalaParts, getGreeting, formatDMY, escapeHtml } from './utils.js?v12';

export function renderDashboard(userName, navigate) {
  const parts = getGuatemalaParts();
  document.getElementById('dash-greeting').textContent =
    `${getGreeting(parts.hour)}${userName ? ', ' + userName : ''}`;
  document.getElementById('dash-date').textContent = `Hoy es ${formatDMY(parts)}`;

  const grid = document.getElementById('dashboard-cards');
  grid.innerHTML = AGENDAS.map(a => `
    <button class="agenda-card" data-agenda="${a.id}">
      <div class="agenda-card-eyebrow">${escapeHtml(a.personName)}</div>
      <div class="agenda-card-name">${escapeHtml(a.processName)}</div>
      <div class="agenda-card-role">Agenda de producción de hoy</div>
      <div class="agenda-card-points">${a.hasPoints ? 'Sistema de puntos' : 'Registro sin puntos'}</div>
    </button>
  `).join('');

  grid.querySelectorAll('[data-agenda]').forEach(btn => {
    btn.addEventListener('click', () => navigate('agenda', btn.dataset.agenda));
  });
}
