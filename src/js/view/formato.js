// Formatos de presentación en español (Intl): distancias, duraciones y horas.

const numero1 = new Intl.NumberFormat("es", { maximumFractionDigits: 1 });
const hora = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });
const fechaHora = new Intl.DateTimeFormat("es", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function distancia(m) {
  if (m == null) return "—";
  if (m < 1000) return `${Math.round(m / 5) * 5} m`;
  return `${numero1.format(m / 1000)} km`;
}

export function duracion(seg) {
  if (seg == null) return "—";
  const min = Math.round(seg / 60);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}

export function horaCorta(fecha) {
  return fecha ? hora.format(fecha) : "—";
}

export function fechaYHora(fecha) {
  return fecha ? fechaHora.format(fecha) : "—";
}

/** "hace 12 s", "hace 3 min" — para la antigüedad de una ubicación. */
export function hace(fecha, ahora = Date.now()) {
  if (!fecha) return "sin datos";
  const s = Math.max(0, Math.round((ahora - fecha.getTime()) / 1000));
  if (s < 10) return "ahora";
  if (s < 60) return `hace ${s} s`;
  const min = Math.round(s / 60);
  return min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`;
}

/** Cuenta regresiva a la hora acordada: "en 25 min" / "hace 5 min" / "ahora". */
export function cuentaRegresiva(fechaObjetivo, ahora = Date.now()) {
  const s = Math.round((fechaObjetivo.getTime() - ahora) / 1000);
  if (Math.abs(s) < 60) return "es ahora";
  return s > 0 ? `en ${duracion(s)}` : `hace ${duracion(-s)}`;
}

/** "5 min antes" / "a tiempo" / "8 min tarde". */
export function puntualidad(retrasoSeg) {
  if (retrasoSeg == null) return "";
  if (Math.abs(retrasoSeg) < 90) return "a tiempo";
  return retrasoSeg > 0 ? `${duracion(retrasoSeg)} tarde` : `${duracion(-retrasoSeg)} antes`;
}

export function calidadPrecision(m) {
  if (m <= 10) return "excelente";
  if (m <= 25) return "buena";
  if (m <= 60) return "regular";
  return "baja";
}

export function iniciales(nombre) {
  return String(nombre ?? "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Para <input type="datetime-local">: "2026-10-12T18:30" en hora local. */
export function aValorFechaLocal(fecha) {
  const d = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}
