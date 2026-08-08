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

export async function autosaveAgendaDay(uid, agendaId, dateKey, data) {
  await setDoc(agendaDayRef(uid, agendaId, dateKey), {
    ...data, agendaId, dateKey, updatedAt: serverTimestamp()
  }, { merge: true });
}

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

export async function listControlGeneral(uid) {
  const snap = await getDocs(controlGeneralCollectionRef(uid));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveControlGeneralRecord(uid, id, data) {
  await setDoc(controlGeneralRecordRef(uid, id), {
    ...data, updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function deleteControlGeneralRecord(uid, id) {
  await deleteDoc(controlGeneralRecordRef(uid, id));
}

export async function getAllDatosCatalogs(uid) {
  const snap = await getDoc(datosCatalogsRef(uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveDatosCatalogs(uid, catalogsObj) {
  await setDoc(datosCatalogsRef(uid), { ...catalogsObj, updatedAt: serverTimestamp() }, { merge: true });
}

export async function saveDatosCatalog(uid, name, items) {
  await setDoc(datosCatalogsRef(uid), { [name]: items, updatedAt: serverTimestamp() }, { merge: true });
}
