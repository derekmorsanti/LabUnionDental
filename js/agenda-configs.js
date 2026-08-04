// ============================================================================
// agenda-configs.js
// ----------------------------------------------------------------------------
// Definicion exacta de las 5 agendas, tomada de las hojas de referencia.
// Este es el unico lugar donde viven las columnas y los pesos de puntos —
// cualquier ajuste futuro a un peso o nombre de columna se hace aqui.
//
// SUPUESTOS DE DISEÑO (no estaban escritos en el documento de texto, se
// dedujeron de las imagenes de referencia — ver README.md "Decisiones de
// diseño" para el detalle completo):
//   • La columna EXTRA de Abner y Dina no trae un peso propio en el
//     encabezado, asi que usa la regla de respaldo del documento original:
//     1 punto = 0.75.
//   • La columna EXTRA de Eliu SI tiene una formula real visible en la
//     imagen de referencia (multiplica por UNIDAD en vez de un peso fijo),
//     asi que se reproduce exactamente: EXTRA x UNIDAD.
//   • Toda columna nueva agregada con el boton (+) usa tambien el
//     respaldo de 1 punto = 0.75, en cualquiera de las 3 agendas con
//     puntos.
//   • DIFERENCIA (Cony y Astryd) = TOTAL - META, donde META es una meta
//     diaria editable por el usuario (el documento de texto no la definia;
//     solo aparecia como un numero ya calculado en la imagen).
// ============================================================================

/**
 * kind de columna:
 *   'text'             → columna de identidad/registro (texto o numero libre,
 *                         sin clic-para-marcar). numeric:true + summedInFooter:true
 *                         hace que se sume en la fila Total.
 *   'point'             → columna de puntos: clic = X = 1xpeso, doble clic = numero x peso
 *   'point-extra-eliu'  → caso especial de Eliu: EXTRA x UNIDAD
 */

export const AGENDAS = [
  {
    id: 'eliu', personName: 'Eliu', processName: 'Pretallado',
    hasPoints: true, totalLabel: 'TOTAL PTS',
    leadingColumns: [
      { id: 'doctor', label: 'DOCTOR/PX', kind: 'text' },
      { id: 'desc', label: 'DESC.', kind: 'text' },
      { id: 'unidad', label: 'UNIDAD', kind: 'text', numeric: true, summedInFooter: true }
    ],
    pointColumns: [
      { id: 'ox_wa_op', label: 'OX / WA / OP', weight: 0.30, kind: 'point' },
      { id: 'bod_incs', label: 'BOD / INCS', weight: 0.60, kind: 'point' },
      { id: 'bod_incs_anter', label: 'BOD/INCS ANTER', weight: 0.70, kind: 'point' },
      { id: 'tallar', label: 'TALLAR', weight: 0.50, kind: 'point' },
      { id: 'term', label: 'TERM', weight: 0.10, kind: 'point' },
      { id: 'h_c', label: 'H/C', weight: 0.25, kind: 'point' },
      { id: 'adapt_emax', label: 'ADAPT / EMAX', weight: 0.20, kind: 'point' },
      { id: 'calib_wa_emax', label: 'CALIB / WA EMAX', weight: 0.20, kind: 'point' },
      { id: 'calib_wa_care', label: 'CALIB / WA CARE', weight: 0.60, kind: 'point' }
    ],
    extraColumn: { id: 'extra', label: 'EXTRA', kind: 'point-extra-eliu' }
  },
  {
    id: 'cony', personName: 'Cony', processName: 'Yesos',
    hasPoints: false,
    leadingColumns: [
      { id: 'doctor', label: 'DOCTOR/PX', kind: 'text' },
      { id: 'cant', label: 'CANT.', kind: 'text', numeric: true, summedInFooter: true },
      { id: 'unid', label: 'UNID.', kind: 'text', numeric: true, summedInFooter: true }
    ],
    pointColumns: [], extraColumn: null
  },
  {
    id: 'abner', personName: 'Abner', processName: 'Metales',
    hasPoints: true, totalLabel: 'PUNTOS OBTENIDOS',
    leadingColumns: [
      { id: 'doctor', label: 'DOCTOR/PX', kind: 'text' },
      { id: 'desc', label: 'DESC.', kind: 'text' },
      { id: 'unidad', label: 'UNIDAD', kind: 'text', numeric: true, summedInFooter: true }
    ],
    pointColumns: [
      { id: 'limpiar_anillo', label: 'LIMPIAR ANILLO', weight: 0.15, kind: 'point' },
      { id: 'adaptar', label: 'ADAPTAR', weight: 0.25, kind: 'point' },
      { id: 'calibrar', label: 'CALIBRAR', weight: 0.30, kind: 'point' },
      { id: 'peinar_margenes', label: 'PEINAR MARGENES/ PASAR PIEDRA', weight: 0.30, kind: 'point' },
      { id: 'arenar', label: 'ARENAR', weight: 0.10, kind: 'point' }
    ],
    extraColumn: { id: 'extra', label: 'EXTRA', kind: 'point', weight: 0.75 }
  },
  {
    id: 'dina', personName: 'Dina', processName: 'Encerado',
    hasPoints: true, totalLabel: 'TOTAL PTS',
    leadingColumns: [
      { id: 'doctor', label: 'DOCTOR/PX', kind: 'text' },
      { id: 'desc', label: 'DESCRIPCIÓN', kind: 'text' },
      { id: 'unidad', label: 'UNIDAD', kind: 'text', numeric: true, summedInFooter: true }
    ],
    pointColumns: [
      { id: 'lib_marg', label: 'LIB. MARG.', weight: 0.15, kind: 'point' },
      { id: 'enc', label: 'ENC', weight: 0.70, kind: 'point' },
      { id: 'enc_pont', label: 'ENC PONT.', weight: 0.80, kind: 'point' },
      { id: 'enc_desca', label: 'ENC DESCA.', weight: 1.00, kind: 'point' },
      { id: 'reves', label: 'REVES', weight: 0.25, kind: 'point' },
      { id: 'disen_ucla', label: 'DISEÑ. UCLA', weight: 1.00, kind: 'point' },
      { id: 'cort_ucla', label: 'CORT. UCLA', weight: 0.50, kind: 'point' },
      { id: 'f_d', label: 'F.D.', weight: 0.20, kind: 'point' },
      { id: 's_cement', label: 'S/I CEMENT', weight: 1.00, kind: 'point' },
      { id: 's_atorn', label: 'S/I ATORN', weight: 1.00, kind: 'point' },
      { id: 'a_f', label: 'A.F.', weight: 0.40, kind: 'point' },
      { id: 'f', label: 'F', weight: 0.80, kind: 'point' },
      { id: 'lib_marg_resin', label: 'LIB. MARG RESIN', weight: 0.30, kind: 'point' }
    ],
    extraColumn: { id: 'extra', label: 'EXTRA', kind: 'point', weight: 0.75 }
  },
  {
    id: 'astryd', personName: 'Astryd', processName: 'Tallado',
    hasPoints: false,
    leadingColumns: [
      { id: 'doctor', label: 'DOCTOR/PX', kind: 'text' },
      { id: 'desc', label: 'DESC.', kind: 'text' },
      { id: 'cant', label: 'CANT.', kind: 'text', numeric: true, summedInFooter: true }
    ],
    pointColumns: [], extraColumn: null
  }
];

/** Valor de respaldo cuando una columna de puntos no trae peso propio (nuevas columnas, EXTRA sin peso). */
export const FALLBACK_POINT_VALUE = 0.75;

export function getAgendaConfig(id) {
  return AGENDAS.find(a => a.id === id) || null;
}

/**
 * Convierte el valor crudo de una casilla de produccion a "unidades":
 *   "X"      → 1
 *   numero N → N
 *   vacio    → 0
 */
export function cellUnits(rawValue) {
  if (rawValue === 'X') return 1;
  const n = parseFloat(rawValue);
  return isNaN(n) ? 0 : n;
}

/** Columnas de puntos fijas de una agenda (columnas base + EXTRA si tiene), sin incluir las dinamicas. */
export function getBasePointColumns(config) {
  if (!config.hasPoints) return [];
  const cols = [...config.pointColumns];
  if (config.extraColumn) cols.push(config.extraColumn);
  return cols;
}

/** Todas las columnas de puntos de una agenda, incluyendo las agregadas dinamicamente con (+). */
export function getAllPointColumns(config, dynamicColumns) {
  return [...getBasePointColumns(config), ...(dynamicColumns || []).map(c => ({ ...c, kind: c.kind || 'point' }))];
}

function toNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

/** TOTAL PTS (o PUNTOS OBTENIDOS) de una fila. Reproduce la formula exacta de Eliu para su columna EXTRA. */
export function computeRowTotal(config, row, dynamicColumns) {
  if (!config.hasPoints || !row || !row.cells) return 0;
  const cols = getAllPointColumns(config, dynamicColumns);
  let total = 0;
  for (const col of cols) {
    const raw = row.cells[col.id];
    if (col.kind === 'point-extra-eliu') {
      total += cellUnits(raw) * toNum(row.cells['unidad']);
    } else {
      const weight = (col.weight != null) ? col.weight : FALLBACK_POINT_VALUE;
      total += cellUnits(raw) * weight;
    }
  }
  return total;
}

/** Suma de TOTAL PTS de todas las filas (para la insignia de puntos y el pie de la tabla). */
export function computeGrandTotal(config, rows, dynamicColumns) {
  return (rows || []).reduce((sum, r) => sum + computeRowTotal(config, r, dynamicColumns), 0);
}

/** Suma de una columna de texto numerico (UNIDAD, CANT., UNID.) a traves de todas las filas, para la fila Total. */
export function computeColumnSum(rows, colId) {
  return (rows || []).reduce((sum, r) => sum + toNum(r.cells ? r.cells[colId] : 0), 0);
}

let rowCounter = 0;
export function defaultRow() {
  rowCounter += 1;
  return { id: `row_${Date.now().toString(36)}_${rowCounter}`, cells: {} };
}
