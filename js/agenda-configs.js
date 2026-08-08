export const AGENDAS = [
  {
    id: 'cony', personName: 'Cony', processName: 'Yesos',
    hasPoints: false,
    splitAmPm: true,
    leadingColumns: [
      { id: 'doctor', label: 'DOCTOR/PX', kind: 'text' },
      { id: 'cant', label: 'CANT.', kind: 'text', numeric: true, summedInFooter: true },
      { id: 'unid', label: 'UNID.', kind: 'text', numeric: true, summedInFooter: true }
    ],
    pointColumns: [], extraColumn: null
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

export const FALLBACK_POINT_VALUE = 0.75;

export function getAgendaConfig(id) {
  return AGENDAS.find(a => a.id === id) || null;
}

export function cellUnits(rawValue) {
  if (rawValue === 'X') return 1;
  const n = parseFloat(rawValue);
  return isNaN(n) ? 0 : n;
}

export function getBasePointColumns(config) {
  if (!config.hasPoints) return [];
  const cols = [...config.pointColumns];
  if (config.extraColumn) cols.push(config.extraColumn);
  return cols;
}

export function getAllPointColumns(config, dynamicColumns) {
  return [...getBasePointColumns(config), ...(dynamicColumns || []).map(c => ({ ...c, kind: c.kind || 'point' }))];
}

function toNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

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

export function computeGrandTotal(config, rows, dynamicColumns) {
  return (rows || []).reduce((sum, r) => sum + computeRowTotal(config, r, dynamicColumns), 0);
}

export function computeColumnSum(rows, colId) {
  return (rows || []).reduce((sum, r) => sum + toNum(r.cells ? r.cells[colId] : 0), 0);
}

let rowCounter = 0;
export function defaultRow() {
  rowCounter += 1;
  return { id: `row_${Date.now().toString(36)}_${rowCounter}`, cells: {}, rowColor: null };
}
