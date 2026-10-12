// Conexión con Firebase (SDK modular v12 desde el CDN oficial, sin bundler).
//
// - Authentication anónima: cada dispositivo obtiene un uid estable sin pedir correo.
//   Las reglas de Firestore usan ese uid para que cada quien solo escriba lo suyo.
// - Firestore con caché persistente (IndexedDB): las lecturas funcionan sin red y las
//   escrituras hechas offline se envían solas al reconectar.
//
// Este módulo se importa de forma dinámica desde el controlador: si el SDK no carga
// (primera visita sin red) la interfaz igual se muestra con un mensaje claro.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  browserLocalPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import * as firestore from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

export class ErrorConfiguracion extends Error {
  name = "ErrorConfiguracion";
}

const CAMPOS_OBLIGATORIOS = ["apiKey", "authDomain", "projectId", "appId"];

async function leerConfiguracion() {
  let modulo;
  try {
    modulo = await import("../../config/firebase-config.js");
  } catch {
    throw new ErrorConfiguracion(
      "Falta js/config/firebase-config.js. Copia firebase-config.example.js y pega la configuración de tu proyecto.",
    );
  }
  const config = modulo.firebaseConfig;
  const faltan = CAMPOS_OBLIGATORIOS.filter((c) => !config?.[c] || String(config[c]).startsWith("TU_"));
  if (faltan.length) {
    throw new ErrorConfiguracion(`La configuración de Firebase está incompleta: ${faltan.join(", ")}.`);
  }
  return config;
}

/** @returns {Promise<{db: any, uid: string, fs: typeof firestore}>} */
export async function conectarFirebase() {
  const config = await leerConfiguracion();
  const app = initializeApp(config);
  const db = firestore.initializeFirestore(app, {
    localCache: firestore.persistentLocalCache({
      tabManager: firestore.persistentMultipleTabManager(),
    }),
  });
  // initializeAuth sin popupRedirectResolver: getAuth() cargaría además un script de
  // apis.google.com (para login con ventanas emergentes, que esta app no usa); así
  // el SDK pesa menos y la CSP puede limitarse a 'self' + gstatic.
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return { db, uid: auth.currentUser.uid, fs: firestore };
}
