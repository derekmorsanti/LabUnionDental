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
