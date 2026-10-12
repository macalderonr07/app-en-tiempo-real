// Service Worker de Punto de Encuentro (PWA instalable y que abre sin red).
//
// Vive en la raíz para que su alcance cubra todo el sitio. scripts/build.mjs
// reemplaza __VERSION__ (hash del contenido) y __PRECARGA__ (lista de archivos):
// al cambiar cualquier archivo cambia la versión y los clientes se actualizan solos.
//
// Estrategias:
//   - App shell (HTML/CSS/JS/íconos/Leaflet): precargado; navegación red-primero.
//   - SDK de Firebase (gstatic, URL con versión fija): caché primero.
//   - Teselas del mapa: caché primero con límite de entradas.
//   - Firestore, Auth, rutas y búsquedas: NO se interceptan. Los datos en tiempo
//     real los maneja la caché offline del propio SDK de Firestore (IndexedDB).

const VERSION = "__VERSION__";
const PRECARGA = __PRECARGA__;
const CACHE_APP = `encuentro-app-${VERSION}`;
const CACHE_SDK = "encuentro-sdk";
const CACHE_TESELAS = "encuentro-teselas";
const MAX_TESELAS = 400;

const SDK = ["app", "auth", "firestore"].map(
  (m) => `https://www.gstatic.com/firebasejs/12.19.0/firebase-${m}.js`,
);

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    (async () => {
      await (await caches.open(CACHE_APP)).addAll(PRECARGA);
      // El SDK es de otro origen: si falla no debe impedir la instalación.
      await (await caches.open(CACHE_SDK)).addAll(SDK).catch(() => {});
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      const vigentes = [CACHE_APP, CACHE_SDK, CACHE_TESELAS];
      for (const nombre of await caches.keys()) {
        if (!vigentes.includes(nombre)) await caches.delete(nombre);
      }
      await self.clients.claim();
    })(),
  );
});

async function cachePrimero(peticion, nombreCache, limite = 0) {
  const cache = await caches.open(nombreCache);
  const guardada = await cache.match(peticion);
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  if (respuesta.ok) {
    await cache.put(peticion, respuesta.clone());
    if (limite) {
      const claves = await cache.keys();
      for (const vieja of claves.slice(0, Math.max(0, claves.length - limite))) await cache.delete(vieja);
    }
  }
  return respuesta;
}

async function redPrimero(peticion) {
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok) (await caches.open(CACHE_APP)).put("./index.html", respuesta.clone());
    return respuesta;
  } catch {
    return (await caches.match("./index.html")) ?? Response.error();
  }
}

self.addEventListener("fetch", (evento) => {
  const { request } = evento;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate" && url.origin === location.origin) {
    evento.respondWith(redPrimero(request));
  } else if (url.origin === location.origin) {
    evento.respondWith(cachePrimero(request, CACHE_APP));
  } else if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    evento.respondWith(cachePrimero(request, CACHE_SDK));
  } else if (url.hostname.endsWith("tile.openstreetmap.org")) {
    evento.respondWith(cachePrimero(request, CACHE_TESELAS, MAX_TESELAS));
  }
  // Todo lo demás (Firestore, Auth, OSRM, Nominatim) va directo a la red.
});
