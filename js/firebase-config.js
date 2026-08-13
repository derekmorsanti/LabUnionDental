// js/firebase-config.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  enableNetwork, disableNetwork
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

// Firestore con estos ajustes:
//  1. experimentalAutoDetectLongPolling — deja que el SDK decida por sí
//     mismo si usar streaming (WebChannel) o long-polling, probando y
//     cayendo al que sí funcione. Antes se forzaba siempre long-polling
//     (experimentalForceLongPolling), pero en redes/extensiones donde ESE
//     transporte específico es el bloqueado (p. ej. ciertos modos de Brave
//     Shields o firewalls corporativos), forzarlo sin más producía
//     exactamente el error contrario: "Failed to get document because the
//     client is offline" de forma permanente. Auto-detectar es la opción
//     recomendada por Firebase para máxima compatibilidad.
//  2. localCache con persistentLocalCache — habilita caché local en
//     IndexedDB (equivalente moderno de enableIndexedDbPersistence). Los
//     datos ya leídos una vez quedan disponibles al instante en la próxima
//     carga o con red inestable/móvil, y las escrituras se guardan en cola
//     localmente si la red falla en ese momento y se sincronizan solas al
//     recuperar conexión. persistentMultipleTabManager permite tener varias
//     pestañas de la app abiertas a la vez sin que unas bloqueen a otras.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const isFirebaseConfigured = true;

// ----------------------------------------------------------------------------
// Reconexión manual: el SDK a veces se queda convencido de que "no hay red"
// incluso después de que la conexión real vuelve (falso negativo del
// detector interno de Firestore, común con extensiones de privacidad).
// forceReconnectFirestore() lo saca de ese estado a la fuerza, cortando y
// reabriendo el canal — se usa cuando vuelve el evento "online" del
// navegador y cuando el usuario reintenta manualmente tras un error.
// ----------------------------------------------------------------------------
export async function forceReconnectFirestore() {
  try {
    await disableNetwork(db);
  } catch (_) { /* si ya estaba deshabilitado, no pasa nada */ }
  await enableNetwork(db);
}
