// Servicios externos de mapas (OpenStreetMap, sin clave de API):
//   - Ruteo: OSRM en routing.openstreetmap.de, con perfiles a pie / bici / auto.
//   - Geocodificación: Nominatim (buscar dirección -> coordenadas y al revés).
// Política de uso de Nominatim: máximo 1 petición por segundo y nada de
// autocompletar con cada tecla; por eso solo se busca al enviar el formulario.

import { MODOS } from "../eta.js";

const OSRM = "https://routing.openstreetmap.de";
const NOMINATIM = "https://nominatim.openstreetmap.org";
const ESPERA_MS = 8000;

let ultimaNominatim = 0;

async function pedirJson(url) {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), ESPERA_MS);
  try {
    const r = await fetch(url, { signal: control.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(temporizador);
  }
}

async function respetarLimiteNominatim() {
  const espera = ultimaNominatim + 1100 - Date.now();
  if (espera > 0) await new Promise((ok) => setTimeout(ok, espera));
  ultimaNominatim = Date.now();
}

/**
 * Ruta real por calles.
 * @returns {Promise<{distancia:number, duracion:number, linea:[number,number][]}>}
 *          metros, segundos y la geometría como [lat, lng] para dibujarla.
 */
export async function calcularRuta(origen, destino, modo) {
  const perfil = (MODOS[modo] ?? MODOS.pie).perfil;
  const coords = `${origen.lng},${origen.lat};${destino.lng},${destino.lat}`;
  const datos = await pedirJson(
    `${OSRM}/${perfil}/route/v1/driving/${coords}?overview=simplified&geometries=geojson`,
  );
  const ruta = datos.routes?.[0];
  if (datos.code !== "Ok" || !ruta) throw new Error("Sin ruta disponible");
  return {
    distancia: ruta.distance,
    duracion: ruta.duration,
    linea: ruta.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
  };
}

/** @returns {Promise<{lat:number,lng:number,nombre:string}[]>} */
export async function buscarLugar(texto, cerca = null) {
  await respetarLimiteNominatim();
  const params = new URLSearchParams({ q: texto, format: "jsonv2", limit: "5", "accept-language": "es" });
  if (cerca) {
    // Prioriza (sin limitar) resultados a ~20 km de la ubicación actual.
    const d = 0.2;
    params.set("viewbox", `${cerca.lng - d},${cerca.lat + d},${cerca.lng + d},${cerca.lat - d}`);
  }
  const lista = await pedirJson(`${NOMINATIM}/search?${params}`);
  return lista.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), nombre: r.display_name }));
}

/** Nombre legible de un punto (para "usar mi ubicación" o un toque en el mapa). */
export async function nombrarLugar({ lat, lng }) {
  await respetarLimiteNominatim();
  try {
    const r = await pedirJson(
      `${NOMINATIM}/reverse?${new URLSearchParams({ lat, lon: lng, format: "jsonv2", "accept-language": "es", zoom: "18" })}`,
    );
    return r.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}
