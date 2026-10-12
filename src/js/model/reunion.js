// Reglas de negocio de una reunión y sus participantes (independientes de Firebase).
// Las mismas restricciones se repiten en firestore.rules: el cliente valida para dar
// buenos mensajes de error; las reglas validan porque el cliente no es de confianza.

import { MODOS } from "./eta.js";
import { coordenadaValida, distancia } from "./geo.js";

// Sin 0/O ni 1/I/L: el código se dicta en voz alta o se copia de una foto.
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LARGO_CODIGO = 6;
export const RADIOS_LLEGADA = [25, 50, 100, 200];
export const MAX_FOTO = 60_000; // caracteres del data URL (~45 KB) — cabe en un documento de Firestore
export const HORAS_VIGENCIA = 12; // la reunión y las ubicaciones se borran (TTL) a las 12 h de la hora acordada
export const SEGUNDOS_SIN_SENAL = 120;

export const ESTADOS = Object.freeze({
  esperando: "Sin ubicación todavía",
  "en-camino": "En camino",
  llego: "Llegó",
  pausado: "Ubicación pausada",
});

export function generarCodigo() {
  // 256 no es múltiplo de 31: se descartan los bytes >= 248 (8 × 31) para que todas
  // las letras tengan la misma probabilidad (muestreo por rechazo).
  const limite = 256 - (256 % ALFABETO.length);
  let codigo = "";
  while (codigo.length < LARGO_CODIGO) {
    for (const b of crypto.getRandomValues(new Uint8Array(LARGO_CODIGO))) {
      if (b < limite && codigo.length < LARGO_CODIGO) codigo += ALFABETO[b % ALFABETO.length];
    }
  }
  return codigo;
}

export function normalizarCodigo(texto) {
  return String(texto ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, LARGO_CODIGO);
}

export function esCodigoValido(codigo) {
  return new RegExp(`^[${ALFABETO}]{${LARGO_CODIGO}}$`).test(codigo);
}

/** @returns {Record<string,string>} errores por campo (vacío = válido) */
export function validarPerfil({ nombre, modo, foto }) {
  const errores = {};
  const limpio = String(nombre ?? "").trim();
  if (limpio.length < 2 || limpio.length > 40) errores.nombre = "Escribe tu nombre (2 a 40 caracteres).";
  if (!(modo in MODOS)) errores.modo = "Elige cómo vas a llegar.";
  if (foto && (!/^data:image\/(webp|jpeg);base64,/.test(foto) || foto.length > MAX_FOTO)) {
    errores.foto = "La foto no es válida o es demasiado grande.";
  }
  return errores;
}

/** @returns {Record<string,string>} */
export function validarReunion({ titulo, hora, destino, radioM }, ahora = new Date()) {
  const errores = {};
  const t = String(titulo ?? "").trim();
  if (t.length < 2 || t.length > 60) errores.titulo = "El título debe tener entre 2 y 60 caracteres.";
  if (!(hora instanceof Date) || Number.isNaN(hora.getTime())) {
    errores.hora = "Indica la fecha y hora del encuentro.";
  } else if (hora.getTime() < ahora.getTime() - 60 * 60 * 1000) {
    errores.hora = "La hora no puede ser de hace más de una hora.";
  } else if (hora.getTime() > ahora.getTime() + 30 * 24 * 3600 * 1000) {
    errores.hora = "La reunión debe ser dentro de los próximos 30 días.";
  }
  if (!coordenadaValida(destino) || !String(destino?.nombre ?? "").trim()) {
    errores.destino = "Elige el punto de encuentro (búsqueda, mapa o tu ubicación).";
  }
  if (!RADIOS_LLEGADA.includes(radioM)) errores.radioM = "Radio de llegada no válido.";
  return errores;
}

/**
 * Detección de llegada con histéresis: hacen falta 2 lecturas seguidas dentro del
 * radio para marcar "llegó" (evita falsos positivos por un salto del GPS), y para
 * volver a "en camino" hay que alejarse al triple del radio (evita parpadeo en el borde).
 */
export class DetectorLlegada {
  #dentroSeguidas = 0;
  #manual = false;
  llego = false;

  constructor(radioM) {
    this.radioM = radioM;
  }

  /** @returns {boolean} si cambió el estado */
  actualizar(distM, precM) {
    const antes = this.llego;
    // Con buena precisión se acepta el borde del radio más el error de la lectura.
    const dentro = distM <= this.radioM || (precM <= 30 && distM - precM <= this.radioM);
    this.#dentroSeguidas = dentro ? this.#dentroSeguidas + 1 : 0;
    if (!this.llego && this.#dentroSeguidas >= 2) this.llego = true;
    // Si la persona marcó "Ya llegué" a mano, se respeta aunque el GPS diga otra cosa.
    else if (this.llego && !this.#manual && distM > this.radioM * 3 + precM) this.llego = false;
    return antes !== this.llego;
  }

  forzarLlegada() {
    this.llego = true;
    this.#manual = true;
  }
}

/** Estado que se muestra de otra persona, teniendo en cuenta si sus datos son viejos. */
export function estadoVisible(participante, ahora = Date.now()) {
  if (participante.estado === "llego") return "llego";
  if (participante.estado === "pausado") return "pausado";
  if (!participante.pos) return "esperando";
  const edad = (ahora - (participante.actualizadoEn?.getTime() ?? 0)) / 1000;
  return edad > SEGUNDOS_SIN_SENAL ? "sin-senal" : "en-camino";
}

/** Separa y ordena: primero los que faltan (por ETA ascendente), luego los que llegaron. */
export function ordenarParticipantes(lista) {
  const faltan = lista
    .filter((p) => p.estado !== "llego")
    .sort((a, b) => (a.eta ?? Infinity) - (b.eta ?? Infinity) || a.nombre.localeCompare(b.nombre));
  const llegaron = lista
    .filter((p) => p.estado === "llego")
    .sort((a, b) => (a.llegoEn?.getTime() ?? 0) - (b.llegoEn?.getTime() ?? 0));
  return { faltan, llegaron };
}

export { distancia };
