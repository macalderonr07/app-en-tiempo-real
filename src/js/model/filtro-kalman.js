// Filtro de Kalman para suavizar las lecturas del GPS.
//
// El GPS del celular "salta": dos lecturas seguidas estando quieto pueden diferir
// 10-30 m. El filtro combina cada lectura nueva con la estimación anterior y les da
// peso según su precisión (coords.accuracy): una lectura de ±5 m mueve mucho la
// estimación y una de ±80 m casi nada. La incertidumbre crece con el tiempo según la
// velocidad (ruido de proceso), así el filtro no se "queda atrás" yendo en auto.
//
// Saltos: si llegan 2 lecturas PRECISAS seguidas incompatibles con la estimación
// (a más de 3 desvíos), la estimación es la que está mal (p. ej. el primer fix vino
// del wifi con mucho error) y el filtro se reinicia en la lectura nueva.

import { distancia } from "./geo.js";

const PRECISION_SALTO = 30;

export class FiltroKalman {
  #ruidoMinimo;
  #lat = 0;
  #lng = 0;
  #varianza = -1; // < 0 = sin estimación todavía
  #ts = 0;
  #incompatibles = 0;

  /** @param {number} ruidoMinimo  m/s de incertidumbre que se suma por segundo, como mínimo. */
  constructor(ruidoMinimo = 3) {
    this.#ruidoMinimo = ruidoMinimo;
  }

  /**
   * @param {{lat:number,lng:number,prec:number,ts:number,vel?:number|null}} lectura
   * @returns {{lat:number,lng:number,prec:number}}
   */
  procesar({ lat, lng, prec, ts, vel = null }) {
    const precision = Math.max(prec, 1);
    const dt = (ts - this.#ts) / 1000;

    // Primera lectura, o más de un minuto sin datos (la estimación vieja ya no sirve).
    if (this.#varianza < 0 || dt > 60) {
      this.#lat = lat;
      this.#lng = lng;
      this.#varianza = precision ** 2;
      this.#ts = ts;
      return this.estado;
    }

    const desvio = Math.sqrt(Math.max(this.#varianza, 0) + precision ** 2);
    const lejos = distancia({ lat: this.#lat, lng: this.#lng }, { lat, lng }) > 3 * desvio;
    this.#incompatibles = lejos && precision <= PRECISION_SALTO ? this.#incompatibles + 1 : 0;
    if (this.#incompatibles >= 2) {
      this.#incompatibles = 0;
      this.#lat = lat;
      this.#lng = lng;
      this.#varianza = precision ** 2;
      this.#ts = ts;
      return this.estado;
    }

    if (dt > 0) {
      const ruido = Math.max(this.#ruidoMinimo, (vel ?? 0) * 1.5);
      this.#varianza += dt * ruido ** 2;
      this.#ts = ts;
    }

    const ganancia = this.#varianza / (this.#varianza + precision ** 2);
    this.#lat += ganancia * (lat - this.#lat);
    this.#lng += ganancia * (lng - this.#lng);
    this.#varianza *= 1 - ganancia;
    return this.estado;
  }

  get estado() {
    return { lat: this.#lat, lng: this.#lng, prec: Math.sqrt(Math.max(this.#varianza, 0)) };
  }

  reiniciar() {
    this.#varianza = -1;
    this.#incompatibles = 0;
  }
}
