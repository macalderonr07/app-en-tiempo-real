// Envoltorio de Leaflet (mapa con teselas de OpenStreetMap).
// Leaflet se carga como script clásico (vendor/leaflet/leaflet.js) y expone `L`.
//
// Los marcadores no reciben foco de teclado (keyboard: false): el mapa es la vista
// visual y la lista de participantes es la alternativa accesible equivalente.

import { COLORES, pintarAvatar } from "./comun.js";

const TESELAS = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATRIBUCION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function leafletDisponible() {
  return typeof window.L !== "undefined";
}

function crearMapa(contenedor, centro, zoom) {
  if (!leafletDisponible()) {
    contenedor.textContent = "No se pudo cargar el mapa. La lista de participantes sigue funcionando.";
    contenedor.classList.add("grid", "place-items-center", "p-4", "text-center", "text-slate-700");
    return null;
  }
  const mapa = L.map(contenedor, { zoomControl: true, attributionControl: true }).setView(centro, zoom);
  L.tileLayer(TESELAS, { maxZoom: 19, attribution: ATRIBUCION }).addTo(mapa);
  return mapa;
}

function iconoDestino() {
  const el = document.createElement("div");
  el.className = "marcador-destino";
  el.textContent = "★";
  return L.divIcon({ html: el, className: "", iconSize: [48, 48], iconAnchor: [24, 24] });
}

// --------------------------------------------------------------- selección de punto
export class MapaSeleccion {
  #mapa = null;
  #marcador = null;

  /** @param {(p:{lat:number,lng:number}) => void} alElegir */
  constructor(contenedor, alElegir) {
    this.contenedor = contenedor;
    this.alElegir = alElegir;
  }

  mostrar(centro) {
    if (!this.#mapa) {
      this.#mapa = crearMapa(this.contenedor, centro ?? [-0.1807, -78.4678], centro ? 16 : 12);
      this.#mapa?.on("click", (e) => this.#marcar(e.latlng, true));
    } else {
      // El contenedor estaba oculto: Leaflet necesita recalcular su tamaño.
      this.#mapa.invalidateSize();
      if (centro) this.#mapa.setView(centro, 16);
    }
  }

  fijar(punto) {
    if (this.#mapa) {
      this.#marcar({ lat: punto.lat, lng: punto.lng }, false);
      this.#mapa.setView([punto.lat, punto.lng], 17);
    }
  }

  #marcar(latlng, avisar) {
    if (!this.#marcador) {
      this.#marcador = L.marker(latlng, { icon: iconoDestino(), draggable: true, keyboard: false }).addTo(this.#mapa);
      this.#marcador.on("dragend", () => this.alElegir(this.#marcador.getLatLng()));
    } else {
      this.#marcador.setLatLng(latlng);
    }
    if (avisar) this.alElegir({ lat: latlng.lat, lng: latlng.lng });
  }
}

// --------------------------------------------------------------- mapa de la reunión
export class MapaReunion {
  #mapa = null;
  #destino = null;
  #circulo = null;
  #marcadores = new Map(); // uid -> {marcador, firma}
  #circulosPrecision = new Map();
  #ruta = null;
  #yo = null;
  #encuadrado = false;

  constructor(contenedor) {
    this.contenedor = contenedor;
  }

  iniciar(destino, radioM) {
    if (!this.#mapa) this.#mapa = crearMapa(this.contenedor, [destino.lat, destino.lng], 16);
    if (!this.#mapa) return;
    this.#mapa.invalidateSize();
    const punto = [destino.lat, destino.lng];
    if (!this.#destino) {
      this.#destino = L.marker(punto, { icon: iconoDestino(), keyboard: false, zIndexOffset: 1000 }).addTo(this.#mapa);
      this.#circulo = L.circle(punto, { radius: radioM, color: "#b91c1c", weight: 2, fillOpacity: 0.08 }).addTo(
        this.#mapa,
      );
    } else {
      this.#destino.setLatLng(punto);
      this.#circulo.setLatLng(punto).setRadius(radioM);
    }
    this.#destino.bindTooltip(this.#etiqueta(destino.nombre.split(",")[0]), {
      className: "etiqueta",
      direction: "top",
      offset: [0, -26],
    });
  }

  /** Limpia todo al salir de la reunión (el mapa se reutiliza en la próxima). */
  limpiar() {
    for (const { marcador } of this.#marcadores.values()) marcador.remove();
    for (const c of this.#circulosPrecision.values()) c.remove();
    this.#marcadores.clear();
    this.#circulosPrecision.clear();
    this.#ruta?.remove();
    this.#yo?.remove();
    this.#destino?.remove();
    this.#circulo?.remove();
    this.#ruta = this.#yo = this.#destino = this.#circulo = null;
    this.#encuadrado = false;
  }

  /** @param {Array<{uid,nombre,foto,color,pos,sinSenal:boolean}>} participantes */
  actualizarParticipantes(participantes, miUid) {
    if (!this.#mapa) return;
    const vistos = new Set();
    for (const p of participantes) {
      if (!p.pos || p.uid === miUid) continue; // la posición propia se dibuja aparte (en vivo)
      vistos.add(p.uid);
      const latlng = [p.pos.lat, p.pos.lng];
      // Solo se recrea el ícono si cambió algo visible (evita parpadeo de la foto).
      const firma = `${p.nombre}|${p.color}|${p.foto.length}|${p.sinSenal}`;
      const actual = this.#marcadores.get(p.uid);
      if (actual && actual.firma === firma) {
        actual.marcador.setLatLng(latlng);
      } else {
        actual?.marcador.remove();
        const marcador = L.marker(latlng, { icon: this.#iconoPersona(p), keyboard: false }).addTo(this.#mapa);
        marcador.bindTooltip(this.#etiqueta(p.nombre), {
          permanent: true,
          className: "etiqueta",
          direction: "bottom",
          offset: [0, 22],
        });
        this.#marcadores.set(p.uid, { marcador, firma });
      }
      this.#precision(p.uid, latlng, p.pos.prec, COLORES[p.color % COLORES.length]);
    }
    for (const [uid, { marcador }] of this.#marcadores) {
      if (!vistos.has(uid)) {
        marcador.remove();
        this.#marcadores.delete(uid);
        this.#circulosPrecision.get(uid)?.remove();
        this.#circulosPrecision.delete(uid);
      }
    }
    if (!this.#encuadrado && this.#marcadores.size) {
      this.encuadrar();
      this.#encuadrado = true;
    }
  }

  /** Posición propia: punto azul pulsante + círculo de precisión. */
  moverYo(pos) {
    if (!this.#mapa) return;
    const latlng = [pos.lat, pos.lng];
    if (!this.#yo) {
      const el = document.createElement("div");
      el.className = "marcador-yo";
      this.#yo = L.marker(latlng, {
        icon: L.divIcon({ html: el, className: "", iconSize: [20, 20], iconAnchor: [10, 10] }),
        keyboard: false,
        zIndexOffset: 2000,
      }).addTo(this.#mapa);
      this.#yo.bindTooltip(this.#etiqueta("Tú"), { permanent: true, className: "etiqueta", direction: "bottom", offset: [0, 12] });
    } else {
      this.#yo.setLatLng(latlng);
    }
    this.#precision("yo", latlng, pos.prec, "#2563eb");
    if (!this.#encuadrado) {
      this.encuadrar();
      this.#encuadrado = true;
    }
  }

  quitarYo() {
    this.#yo?.remove();
    this.#yo = null;
    this.#circulosPrecision.get("yo")?.remove();
    this.#circulosPrecision.delete("yo");
  }

  dibujarRuta(linea) {
    if (!this.#mapa) return;
    this.#ruta?.remove();
    this.#ruta = linea?.length
      ? L.polyline(linea, { color: "#2563eb", weight: 5, opacity: 0.75, dashArray: "1 8", lineCap: "round" }).addTo(
          this.#mapa,
        )
      : null;
  }

  encuadrar() {
    if (!this.#mapa || !this.#destino) return;
    const puntos = [this.#destino.getLatLng()];
    for (const { marcador } of this.#marcadores.values()) puntos.push(marcador.getLatLng());
    if (this.#yo) puntos.push(this.#yo.getLatLng());
    if (puntos.length === 1) this.#mapa.setView(puntos[0], 16);
    else this.#mapa.fitBounds(L.latLngBounds(puntos), { padding: [48, 48], maxZoom: 17 });
  }

  #precision(clave, latlng, radio, color) {
    const circulo = this.#circulosPrecision.get(clave);
    if (circulo) circulo.setLatLng(latlng).setRadius(radio);
    else
      this.#circulosPrecision.set(
        clave,
        L.circle(latlng, { radius: radio, color, weight: 1, fillOpacity: 0.1, interactive: false }).addTo(this.#mapa),
      );
  }

  #iconoPersona(p) {
    const el = document.createElement("div");
    el.className = `marcador${p.sinSenal ? " marcador-sin-senal" : ""}`;
    pintarAvatar(el, p);
    return L.divIcon({ html: el, className: "", iconSize: [44, 44], iconAnchor: [22, 22] });
  }

  /** Leaflet trata un string como HTML: se pasa un elemento con textContent. */
  #etiqueta(texto) {
    const span = document.createElement("span");
    span.textContent = texto;
    return span;
  }
}
