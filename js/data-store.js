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
  doc, getDoc, getDocFromServer, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { db } from './firebase-config.js?v23';

function agendaConfigRef(uid, agendaId) {
  return doc(db, 'users', uid, 'agendaConfigs', agendaId);
}
function agendaDayRef(uid, agendaId, dateKey) {
  return doc(db, 'users', uid, 'agendas', `${agendaId}_${dateKey}`);
}
function calendarMonthRef(uid, monthKey) {
  return doc(db, 'users', uid, 'calendarMonths', monthKey);
}
function controlGeneralCollectionRef(uid) {
  return collection(db, 'users', uid, 'controlGeneral');
}
function controlGeneralRecordRef(uid, id) {
  return doc(db, 'users', uid, 'controlGeneral', id);
}
function datosCatalogsRef(uid) {
  return doc(db, 'users', uid, 'datosCatalog', 'all');
}

/** Columnas agregadas dinámicamente (persisten para todos los días futuros de esa agenda). Intenta siempre leer del servidor (sin caché); si esa lectura falla por cualquier motivo, cae a una lectura normal en vez de reportar "no hay datos". */
export async function getAgendaExtraColumns(uid, agendaId) {
  const ref = agendaConfigRef(uid, agendaId);
  let snap;
  try {
    snap = await getDocFromServer(ref);
  } catch (e) {
    snap = await getDoc(ref);
  }
  return snap.exists() ? (snap.data().extraColumns || []) : [];
}

export async function saveAgendaExtraColumns(uid, agendaId, extraColumns) {
  await setDoc(agendaConfigRef(uid, agendaId), { extraColumns, updatedAt: serverTimestamp() }, { merge: true });
}

/** Agenda de un día específico (null si todavía no existe → se crea vacía en memoria). Intenta siempre leer del servidor (sin caché); si esa lectura falla por cualquier motivo, cae a una lectura normal en vez de reportar "no hay datos" cuando en realidad sí los hay. */
export async function getAgendaDay(uid, agendaId, dateKey) {
  const ref = agendaDayRef(uid, agendaId, dateKey);
  let snap;
  try {
    snap = await getDocFromServer(ref);
  } catch (e) {
    snap = await getDoc(ref);
  }
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

// ----------------------------------------------------------------------------
// CONTROL GENERAL — módulo de gestión de registros/casos (orden, doctor,
// paciente, costos, abonos, fechas, status, etc.). Un documento por
// registro, para poder filtrar/editar cada uno de forma independiente.
// ----------------------------------------------------------------------------

/** Todos los registros de Control General del usuario. */
export async function listControlGeneral(uid) {
  const snap = await getDocs(controlGeneralCollectionRef(uid));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Crea o actualiza (merge) un registro de Control General. */
export async function saveControlGeneralRecord(uid, id, data) {
  await setDoc(controlGeneralRecordRef(uid, id), {
    ...data, updatedAt: serverTimestamp()
  }, { merge: true });
}

/** Elimina un registro de Control General. */
export async function deleteControlGeneralRecord(uid, id) {
  await deleteDoc(controlGeneralRecordRef(uid, id));
}

// ----------------------------------------------------------------------------
// DATOS — catálogos reutilizables (doctores, etapas, costos, destinos,
// status, corrección/repetición) que alimentan las listas desplegables de
// Control General y de las Agendas. Cada catálogo es un solo documento con
// un arreglo `items`.
// ----------------------------------------------------------------------------

/** Todos los catálogos del usuario en un solo documento (1 lectura en vez de 6) — { doctores, etapas, costos, destinos, status, correccion }. null si el usuario todavía no tiene nada guardado. */
export async function getAllDatosCatalogs(uid) {
  const snap = await getDoc(datosCatalogsRef(uid));
  return snap.exists() ? snap.data() : null;
}

/** Guarda de una sola vez varios catálogos (merge por campo) — usado para sembrar los que falten en un solo viaje de red. */
export async function saveDatosCatalogs(uid, catalogsObj) {
  await setDoc(datosCatalogsRef(uid), { ...catalogsObj, updatedAt: serverTimestamp() }, { merge: true });
}

/** Reemplaza la lista de un solo catálogo (merge — no afecta a los demás campos del documento). */
export async function saveDatosCatalog(uid, name, items) {
  await setDoc(datosCatalogsRef(uid), { [name]: items, updatedAt: serverTimestamp() }, { merge: true });
}
