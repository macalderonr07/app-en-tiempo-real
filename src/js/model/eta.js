// Estimación de distancia por calle y tiempo de llegada (ETA).
//
// Tres fuentes, de mejor a peor:
//   1. "ruta": la ruta real calculada por OSRM (calles, veredas, sentido de las vías).
//      Entre cálculos se escala por cuánto bajó la distancia en línea recta, así no
//      hace falta pedir una ruta en cada lectura del GPS.
//   2. Velocidad observada: si la persona se está moviendo, su velocidad real (media
//      móvil) refleja tráfico, paso o paradas. Se mezcla con la ETA de la ruta.
//   3. "estimada": sin ruta (sin red o servicio caído) se usa la distancia recta por
//      un factor de desvío urbano y la velocidad típica del medio de transporte.

export const MODOS = Object.freeze({
  pie: { etiqueta: "A pie", velocidad: 1.33, perfil: "routed-foot" }, // 4,8 km/h
  bici: { etiqueta: "Bicicleta", velocidad: 4.2, perfil: "routed-bike" }, // 15 km/h
  auto: { etiqueta: "Auto / taxi", velocidad: 6.9, perfil: "routed-car" }, // 25 km/h urbano
  transporte: { etiqueta: "Bus / metro", velocidad: 4.4, perfil: "routed-car" }, // 16 km/h con paradas
});

// Las calles no son rectas: en ciudad la ruta suele medir ~30 % más que la línea recta.
export const FACTOR_DESVIO = 1.3;

/**
 * @param {object} p
 * @param {number} p.distRecta              metros en línea recta hasta el destino, ahora
 * @param {keyof MODOS} p.modo
 * @param {{distancia:number,duracion:number,distRectaBase:number}|null} [p.ruta]
 *        última ruta calculada y la distancia recta que había en ese momento
 * @param {number|null} [p.velObservada]    m/s (media móvil)
 * @returns {{distRuta:number, segundos:number, fuente:"ruta"|"estimada"}}
 */
export function estimarLlegada({ distRecta, modo, ruta = null, velObservada = null }) {
  const config = MODOS[modo] ?? MODOS.pie;
  if (distRecta <= 0) return { distRuta: 0, segundos: 0, fuente: ruta ? "ruta" : "estimada" };

  let distRuta;
  let segundos;
  let fuente;

  if (ruta && ruta.distRectaBase > 0) {
    // Proporción del camino que falta respecto del momento en que se calculó la ruta.
    const proporcion = Math.min(distRecta / ruta.distRectaBase, 1.5);
    distRuta = Math.max(ruta.distancia * proporcion, distRecta);
    segundos = ruta.duracion * proporcion;
    // OSRM calcula el bus como si fuera auto: se corrige con la velocidad típica.
    if (modo === "transporte") segundos = Math.max(segundos, distRuta / config.velocidad);
    fuente = "ruta";
  } else {
    distRuta = distRecta * FACTOR_DESVIO;
    segundos = distRuta / config.velocidad;
    fuente = "estimada";
  }

  // Solo se confía en la velocidad observada si es razonable para el medio elegido
  // (no 0,2 m/s porque esperó un semáforo, ni 30 m/s por un salto del GPS).
  if (velObservada != null && velObservada >= config.velocidad * 0.4 && velObservada <= config.velocidad * 4) {
    segundos = 0.5 * segundos + 0.5 * (distRuta / velObservada);
  }

  return { distRuta: Math.round(distRuta), segundos: Math.round(segundos), fuente };
}

/**
 * Compara la llegada estimada con la hora acordada.
 * @returns {number} segundos de retraso (negativo = llega antes)
 */
export function retrasoEstimado(etaSegundos, horaAcordada, ahora = Date.now()) {
  return Math.round((ahora + etaSegundos * 1000 - horaAcordada.getTime()) / 1000);
}
