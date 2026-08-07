// ============================================================================
// datos.js — catálogos reutilizables (Doctores, Etapas, Costos, Destinos,
// Status, Corrección/Repetición). Fuente de las listas desplegables de
// Control General y de las Agendas.
// ============================================================================

import { getCurrentUser } from './auth.js?v18';
import { getAllDatosCatalogs, saveDatosCatalogs, saveDatosCatalog } from './data-store.js?v18';
import { DATOS_CATALOGS } from './datos-seed.js?v18';
import { escapeHtml, debounce, fetchWithRetry, describeFirestoreError } from './utils.js?v18';
import { showToast } from './ui-helpers.js?v18';

let state = {}; // { [catalogId]: items[] }
let activeTab = DATOS_CATALOGS[0].id;
let filterText = '';
let loaded = false;
let loadingPromise = null; // evita llamadas duplicadas a Firebase si dos vistas piden los catálogos casi al mismo tiempo

function catalogDef(id) { return DATOS_CATALOGS.find(c => c.id === id); }

/** Carga los catálogos UNA sola vez por sesión (1 lectura), compartida entre Datos y Control General. */
async function loadCatalogsOnce(uid) {
  if (loaded) return state;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const all = await fetchWithRetry(() => getAllDatosCatalogs(uid), { label: 'datos' });
      const toSeed = {};
      for (const cat of DATOS_CATALOGS) {
        const existing = all ? all[cat.id] : null;
        if (existing && existing.length) {
          state[cat.id] = existing;
        } else {
          state[cat.id] = [...cat.seed];
          toSeed[cat.id] = state[cat.id];
        }
      }
      if (Object.keys(toSeed).length) {
        fetchWithRetry(() => saveDatosCatalogs(uid, toSeed), { retries: 1, label: 'sembrar datos' })
          .catch(e => console.error('Error al sembrar catálogos:', e));
      }
      loaded = true;
    } catch (e) {
      console.error('Error al cargar catálogos:', e);
      DATOS_CATALOGS.forEach(cat => { state[cat.id] = [...cat.seed]; });
      showToast(`No se pudieron cargar los catálogos desde la nube — se muestra la lista por defecto. ${describeFirestoreError(e)}`, true);
      // loaded queda en false a propósito: así, la próxima vez que se pida
      // un catálogo (p. ej. al reconectar) se vuelve a intentar contra
      // Firestore en vez de quedarse con el respaldo local para siempre.
    }
    return state;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export async function renderDatos(navigate) {
  const container = document.getElementById('datos-container');
  if (!container) return;

  container.innerHTML = `
    <div class="agenda-header-bar">
      <div class="agenda-title-block">
        <h2>Datos</h2>
        <div class="agenda-subtitle">Catálogos usados en Control General y en las Agendas.</div>
      </div>
    </div>
    <div class="datos-tabs" id="datos-tabs"></div>
    <div id="datos-body"><div class="empty-state"><div class="spinner" style="margin:0 auto;"></div></div></div>
  `;

  const user = getCurrentUser();
  if (!user) { showToast('Tu sesión no está activa. Vuelve a iniciar sesión.', true); return; }
  const uid = user.uid;

  await loadCatalogsOnce(uid);

  paintTabs(uid);
  paintBody(uid);
}

function paintTabs(uid) {
  const tabsEl = document.getElementById('datos-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = DATOS_CATALOGS.map(c => `
    <button class="datos-tab ${c.id === activeTab ? 'active' : ''}" data-tab="${c.id}">
      ${escapeHtml(c.label)} <span class="datos-tab-count">${(state[c.id] || []).length}</span>
    </button>
  `).join('');
  tabsEl.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (activeTab === btn.dataset.tab) return;
      activeTab = btn.dataset.tab;
      filterText = '';
      paintTabs(uid);
      paintBody(uid);
    });
  });
}

function itemLabel(cat, val) {
  return cat.numeric ? `Q${Number(val).toFixed(2)}` : String(val);
}

function paintBody(uid) {
  const bodyEl = document.getElementById('datos-body');
  if (!bodyEl) return;
  const cat = catalogDef(activeTab);

  bodyEl.innerHTML = `
    <div class="datos-panel">
      <div class="datos-panel-toolbar">
        <input type="text" id="datos-search" class="datos-search" placeholder="Buscar en ${escapeHtml(cat.label)}…" value="${escapeHtml(filterText)}">
        <span class="save-status" id="datos-save-status"></span>
      </div>

      <div class="datos-add-row">
        <input type="${cat.numeric ? 'number' : 'text'}" ${cat.numeric ? 'step="0.01"' : ''} id="datos-new-item" placeholder="Agregar a ${escapeHtml(cat.label)}…">
        <button class="btn btn-brass btn-sm" id="datos-new-add">Agregar</button>
      </div>

      <details class="datos-bulk">
        <summary>Agregar varios a la vez (pegar lista, uno por línea)</summary>
        <textarea id="datos-bulk-text" placeholder="Un valor por línea…"></textarea>
        <button class="btn btn-outline btn-sm" id="datos-bulk-add">Agregar todos</button>
      </details>

      <div class="datos-list" id="datos-list"></div>
    </div>
  `;

  paintList(uid);

  document.getElementById('datos-search').addEventListener('input', (e) => {
    filterText = e.target.value;
    paintList(uid);
  });

  document.getElementById('datos-new-add').addEventListener('click', () => addItem(uid));
  document.getElementById('datos-new-item').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addItem(uid);
  });

  document.getElementById('datos-bulk-add').addEventListener('click', () => addBulk(uid));
}

/** Repinta únicamente la lista de resultados (no el buscador ni el resto del panel), para que escribir en el buscador nunca le haga perder el foco al input. */
function paintList(uid) {
  const listEl = document.getElementById('datos-list');
  if (!listEl) return;
  const cat = catalogDef(activeTab);
  const items = state[cat.id] || [];
  const q = filterText ? filterText.toLowerCase() : '';
  const indexed = items.map((it, idx) => [it, idx]);
  const filtered = q
    ? indexed.filter(([it]) => itemLabel(cat, it).toLowerCase().includes(q))
    : indexed;

  listEl.innerHTML = filtered.length ? filtered.map(([it, idx]) => `
    <div class="datos-list-item" data-realidx="${idx}">
      <span>${escapeHtml(itemLabel(cat, it))}</span>
      <button class="row-delete-btn" data-del="${idx}" title="Eliminar">✕</button>
    </div>
  `).join('') : `<div class="empty-state">Sin resultados.</div>`;

  if (listEl.dataset.delegated !== '1') {
    listEl.dataset.delegated = '1';
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-del]');
      if (!btn) return;
      removeItem(uid, parseInt(btn.dataset.del, 10));
    });
  }
}

function normalizeValue(cat, raw) {
  if (cat.numeric) {
    const n = parseFloat(raw);
    return isNaN(n) ? null : n;
  }
  const s = String(raw).trim();
  return s ? s.toUpperCase() : null;
}

function addItem(uid) {
  const cat = catalogDef(activeTab);
  const input = document.getElementById('datos-new-item');
  const val = normalizeValue(cat, input.value);
  if (val === null) { showToast('Escribe un valor válido', true); return; }
  const items = state[cat.id];
  if (items.some(it => itemLabel(cat, it) === itemLabel(cat, val))) {
    showToast('Ese valor ya existe en la lista', true); return;
  }
  items.push(val);
  input.value = '';
  persistCatalog(uid, cat);
  paintTabs(uid); paintBody(uid);
  showToast('Agregado');
}

function addBulk(uid) {
  const cat = catalogDef(activeTab);
  const textarea = document.getElementById('datos-bulk-text');
  const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) { showToast('Pega al menos un valor', true); return; }
  const items = state[cat.id];
  let added = 0;
  lines.forEach(line => {
    const val = normalizeValue(cat, line);
    if (val === null) return;
    if (items.some(it => itemLabel(cat, it) === itemLabel(cat, val))) return;
    items.push(val);
    added++;
  });
  textarea.value = '';
  persistCatalog(uid, cat);
  paintTabs(uid); paintBody(uid);
  showToast(`${added} valor(es) agregado(s)`);
}

function removeItem(uid, idx) {
  const cat = catalogDef(activeTab);
  const items = state[cat.id];
  if (!confirm('¿Eliminar este valor de la lista?')) return;
  items.splice(idx, 1);
  persistCatalog(uid, cat);
  paintTabs(uid); paintBody(uid);
  showToast('Eliminado');
}

const persistDebounced = {};
function persistCatalog(uid, cat) {
  const statusEl = document.getElementById('datos-save-status');
  if (statusEl) { statusEl.textContent = 'Guardando…'; statusEl.className = 'save-status saving'; }
  if (!persistDebounced[cat.id]) {
    persistDebounced[cat.id] = debounce(async () => {
      try {
        await fetchWithRetry(() => saveDatosCatalog(uid, cat.id, state[cat.id]), { retries: 1, label: 'guardar datos' });
        const el = document.getElementById('datos-save-status');
        if (el) { el.textContent = 'Guardado ✓'; el.className = 'save-status saved'; }
      } catch (e) {
        console.error('Error al guardar catálogo:', cat.id, e);
        const el = document.getElementById('datos-save-status');
        if (el) { el.textContent = 'Error al guardar'; el.className = 'save-status error'; }
        showToast(describeFirestoreError(e), true);
      }
    }, 700);
  }
  persistDebounced[cat.id]();
}

/** Catálogos en memoria — usado por Control General. Carga bajo demanda (comparte caché con Datos). */
export async function ensureCatalogsLoaded(uid) {
  return loadCatalogsOnce(uid);
}

export function getCatalogItems(id) {
  return state[id] || [];
}