// ============================================================================
// main.js — punto de entrada. Decide qué pantalla mostrar según el estado
// de sesión y conecta todos los módulos entre sí.
// ============================================================================

import { isFirebaseConfigured, forceReconnectFirestore } from './firebase-config.js?v12';
import {
  onAuthChange, getUserProfileName, logoutUser,
  registerUser, loginUser, friendlyAuthError
} from './auth.js?v12';
import { renderDashboard } from './dashboard.js?v12';
import { renderAgenda } from './agenda.js?v12';
import { renderHistorialSelect, renderHistorialList } from './historial.js?v12';
import { renderCalendarioSelect, renderCalendarioMonth } from './calendario.js?v12';
import { renderControlGeneral } from './control-general.js?v12';
import { renderDatos } from './datos.js?v12';
import { closeModal, showToast } from './ui-helpers.js?v12';

// Red de seguridad global: cualquier error de JavaScript no controlado en
// ningún punto de la app (o cualquier promesa rechazada sin su propio
// catch) se registra claramente en consola y se avisa con un toast, en vez
// de dejar la interfaz "congelada" sin ninguna indicación de qué pasó.
window.addEventListener('error', (event) => {
  console.error('Error no controlado:', event.error || event.message);
  showToast('Ocurrió un error inesperado. Si algo dejó de responder, recarga la página.', true);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('Promesa rechazada sin manejar:', event.reason);
  showToast('Ocurrió un error inesperado. Si algo dejó de responder, recarga la página.', true);
});

let currentView = 'dashboard';
let lastNavParam = null;
let lastNavExtra = null;
let currentUserName = '';

// ----------------------------------------------------------------------------
// Navegación
// ----------------------------------------------------------------------------
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function showSubview(id) {
  document.querySelectorAll('.subview').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function setActiveSidebar(key) {
  document.querySelectorAll('.sidebar-link[data-nav]').forEach(l => l.classList.remove('active'));
  const el = document.querySelector(`.sidebar-link[data-nav="${key}"]`);
  if (el) el.classList.add('active');
}
function closeSidebarMobile() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-scrim').classList.remove('show');
}

async function navigate(view, param, extra) {
  currentView = view;
  lastNavParam = param;
  lastNavExtra = extra;
  closeSidebarMobile();
  const crumb = document.getElementById('topbar-crumb');

  switch (view) {
    case 'dashboard':
      showSubview('view-dashboard'); crumb.textContent = 'Agendas'; setActiveSidebar('dashboard');
      renderDashboard(currentUserName, navigate);
      break;
    case 'agenda':
      showSubview('view-agenda'); crumb.textContent = 'Agendas'; setActiveSidebar('dashboard');
      await renderAgenda(param, navigate, extra);
      break;
    case 'historial-select':
      showSubview('view-historial-select'); crumb.textContent = 'Historial'; setActiveSidebar('historial-select');
      renderHistorialSelect(navigate);
      break;
    case 'historial-list':
      showSubview('view-historial-list'); crumb.textContent = 'Historial'; setActiveSidebar('historial-select');
      await renderHistorialList(param, navigate);
      break;
    case 'calendario-select':
      showSubview('view-calendario-select'); crumb.textContent = 'Calendario'; setActiveSidebar('calendario-select');
      renderCalendarioSelect(navigate);
      break;
    case 'calendario-month':
      showSubview('view-calendario-month'); crumb.textContent = 'Calendario'; setActiveSidebar('calendario-select');
      await renderCalendarioMonth(param, navigate);
      break;
    case 'control-general':
      showSubview('view-control-general'); crumb.textContent = 'Control General'; setActiveSidebar('control-general');
      await renderControlGeneral(navigate);
      break;
    case 'datos':
      showSubview('view-datos'); crumb.textContent = 'Datos'; setActiveSidebar('datos');
      await renderDatos(navigate);
      break;
  }
}

// ----------------------------------------------------------------------------
// Auth: cambio de vista bienvenida / login / registro
// ----------------------------------------------------------------------------
function switchAuthView(id) {
  ['view-welcome', 'view-login', 'view-register'].forEach(v => document.getElementById(v).classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function resetAuthForms() {
  document.getElementById('form-login').reset();
  document.getElementById('form-register').reset();
  document.getElementById('login-error').classList.remove('show');
  document.getElementById('register-error').classList.remove('show');
  const loginBtn = document.getElementById('btn-login-submit');
  loginBtn.disabled = false; loginBtn.querySelector('.btn-label').textContent = 'Iniciar Sesión';
  const regBtn = document.getElementById('btn-register-submit');
  regBtn.disabled = false; regBtn.querySelector('.btn-label').textContent = 'Registrarse';
}

function wireAuthUI() {
  document.getElementById('btn-go-login').addEventListener('click', () => switchAuthView('view-login'));
  document.getElementById('btn-go-register').addEventListener('click', () => switchAuthView('view-register'));
  document.getElementById('link-to-register').addEventListener('click', () => switchAuthView('view-register'));
  document.getElementById('link-to-login').addEventListener('click', () => switchAuthView('view-login'));

  document.getElementById('form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('register-error');
    errorEl.classList.remove('show');

    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-password').value;
    const confirmPass = document.getElementById('reg-password-confirm').value;

    if (!name || !email || !pass) {
      errorEl.textContent = 'Completa todos los campos.'; errorEl.classList.add('show'); return;
    }
    if (pass.length < 6) {
      errorEl.textContent = 'La contraseña debe tener al menos 6 caracteres.'; errorEl.classList.add('show'); return;
    }
    if (pass !== confirmPass) {
      errorEl.textContent = 'Las contraseñas no coinciden.'; errorEl.classList.add('show'); return;
    }

    const btn = document.getElementById('btn-register-submit');
    btn.disabled = true; btn.querySelector('.btn-label').textContent = 'Creando cuenta…';
    try {
      await registerUser(name, email, pass);
    } catch (err) {
      errorEl.textContent = friendlyAuthError(err); errorEl.classList.add('show');
      btn.disabled = false; btn.querySelector('.btn-label').textContent = 'Registrarse';
    }
  });

  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('login-error');
    errorEl.classList.remove('show');

    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-password').value;
    const remember = document.getElementById('login-remember').checked;

    const btn = document.getElementById('btn-login-submit');
    btn.disabled = true; btn.querySelector('.btn-label').textContent = 'Ingresando…';
    try {
      await loginUser(email, pass, remember);
    } catch (err) {
      errorEl.textContent = friendlyAuthError(err); errorEl.classList.add('show');
      btn.disabled = false; btn.querySelector('.btn-label').textContent = 'Iniciar Sesión';
    }
  });
}

// ----------------------------------------------------------------------------
// Shell de la app (barra lateral, menú móvil, cerrar sesión, navegación)
// ----------------------------------------------------------------------------
function wireAppShell() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });

  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-scrim').classList.add('show');
  });
  document.getElementById('sidebar-scrim').addEventListener('click', closeSidebarMobile);

  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (!confirm('¿Cerrar sesión?')) return;
    try { await logoutUser(); } catch (e) { /* onAuthChange igual reflejará el estado real */ }
  });

  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });

  // Refresca saludo/fecha del dashboard cada minuto (y respeta el cambio de día).
  setInterval(() => {
    if (currentView === 'dashboard' && document.getElementById('view-app').classList.contains('active')) {
      renderDashboard(currentUserName, navigate);
    }
  }, 60000);
}

// ----------------------------------------------------------------------------
// Reconexión automática: cuando el navegador recupera la conexión (evento
// "online"), el SDK de Firestore a veces se queda "convencido" de que sigue
// sin red (falso negativo, común con extensiones de privacidad) y las
// pantallas se quedan repitiendo "Failed to get document because the client
// is offline" indefinidamente. Forzamos la reconexión y volvemos a pedir los
// datos de la vista actual automáticamente.
// ----------------------------------------------------------------------------
let reconnecting = false;
function wireConnectivity() {
  window.addEventListener('online', async () => {
    if (reconnecting) return;
    reconnecting = true;
    try {
      await forceReconnectFirestore();
      showToast('Conexión recuperada — recargando datos…');
      await navigate(currentView, lastNavParam, lastNavExtra);
    } catch (e) {
      console.error('Error al reconectar Firestore:', e);
    } finally {
      reconnecting = false;
    }
  });
  window.addEventListener('offline', () => {
    showToast('Sin conexión a internet. Los cambios se guardarán al recuperar la señal.', true);
  });
}

// ----------------------------------------------------------------------------
// Arranque
// ----------------------------------------------------------------------------
let authWired = false;

function init() {
  wireAuthUI();
  wireAppShell();
  wireConnectivity();

  if (!isFirebaseConfigured) {
    document.querySelector('#view-loading p').textContent =
      'Firebase todavía no está configurado. Revisa README.md para conectar tu proyecto.';
    const spinner = document.querySelector('#view-loading .spinner');
    if (spinner) spinner.style.display = 'none';
    return;
  }

  if (authWired) return; // evita suscribir el listener de sesión dos veces
  authWired = true;

  let authResolved = false;
  setTimeout(() => {
    if (!authResolved) {
      const p = document.querySelector('#view-loading p');
      if (p) p.textContent = 'Esto está tardando más de lo normal. Revisa tu conexión y recarga la página.';
    }
  }, 15000);

  onAuthChange((user) => {
    authResolved = true;
    if (user) {
      // Pinta el dashboard de inmediato con un nombre provisional (displayName/correo)
      // en vez de esperar una segunda consulta a Firestore antes de mostrar algo:
      // esto es lo que más acorta el tiempo de carga percibido al abrir o recargar la página.
      currentUserName = user.displayName || user.email || '';
      document.getElementById('sidebar-username').textContent = currentUserName;
      showView('view-app');
      navigate('dashboard');

      // El nombre "real" guardado en Firestore se actualiza después, en segundo plano,
      // sin bloquear nada de lo anterior.
      getUserProfileName(user.uid).then(name => {
        if (name && name !== currentUserName) {
          currentUserName = name;
          document.getElementById('sidebar-username').textContent = name;
          if (currentView === 'dashboard') renderDashboard(currentUserName, navigate);
        }
      }).catch(() => {});
    } else {
      currentUserName = '';
      resetAuthForms();
      switchAuthView('view-welcome');
      showView('view-welcome');
    }
  });
}

init();
