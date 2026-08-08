import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js?v23';
import { withTimeout } from './utils.js?v23';

export function friendlyAuthError(error) {
  const code = error && error.code ? error.code : '';
  const map = {
    'auth/email-already-in-use': 'Ese correo electrónico ya está registrado.',
    'auth/invalid-email': 'El correo electrónico no es válido.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/wrong-password': 'La contraseña es incorrecta.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/too-many-requests': 'Demasiados intentos. Espera un momento e intenta de nuevo.',
    'auth/network-request-failed': 'Error de conexión. Revisa tu internet e intenta de nuevo.',
    'auth/configuration-not-found': 'Firebase todavía no está configurado en este proyecto (ver README.md).'
  };
  return map[code] || `Ocurrió un error. Intenta de nuevo. (${code || 'desconocido'})`;
}

export async function registerUser(name, email, password) {
  const cred = await withTimeout(
    createUserWithEmailAndPassword(auth, email, password), 12000, 'El registro tardó demasiado. Intenta de nuevo.'
  );
  await withTimeout(updateProfile(cred.user, { displayName: name }), 8000).catch(() => {});
  await withTimeout(
    setDoc(doc(db, 'users', cred.user.uid), { name, email, createdAt: serverTimestamp() }), 8000
  ).catch(() => {});
  return cred.user;
}

export async function loginUser(email, password, remember) {
  await withTimeout(
    setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence), 8000
  );
  const cred = await withTimeout(
    signInWithEmailAndPassword(auth, email, password), 12000, 'El inicio de sesión tardó demasiado. Intenta de nuevo.'
  );
  return cred.user;
}

export async function logoutUser() {
  await signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  return auth.currentUser;
}

export async function getUserProfileName(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? snap.data().name || '' : '';
  } catch (err) {
    if (err.code === 'unavailable') {
      await new Promise(r => setTimeout(r, 1000));
      const snap = await getDoc(doc(db, 'users', uid));
      return snap.exists() ? snap.data().name || '' : '';
    }
    throw err;
  }
}
