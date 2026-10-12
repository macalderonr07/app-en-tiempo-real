// Construye el sitio estático en dist/ (lo que se publica en Cloudflare Pages).
//
//   1. Compila Tailwind -> src/assets/styles.css (minificado).
//   2. Copia Leaflet desde node_modules -> src/vendor/leaflet/ (sin depender de un CDN).
//      Ambos se generan DENTRO de src/ (e ignorados por git) para que src/index.html
//      también se vea bien abierto con Live Server; si no, la página sale sin estilos.
//   3. Copia src/ -> dist/ (sin la fuente de Tailwind).
//   4. Configuración de Firebase: si existen las variables de entorno FIREBASE_*
//      (Cloudflare Pages), genera dist/js/config/firebase-config.js con ellas; si no,
//      usa src/js/config/firebase-config.js (desarrollo local).
//   5. Service Worker: inyecta la lista de archivos a precargar y una versión
//      calculada con el hash del contenido.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(RAIZ, "src");
const DIST = join(RAIZ, "dist");

// 1. Tailwind
execFileSync(
  join(RAIZ, "node_modules", ".bin", "tailwindcss"),
  ["-c", join(RAIZ, "tailwind.config.js"), "-i", join(SRC, "assets", "tailwind.css"), "-o", join(SRC, "assets", "styles.css"), "--minify"],
  { cwd: RAIZ, stdio: ["ignore", "ignore", "inherit"] },
);

// 2. Leaflet
const leaflet = join(RAIZ, "node_modules", "leaflet", "dist");
const vendor = join(SRC, "vendor", "leaflet");
mkdirSync(vendor, { recursive: true });
for (const archivo of ["leaflet.js", "leaflet.css"]) cpSync(join(leaflet, archivo), join(vendor, archivo));
cpSync(join(leaflet, "images"), join(vendor, "images"), { recursive: true });

// 3. src -> dist
rmSync(DIST, { recursive: true, force: true });
cpSync(SRC, DIST, {
  recursive: true,
  filter: (ruta) => !ruta.endsWith(`${sep}tailwind.css`) && !ruta.endsWith("firebase-config.example.js"),
});

// 4. Firebase
const VARIABLES = {
  apiKey: "FIREBASE_API_KEY",
  authDomain: "FIREBASE_AUTH_DOMAIN",
  projectId: "FIREBASE_PROJECT_ID",
  storageBucket: "FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
  appId: "FIREBASE_APP_ID",
};
const destinoConfig = join(DIST, "js", "config", "firebase-config.js");
if (process.env.FIREBASE_API_KEY) {
  const config = Object.fromEntries(
    Object.entries(VARIABLES).map(([campo, variable]) => [campo, process.env[variable] ?? ""]),
  );
  writeFileSync(
    destinoConfig,
    `// Generado por scripts/build.mjs desde variables de entorno.\nexport const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`,
  );
  console.log("Firebase: configuración tomada de variables de entorno.");
} else if (existsSync(destinoConfig)) {
  console.log("Firebase: usando src/js/config/firebase-config.js.");
} else {
  console.warn("⚠ Firebase sin configurar: la app mostrará cómo conectarla (ver README).");
}

// 5. Service Worker
function listar(dir) {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? listar(ruta) : [ruta];
  });
}
const NO_PRECARGAR = new Set(["sw.js", "_headers"]);
const archivos = listar(DIST)
  .map((ruta) => relative(DIST, ruta).split(sep).join("/"))
  .filter((r) => !NO_PRECARGAR.has(r))
  .sort();
const hash = createHash("sha256");
for (const r of archivos) hash.update(r).update(readFileSync(join(DIST, r)));
const version = hash.digest("hex").slice(0, 10);
const precarga = ["./", ...archivos.map((r) => `./${r}`)];

const sw = join(DIST, "sw.js");
writeFileSync(
  sw,
  readFileSync(sw, "utf8")
    // Se reemplazan las declaraciones completas (no la primera aparición: el
    // comentario de cabecera también menciona los marcadores).
    .replace('const VERSION = "__VERSION__";', `const VERSION = ${JSON.stringify(version)};`)
    .replace("const PRECARGA = __PRECARGA__;", `const PRECARGA = ${JSON.stringify(precarga, null, 2)};`),
);
// Un SW con error de sintaxis no se instala y la app deja de funcionar sin red.
execFileSync(process.execPath, ["--check", sw], { stdio: "inherit" });

console.log(`✔ dist/ listo: ${archivos.length} archivos, versión ${version}`);
