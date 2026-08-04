// ============================================================================
// data-store.js
// ----------------------------------------------------------------------------
// Capa de acceso a Cloud Firestore. Ningún otro módulo llama a Firestore
// directamente — todos pasan por aquí. Esto hace que sea fácil cambiar de
// base de datos en el futuro si hiciera falta.
//
// Estructura de datos:
//   users/{uid}                                  → perfil (nombre, correo)
//   users/{uid}/agendaConfigs/{agendaId}          → columnas dinámicas (+/-)
//                                                    de esa agenda (plantilla
//                                                    que aplica hacia adelante)
//   users/{uid}/agendas/{agendaId}_{dateKey}      → una agenda de un día
//                                                    específico. Este MISMO
//                                                    documento es lo que se
//                                                    ve tanto al abrir la
//                                                    agenda de "hoy" como al
//                                                    consultarlo después en
//                                                    Historial — así se evita
//                                                    duplicar información y
//                                                    que una copia quede
//                                                    desactualizada frente a
//                                                    la otra.
//   users/{uid}/calendarMonths/{YYYY-MM}          → notas de todos los días
//                                                    de ese mes en un solo
//                                                    documento.
// ============================================================================

import {
  doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { db } from './firebase-config.js?v9';

function agendaConfigRef(uid, agendaId) {
  return doc(db, 'users', uid, 'agendaConfigs', agendaId);
}
function agendaDayRef(uid, agendaId, dateKey) {
  return doc(db, 'users', uid, 'agendas', `${agendaId}_${dateKey}`);
}
function calendarMonthRef(uid, monthKey) {
  return doc(db, 'users', uid, 'calendarMonths', monthKey);
}

/** Columnas agregadas dinámicamente (persisten para todos los días futuros de esa agenda). */
export async function getAgendaExtraColumns(uid, agendaId) {
  const snap = await getDoc(agendaConfigRef(uid, agendaId));
  return snap.exists() ? (snap.data().extraColumns || []) : [];
}

export async function saveAgendaExtraColumns(uid, agendaId, extraColumns) {
  await setDoc(agendaConfigRef(uid, agendaId), { extraColumns, updatedAt: serverTimestamp() }, { merge: true });
}

/** Agenda de un día específico (null si todavía no existe → se crea vacía en memoria). */
export async function getAgendaDay(uid, agendaId, dateKey) {
  const snap = await getDoc(agendaDayRef(uid, agendaId, dateKey));
  return snap.exists() ? snap.data() : null;
}

/** Autoguardado silencioso (no toca savedAt — ese solo lo actualiza el botón Guardar). */
export async function autosaveAgendaDay(uid, agendaId, dateKey, data) {
  await setDoc(agendaDayRef(uid, agendaId, dateKey), {
    ...data, agendaId, dateKey, updatedAt: serverTimestamp()
  }, { merge: true });
}

/** Guardado explícito con el botón GUARDAR: registra fecha/hora de guardado. */
export async function saveAgendaDay(uid, agendaId, dateKey, data) {
  await setDoc(agendaDayRef(uid, agendaId, dateKey), {
    ...data, agendaId, dateKey, updatedAt: serverTimestamp(), savedAt: serverTimestamp()
  }, { merge: true });
}

export async function listAgendaHistory(uid, agendaId) {
  const q = query(
    collection(db, 'users', uid, 'agendas'),
    where('agendaId', '==', agendaId)
  );

  const snap = await getDocs(q);

  const list = snap.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data()
  }));

  list.sort((a, b) => {
    const da = a.dateKey || '';
    const dbb = b.dateKey || '';
    return dbb.localeCompare(da);
  });

  return list;
}

export async function getCalendarMonth(uid, monthKey) {
  const snap = await getDoc(calendarMonthRef(uid, monthKey));
  return snap.exists() ? (snap.data().notes || {}) : {};
}

export async function saveCalendarMonth(uid, monthKey, notes) {
  await setDoc(calendarMonthRef(uid, monthKey), { notes, updatedAt: serverTimestamp() }, { merge: true });
}
