// Seguimiento de la ubicación propia con la Geolocation API, buscando la mayor
// exactitud que el dispositivo permite:
//   - enableHighAccuracy: usa el GPS (no solo wifi/antenas) y maximumAge: 0 para
//     no recibir posiciones guardadas.
//   - Descarta lecturas muy imprecisas (> 150 m) si hubo una buena hace poco.
//   - Suaviza con un filtro de Kalman (ver filtro-kalman.js).
//   - Velocidad: la del GPS (coords.speed) o, si el navegador no la da, la calculada
//     entre lecturas filtradas; se promedia con una media móvil exponencial.
//
// Emite eventos "posicion" (detail = lectura filtrada) y "error" (detail = mensaje).

import { FiltroKalman } from "../filtro-kalman.js";
import { distancia } from "../geo.js";

const PRECISION_DESCARTE = 150;
const VIGENCIA_BUENA_MS = 30_000;
const ALFA_VELOCIDAD = 0.3;

const MENSAJES = {
  1: "Permiso de ubicación denegado. Actívalo en los ajustes del navegador para compartir dónde estás.",
  2: "No se pudo obtener la ubicación. Revisa que el GPS esté encendido.",
  3: "El GPS tarda en responder. Sigue intentando…",
};

export class ServicioUbicacion extends EventTarget {
  #idSeguimiento = null;
  #filtro = new FiltroKalman();
  #ultimaBuena = 0;
  #anterior = null;
  #velocidad = null;
  ultima = null;

  get activo() {
    return this.#idSeguimiento !== null;
  }

  static disponible() {
    return "geolocation" in navigator;
  }

  /** "granted" | "denied" | "prompt" | "desconocido" */
  static async estadoPermiso() {
    try {
      return (await navigator.permissions.query({ name: "geolocation" })).state;
    } catch {
      return "desconocido";
    }
  }

  iniciar() {
    if (this.activo || !ServicioUbicacion.disponible()) return;
    this.#idSeguimiento = navigator.geolocation.watchPosition(
      (p) => this.#procesar(p),
      (e) => this.#emitir("error", { codigo: e.code, mensaje: MENSAJES[e.code] ?? e.message }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  }

  detener() {
    if (this.#idSeguimiento !== null) navigator.geolocation.clearWatch(this.#idSeguimiento);
    this.#idSeguimiento = null;
  }

  #procesar({ coords, timestamp }) {
    const ahora = timestamp || Date.now();
    if (coords.accuracy > PRECISION_DESCARTE && ahora - this.#ultimaBuena < VIGENCIA_BUENA_MS) return;
    if (coords.accuracy <= PRECISION_DESCARTE) this.#ultimaBuena = ahora;

    const velGps = Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : null;
    const filtrada = this.#filtro.procesar({
      lat: coords.latitude,
      lng: coords.longitude,
      prec: coords.accuracy,
      ts: ahora,
      vel: velGps ?? this.#velocidad,
    });

    let velMedida = velGps;
    if (velMedida === null && this.#anterior) {
      const dt = (ahora - this.#anterior.ts) / 1000;
      // Entre lecturas muy seguidas el ruido domina: solo se mide con dt >= 2 s.
      if (dt >= 2) velMedida = distancia(this.#anterior, filtrada) / dt;
    }
    if (velMedida !== null) {
      this.#velocidad =
        this.#velocidad === null ? velMedida : ALFA_VELOCIDAD * velMedida + (1 - ALFA_VELOCIDAD) * this.#velocidad;
    }
    if (velGps !== null || !this.#anterior || (ahora - this.#anterior.ts) / 1000 >= 2) {
      this.#anterior = { ...filtrada, ts: ahora };
    }

    this.ultima = {
      lat: filtrada.lat,
      lng: filtrada.lng,
      prec: Math.max(Math.round(filtrada.prec), 1),
      precCruda: Math.round(coords.accuracy),
      vel: this.#velocidad,
      rumbo: Number.isFinite(coords.heading) ? coords.heading : null,
      ts: ahora,
    };
    this.#emitir("posicion", this.ultima);
  }

  #emitir(tipo, detail) {
    this.dispatchEvent(new CustomEvent(tipo, { detail }));
  }
}
