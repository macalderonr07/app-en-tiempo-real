// Copia este archivo como firebase-config.js (mismo directorio) y reemplaza los
// valores con los de tu proyecto: Consola de Firebase -> Configuración del proyecto
// -> General -> Tus apps -> App web -> "Configuración del SDK" (opción "Config").
//
// Estos valores NO son secretos (cualquier app web los expone en el navegador): la
// protección real son las reglas de firestore.rules y la lista de dominios
// autorizados de Authentication. Aun así firebase-config.js está en .gitignore y en
// Cloudflare Pages se genera desde variables de entorno (ver README).

export const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.firebasestorage.app",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID",
};
