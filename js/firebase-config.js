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

export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const isFirebaseConfigured = true;

export async function forceReconnectFirestore() {
  try {
    await disableNetwork(db);
  } catch (_) {  }
  await enableNetwork(db);
}
