// Piezas de vista compartidas: cambio de pantalla, avisos, avatar, diálogo de
// confirmación y estado de la red.
//
// Seguridad: todo texto que viene de Firestore (nombres, títulos, lugares) se pone
// con textContent, nunca con innerHTML, para que no se pueda inyectar HTML (XSS).

import { iniciales } from "./formato.js";

// Colores de participante: todos con contraste >= 4.5:1 contra texto blanco.
export const COLORES = ["#0f766e", "#4338ca", "#be123c", "#b45309", "#6d28d9", "#0369a1", "#3f6212", "#a21caf"];

export const $ = (id) => document.getElementById(id);

const VISTAS = ["vista-cargando", "vista-error", "vista-inicio", "vista-reunion"];

/** Muestra una vista y mueve el foco a su título (lo anuncia el lector de pantalla). */
export function mostrarVista(id, { enfocar = true } = {}) {
  for (const v of VISTAS) $(v).hidden = v !== id;
  $(id).setAttribute("aria-busy", "false");
  if (enfocar) $(id).querySelector("h1")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

let temporizadorToast;
export function avisar(texto, ms = 4000) {
  const p = $("toast-texto");
  p.textContent = texto;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => (p.textContent = ""), ms);
}

/** Solo para lectores de pantalla (eventos importantes: alguien llegó). */
export function anunciar(texto) {
  const region = $("anuncios");
  region.textContent = "";
  // Vaciar y reescribir en el siguiente frame fuerza a que se anuncie aunque se repita.
  requestAnimationFrame(() => (region.textContent = texto));
}

/** Vibración + pitido corto (Web Audio API). Respeta si el navegador lo bloquea. */
let audio;
export function alertaSonora() {
  navigator.vibrate?.([120, 60, 120]);
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const vol = audio.createGain();
    osc.frequency.value = 880;
    vol.gain.setValueAtTime(0.15, audio.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.4);
    osc.connect(vol).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.4);
  } catch {
    /* sin audio disponible: basta con la vibración y el aviso */
  }
}

/** Avatar: foto si la hay, si no iniciales sobre el color del participante. */
export function pintarAvatar(contenedor, { nombre, foto, color }) {
  contenedor.replaceChildren();
  if (foto && /^data:image\/(webp|jpeg);base64,/.test(foto)) {
    const img = document.createElement("img");
    img.src = foto;
    img.alt = "";
    img.className = "h-full w-full object-cover";
    contenedor.append(img);
  } else {
    contenedor.textContent = iniciales(nombre) || "?";
  }
  if (color != null) contenedor.style.backgroundColor = COLORES[color % COLORES.length];
}

export function confirmar({ titulo, texto, accion }) {
  const dialogo = $("dialogo-confirmar");
  $("confirmar-titulo").textContent = titulo;
  $("confirmar-texto").textContent = texto;
  $("confirmar-si").textContent = accion;
  dialogo.showModal();
  return new Promise((resolver) => {
    dialogo.addEventListener("close", () => resolver(dialogo.returnValue === "si"), { once: true });
  });
}

export function mostrarEstadoRed(enLinea) {
  const caja = $("estado-red");
  caja.querySelector("[data-texto]").textContent = enLinea ? "En línea" : "Sin conexión";
  caja.querySelector("[data-punto]").className =
    `h-2.5 w-2.5 rounded-full ${enLinea ? "bg-emerald-300" : "bg-amber-300"}`;
}

/** Muestra errores de un formulario junto a cada campo y enfoca el primero. */
export function mostrarErrores(form, errores, prefijo) {
  form.querySelectorAll("[data-error]").forEach((p) => (p.textContent = ""));
  form.querySelectorAll("[aria-invalid]").forEach((c) => c.removeAttribute("aria-invalid"));
  let primero = null;
  for (const [campo, mensaje] of Object.entries(errores)) {
    const p = $(`${prefijo}-${campo}-error`);
    if (p) p.textContent = mensaje;
    // Si el campo es un grupo (fieldset), se enfoca su primer control.
    const control =
      $(`${prefijo}-${campo}`) ??
      form.querySelector(`[name="${campo}"]`) ??
      p?.closest("fieldset")?.querySelector("input, button");
    if (control) {
      control.setAttribute("aria-invalid", "true");
      primero ??= control;
    }
  }
  primero?.focus();
  return Object.keys(errores).length === 0;
}
