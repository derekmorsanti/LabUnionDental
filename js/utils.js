// ============================================================================
// utils.js
// ----------------------------------------------------------------------------
// Utilidades genéricas: fecha/hora en zona horaria de Guatemala, formateo,
// helpers varios. Toda la app depende de este módulo para nunca usar la
// hora local del navegador directamente.
// ============================================================================

const GT_TZ = 'America/Guatemala';

export const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

/**
 * Devuelve las partes de fecha/hora actuales SIEMPRE en la zona horaria
 * de Guatemala (America/Guatemala, UTC-6, sin horario de verano),
 * sin importar en qué dispositivo/zona esté el navegador del usuario.
 */
export function getGuatemalaParts(date = new Date()) {
  const numFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: GT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const raw = {};
  numFmt.formatToParts(date).forEach(p => { raw[p.type] = p.value; });

  let hour = parseInt(raw.hour, 10);
  if (hour === 24) hour = 0; // algunos motores devuelven "24" a medianoche

  const weekdayFmt = new Intl.DateTimeFormat('es-GT', { timeZone: GT_TZ, weekday: 'long' });

  return {
    year: parseInt(raw.year, 10),
    month: parseInt(raw.month, 10),   // 1-12
    day: parseInt(raw.day, 10),
    hour,
    minute: parseInt(raw.minute, 10),
    second: parseInt(raw.second, 10),
    weekday: weekdayFmt.format(date)  // p. ej. "sábado"
  };
}

/** "Buenos días" / "Buenas tardes" / "Buenas noches" según la hora de Guatemala. */
export function getGreeting(hour) {
  if (hour >= 6 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

/** "Hoy es DD/MM/AAAA" — formato exacto pedido en la especificación. */
export function formatDMY({ day, month, year }) {
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

/** Clave de fecha para usar como parte de IDs de documento en Firestore. */
export function dateKey({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function dateKeyToday() {
  return dateKey(getGuatemalaParts());
}

/**
 * Etiqueta de encabezado de agenda al estilo de las hojas de referencia,
 * p. ej. "SÁBADO 1/08" (día sin cero inicial, mes con cero inicial).
 */
export function formatAgendaHeaderDate({ day, month }, weekday) {
  return `${weekday.toUpperCase()} ${day}/${String(month).padStart(2, '0')}`;
}

/** Fecha + hora legible (para Historial), p. ej. { date:"01/08/2026", time:"2:45 PM" }. */
export function formatSavedTimestamp(isoOrDate) {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : (isoOrDate || new Date());
  const parts = getGuatemalaParts(d);
  let h = parts.hour;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return { date: formatDMY(parts), time: `${h}:${String(parts.minute).padStart(2, '0')} ${ampm}` };
}

/** Días en un mes y en qué día de la semana cae el primero (0=domingo). Cálculo de calendario puro, no depende de zona horaria. */
export function getMonthMeta(year, month /* 1-12 */) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { firstWeekday, daysInMonth };
}

/** Lista de meses disponibles en un rango dado. Por defecto (sin argumentos), agosto 2026 → diciembre 2027 — el rango original del módulo Calendario. */
export function getAvailableMonths(startYear = 2026, startMonth = 8, endYear = 2027, endMonth = 12) {
  const months = [];
  let y = startYear, m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    months.push({ year: y, month: m, key: `${y}-${String(m).padStart(2, '0')}` });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

// ----------------------------------------------------------------------------
// Primera vez vs. ya conocida (usado por agenda.js y control-general.js):
// mientras nunca se haya confirmado (guardado o leído con éxito) que una
// agenda tiene datos en Firestore, se evita el viaje de red al abrirla y se
// pinta vacía de inmediato. En cuanto hay una lectura real exitosa o un
// guardado (desde CUALQUIER módulo que escriba en esa agenda), queda
// marcada localmente y a partir de ahí siempre se sincroniza normalmente
// contra el servidor.
// ----------------------------------------------------------------------------
const AGENDA_SEEN_PREFIX = 'lud_agenda_seen_';
const agendaSyncedMemory = new Set();

export function hasAgendaEverSynced(storageAgendaId) {
  if (agendaSyncedMemory.has(storageAgendaId)) return true;
  try { return localStorage.getItem(`${AGENDA_SEEN_PREFIX}${storageAgendaId}`) === '1'; }
  catch (_) { return false; }
}
export function markAgendaAsSynced(storageAgendaId) {
  agendaSyncedMemory.add(storageAgendaId);
  try { localStorage.setItem(`${AGENDA_SEEN_PREFIX}${storageAgendaId}`, '1'); }
  catch (_) { /* localStorage no disponible (modo privado, cuota, etc.) — no es crítico */ }
}

/** Si la fecha (YYYY-MM-DD) cae en sábado, la reagenda automáticamente al lunes siguiente (2 días después). Cualquier otro día se devuelve tal cual. Cálculo en UTC para no depender de la zona horaria del navegador. */
export function shiftSaturdayToMonday(dateKeyStr) {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCDay() === 6) {
    dt.setUTCDate(dt.getUTCDate() + 2);
  }
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ----------------------------------------------------------------------------
// Caché de "acabo de escribir esto": cuando se guarda o reagenda una
// agenda de un día concreto, se guarda aquí una copia en memoria. Si el
// usuario abre esa MISMA agenda+día justo después, se usa esta copia en
// vez de volver a pedirla a Firestore — evita la espera de red que se
// nota, por ejemplo, justo después de reagendar un caso hacia otra
// agenda y entrar a verla. Vida corta (se limpia sola) para no quedar
// desactualizada frente a cambios hechos desde otro dispositivo.
// ----------------------------------------------------------------------------
const recentAgendaWrites = new Map();
const RECENT_WRITE_TTL_MS = 20000;

export function cacheAgendaDayWrite(agendaId, dateKey, data) {
  recentAgendaWrites.set(`${agendaId}_${dateKey}`, { data, expiresAt: Date.now() + RECENT_WRITE_TTL_MS });
}
export function getCachedAgendaDayWrite(agendaId, dateKey) {
  const entry = recentAgendaWrites.get(`${agendaId}_${dateKey}`);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    recentAgendaWrites.delete(`${agendaId}_${dateKey}`);
    return null;
  }
  return entry.data;
}

// ----------------------------------------------------------------------------
// Borrador local DURADERO (localStorage, sobrevive a un F5): esta es la
// única copia que garantiza no perder cambios si el guardado/autoguardado
// a Firestore falla (p. ej. "client is offline"). A diferencia de la
// caché de arriba (en memoria, vive ~20s, se pierde al recargar), este
// borrador se escribe de inmediato en CADA edición local (no espera el
// debounce del autoguardado) y solo se borra cuando Firestore confirma
// de verdad el guardado. Al abrir una agenda, si existe un borrador para
// esa agenda+día, tiene prioridad sobre una tabla vacía por defecto.
// ----------------------------------------------------------------------------
const AGENDA_DRAFT_PREFIX = 'lud_agenda_draft_';

/** Guarda el borrador. Si localStorage está lleno (QuotaExceededError) u otro error, se registra y se sigue sin la red de seguridad local para esa edición puntual — el flujo normal de Firestore no se ve afectado. */
export function saveAgendaDraft(agendaId, dateKey, data) {
  try {
    localStorage.setItem(`${AGENDA_DRAFT_PREFIX}${agendaId}_${dateKey}`, JSON.stringify({ data, savedAt: Date.now() }));
  } catch (e) {
    console.error('[DRAFT] No se pudo guardar el borrador local (localStorage no disponible o lleno):', agendaId, dateKey, e);
  }
}
/** Devuelve { data, savedAt } — NUNCA solo `data`, porque savedAt es imprescindible para decidir si este borrador es más nuevo que lo que reporta Firestore. Un JSON corrupto se elimina y se trata como "no hay borrador" en vez de romper la carga o seguir fallando en cada lectura. */
export function getAgendaDraft(agendaId, dateKey) {
  const storeKey = `${AGENDA_DRAFT_PREFIX}${agendaId}_${dateKey}`;
  let raw;
  try {
    raw = localStorage.getItem(storeKey);
  } catch (e) {
    console.error('[DRAFT] localStorage no disponible al leer el borrador:', agendaId, dateKey, e);
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.savedAt !== 'number') {
      console.error('[DRAFT] Borrador con formato inválido, se descarta:', agendaId, dateKey);
      try { localStorage.removeItem(storeKey); } catch (_) {}
      return null;
    }
    return parsed;
  } catch (e) {
    console.error('[DRAFT] Borrador con JSON corrupto, se descarta:', agendaId, dateKey, e);
    try { localStorage.removeItem(storeKey); } catch (_) {}
    return null;
  }
}
export function clearAgendaDraft(agendaId, dateKey) {
  try { localStorage.removeItem(`${AGENDA_DRAFT_PREFIX}${agendaId}_${dateKey}`); }
  catch (e) { console.error('[DRAFT] No se pudo eliminar el borrador local:', agendaId, dateKey, e); }
}

/** Enumera todos los borradores duraderos guardados (de cualquier agenda+día), para el flush/retry al reconectar o abrir Agendas. */
export function listAgendaDrafts() {
  const results = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(AGENDA_DRAFT_PREFIX)) continue;
      const rest = k.slice(AGENDA_DRAFT_PREFIX.length);
      const sepIdx = rest.indexOf('_');
      if (sepIdx < 0) continue;
      const agendaId = rest.slice(0, sepIdx);
      const dateKey = rest.slice(sepIdx + 1);
      if (agendaId && dateKey) results.push({ agendaId, dateKey });
    }
  } catch (e) {
    console.error('[DRAFT] No se pudo enumerar los borradores locales:', e);
  }
  return results;
}

// ----------------------------------------------------------------------------
// Cola de reagendamientos pendientes: cuando se reagenda una fila a otra
// agenda pero Firebase está momentáneamente sin conexión, se guarda AQUÍ
// (localStorage, sobrevive a un cierre del navegador) SOLO doctor,
// descripción y unidad — nunca las casillas marcadas — junto con los
// datos mínimos para saber a qué fila destino corresponde. Se reintenta
// automáticamente más tarde (al reconectar, o al abrir Agendas de nuevo)
// sin crear duplicados, gracias a un rescheduleId estable.
// ----------------------------------------------------------------------------
const RESCHEDULE_QUEUE_KEY = 'lud_reschedule_queue';

export function buildRescheduleId({ sourceAgendaId, sourceDateKey, targetAgendaId, targetDateKey, sourceRowId }) {
  return [sourceAgendaId, sourceDateKey, targetAgendaId, targetDateKey, sourceRowId].join('__');
}

export function getRescheduleQueue() {
  try {
    const raw = localStorage.getItem(RESCHEDULE_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveRescheduleQueue(queue) {
  try { localStorage.setItem(RESCHEDULE_QUEUE_KEY, JSON.stringify(queue)); }
  catch (_) { /* localStorage no disponible — la cola queda solo en memoria de esta sesión */ }
}

/** pending debe traer ÚNICAMENTE: rescheduleId, sourceAgendaId, sourceDateKey, sourceRowId, targetAgendaId, targetDateKey, doctor, descripcion, unidad, createdAt — nunca casillas/marcas. */
export function enqueueReschedule(pending) {
  const queue = getRescheduleQueue();
  if (queue.some(p => p.rescheduleId === pending.rescheduleId)) return;
  queue.push(pending);
  saveRescheduleQueue(queue);
}

export function dequeueReschedule(rescheduleId) {
  const queue = getRescheduleQueue().filter(p => p.rescheduleId !== rescheduleId);
  saveRescheduleQueue(queue);
}

export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

let idCounter = 0;
export function generateId(prefix = 'id') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toNumber(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

/** Redondea a 2 decimales evitando errores de punto flotante (p. ej. 2.1000000000000005). */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Envuelve una promesa para que, si no se resuelve ni se rechaza dentro de
 * `ms`, se rechace por sí sola. Protege contra llamadas de Firestore/Auth
 * que se quedan "colgadas" (bloqueadores del navegador, redes lentas) sin
 * las cuales un `await` nunca continuaría y una pantalla de carga se
 * quedaría así para siempre.
 */
export function withTimeout(promise, ms = 15000, message = 'La operación tardó demasiado.') {
  let timer;

  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      console.warn('[Timeout ignorado]', message);
      // ❗ NO rechazamos aquí
    }, ms);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Códigos de Firestore/Auth para los que reintentar NO tiene sentido: son
// rechazos deterministas del servidor (permisos, sesión), no fallos de
// red transitorios — reintentarlos solo agrega espera innecesaria.
const NON_RETRYABLE_CODES = new Set([
  'permission-denied', 'unauthenticated', 'invalid-argument',
  'not-found', 'already-exists', 'failed-precondition'
]);

/**
 * Ejecuta `fn()` (una función que devuelve una promesa nueva cada vez que
 * se llama) hasta `retries + 1` veces, con una breve espera entre
 * intentos, antes de rechazar definitivamente. Se detiene de inmediato
 * ante un error no reintentable (p. ej. permisos) en vez de agotar todos
 * los intentos sin sentido.
 */
export async function fetchWithRetry(fn, { retries = 1, delayMs = 500, label = 'operación' } = {}) {
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(); // ❗ sin timeout
    } catch (err) {
      lastErr = err;

      const code = err && err.code;
      if (code && NON_RETRYABLE_CODES.has(code)) {
        throw err;
      }

      if (attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  throw lastErr;
}

/**
 * Traduce un error de Firestore/Auth a un mensaje específico y accionable
 * en vez de un genérico "revisa tu conexión" que puede ser engañoso
 * cuando la causa real es otra (reglas de seguridad no publicadas, sesión
 * no válida, etc.). Incluye el código original entre paréntesis para que
 * sea diagnosticable de un vistazo.
 */
export function describeFirestoreError(err) {
  const code = err && err.code ? String(err.code).replace(/^firestore\//, '') : '';
  const map = {
    'permission-denied': 'Firestore rechazó el acceso a estos datos. Revisa que las reglas de seguridad estén publicadas en la consola de Firebase (Firestore Database → Reglas).',
    'unauthenticated': 'Tu sesión no es válida para Firestore en este momento. Cierra sesión y vuelve a iniciar sesión.',
    'unavailable': 'No se pudo contactar el servidor de Firestore en este momento.',
    'failed-precondition': 'Firestore no está disponible en esta pestaña/navegador en este momento (revisa si hay otra pestaña de la misma app abierta).',
    'resource-exhausted': 'Se alcanzó un límite de uso de Firestore para este proyecto.',
    'not-found': 'El proyecto o la base de datos de Firestore configurados no existen.'
  };
  const base = map[code] || 'No se pudo completar la operación con la base de datos.';
  return code ? `${base} (${code})` : `${base}${err && err.message ? ' — ' + err.message : ''}`;
}
