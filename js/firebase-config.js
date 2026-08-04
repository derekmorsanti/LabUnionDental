// js/firebase-config.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";


const firebaseConfig = {
  apiKey: "AIzaSyCQDBbcpQrtDejoM6zq9wSmt0ttB9IgN3I",
  authDomain: "uniondentalab.firebaseapp.com",
  projectId: "uniondentalab",
  storageBucket: "uniondentalab.firebasestorage.app",
  messagingSenderId: "115922226600",
  appId: "1:115922226600:web:13acb20af4888d7841a19d",
  measurementId: "G-QJTBK32NFH"
};


const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Firestore con dos ajustes:
//  1. experimentalForceLongPolling + useFetchStreams:false — evita el canal
//     de streaming (WebChannel) que algunos navegadores/extensiones (p. ej.
//     Brave Shields) bloquean en silencio sin generar ningún error, dejando
//     una operación esperando para siempre en vez de fallar.
//  2. localCache con persistentLocalCache — habilita caché local en
//     IndexedDB (equivalente moderno de enableIndexedDbPersistence). Los
//     datos ya leídos una vez quedan disponibles al instante en la próxima
//     carga o con red inestable/móvil, y las escrituras se guardan en cola
//     localmente si la red falla en ese momento y se sincronizan solas al
//     recuperar conexión. persistentMultipleTabManager permite tener varias
//     pestañas de la app abiertas a la vez sin que unas bloqueen a otras.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const isFirebaseConfigured = true;
