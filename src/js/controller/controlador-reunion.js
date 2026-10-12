// Controlador de la reunión: el corazón de la app.
//
// Flujo en tiempo real:
//   GPS (watchPosition) -> filtro de Kalman -> distancia Vincenty + ruta OSRM -> ETA
//   -> se publica en Firestore (reuniones/{codigo}/participantes/{uid})
//   -> onSnapshot notifica a TODOS los dispositivos (incluido este) -> vista + mapa.
//
// Para no gastar batería ni la cuota gratuita de Firestore (20 000 escrituras/día),
// la posición se publica como mucho cada 4 s y solo si cambió algo relevante; si no,
// un "latido" cada 30 s mantiene viva la marca "actualizado hace…".

import { estimarLlegada } from "../model/eta.js";
import { distancia, puntoCardinal, rumbo } from "../model/geo.js";
import { DetectorLlegada, estadoVisible, ordenarParticipantes } from "../model/reunion.js";
import { calcularRuta } from "../model/servicios/mapas.js";
import { BloqueoPantalla } from "../model/servicios/pantalla.js";
import { ServicioUbicacion } from "../model/servicios/ubicacion.js";
import { alertaSonora, anunciar, avisar, COLORES, confirmar, mostrarVista } from "../view/comun.js";

const PUBLICAR_MIN_MS = 4000;
const LATIDO_MS = 30_000;
const RUTA_MIN_MS = 45_000;
const RUTA_REINTENTO_MS = 60_000;

/** Color estable por persona (mismo color en todos los dispositivos). */
function colorPara(uid) {
  let h = 0;
  for (const c of uid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % COLORES.length;
}

export class ControladorReunion {
  codigo = null;
  reunion = null;
  #participantes = [];
  #estadosPrevios = new Map();
  #desuscribir = [];
  #reloj = null;
  #ticks = 0;

  #ubicacion = new ServicioUbicacion();
  #pantalla = new BloqueoPantalla();
  #detector = null;
  #pos = null;
  #ruta = null; // {distancia, duracion, linea, distRectaBase, origen, ts}
  #rutaPendiente = false;
  #rutaFalloTs = 0;
  #ultimaPublicacion = null; // {ts, pos, estado, eta}
  #calculo = null;
  #perfil = null;

  /** @param {{repo, vista, obtenerPerfil: () => any, navegar}} deps */
  constructor({ repo, vista, obtenerPerfil, navegar }) {
    this.repo = repo;
    this.vista = vista;
    this.obtenerPerfil = obtenerPerfil;
    this.navegar = navegar;

    vista.vincular({
      onCompartir: () => (this.#ubicacion.activo ? this.#pausar() : this.#compartir()),
      onLlegue: () => this.#marcarLlegada(),
      onPantalla: () => this.#alternarPantalla(),
      onInvitar: () => this.#invitar(),
      onEncuadrar: () => vista.mapa.encuadrar(),
      onSalir: () => this.#salir(),
      onFinalizar: () => this.#finalizar(),
    });
    this.#ubicacion.addEventListener("posicion", (e) => this.#alMoverse(e.detail));
    this.#ubicacion.addEventListener("error", (e) => {
      this.vista.error(e.detail.mensaje);
      if (e.detail.codigo === 1) this.#pausar({ publicar: false });
    });
  }

  // ------------------------------------------------------------ entrar / salir
  async entrar(codigo) {
    if (this.codigo === codigo) return mostrarVista("vista-reunion");
    await this.cerrarVista();
    mostrarVista("vista-cargando", { enfocar: false });

    let reunion;
    try {
      reunion = await this.repo.obtenerReunion(codigo);
    } catch (e) {
      console.error(e);
      avisar(navigator.onLine ? "No se pudo abrir la reunión." : "Sin conexión: no se pudo abrir la reunión.");
      return this.navegar("#/");
    }
    if (!reunion) {
      avisar(`No existe ninguna reunión con el código ${codigo}.`, 6000);
      return this.navegar("#/");
    }

    this.#perfil = this.obtenerPerfil();
    try {
      await this.repo.unirse(reunion, this.#perfil, colorPara(this.repo.uid));
    } catch (e) {
      console.error(e);
      avisar("Firebase no permitió unirte a la reunión.");
      return this.navegar("#/");
    }

    this.codigo = codigo;
    this.reunion = reunion;
    this.#detector = new DetectorLlegada(reunion.radioM);
    this.#calculo = null;
    this.vista.pintarReunion(reunion, reunion.creadorUid === this.repo.uid);
    this.vista.pintarCompartiendo(false);
    this.vista.pintarLlegue(false);
    this.vista.pintarPantalla(false, BloqueoPantalla.disponible());
    this.vista.pintarMiResumen({ dist: null });
    this.vista.pintarPrecision(null);
    this.vista.error("");
    mostrarVista("vista-reunion");

    this.#desuscribir.push(
      this.repo.observarReunion(codigo, (r) => this.#alCambiarReunion(r), (e) => this.#errorTiempoReal(e)),
      this.repo.observarParticipantes(codigo, (l) => this.#alCambiarParticipantes(l), (e) => this.#errorTiempoReal(e)),
    );
    this.#reloj = setInterval(() => this.#tic(), 1000);
    this.#tic();

    // Si ya dio permiso de ubicación antes, se comparte directamente.
    if (!reunion.finalizada && (await ServicioUbicacion.estadoPermiso()) === "granted") this.#compartir();
  }

  /** Deja la vista (sin borrar la participación): se detiene GPS y suscripciones. */
  async cerrarVista() {
    if (!this.codigo) return;
    if (this.#ubicacion.activo) this.#pausar();
    this.#desuscribir.forEach((fn) => fn());
    this.#desuscribir = [];
    clearInterval(this.#reloj);
    this.vista.mapa.limpiar();
    this.#estadosPrevios.clear();
    this.#ruta = null;
    this.#pos = null;
    this.#ultimaPublicacion = null;
    this.codigo = null;
    this.reunion = null;
    document.title = "Punto de Encuentro";
  }

  // ------------------------------------------------------------ tiempo real (Firestore -> vista)
  #alCambiarReunion(r) {
    if (!r) {
      avisar("La reunión fue eliminada.");
      this.cerrarVista();
      return this.navegar("#/");
    }
    const recienFinalizada = r.finalizada && !this.reunion?.finalizada;
    this.reunion = r;
    if (this.#detector) this.#detector.radioM = r.radioM;
    this.vista.pintarReunion(r, r.creadorUid === this.repo.uid);
    if (recienFinalizada) {
      anunciar("La reunión fue finalizada.");
      if (this.#ubicacion.activo) this.#pausar();
    }
  }

  #alCambiarParticipantes(lista) {
    // Anuncios de llegadas y nuevas personas (no en la primera carga).
    const primeraCarga = this.#estadosPrevios.size === 0;
    for (const p of lista) {
      const previo = this.#estadosPrevios.get(p.uid);
      if (!primeraCarga && p.uid !== this.repo.uid) {
        if (previo === undefined) anunciar(`${p.nombre} se unió a la reunión.`);
        else if (previo !== "llego" && p.estado === "llego") {
          avisar(`${p.nombre} llegó al punto de encuentro.`);
          anunciar(`${p.nombre} llegó al punto de encuentro.`);
          alertaSonora();
        }
      }
      this.#estadosPrevios.set(p.uid, p.estado);
    }
    this.#participantes = lista;
    this.#repintarParticipantes();
  }

  #repintarParticipantes() {
    if (!this.reunion) return;
    const ahora = Date.now();
    const { destino, hora } = this.reunion;
    const enriquecidos = this.#participantes.map((p) => {
      const visible = estadoVisible(p, ahora);
      return {
        ...p,
        esYo: p.uid === this.repo.uid,
        estadoVisible: visible,
        sinSenal: visible === "sin-senal",
        direccion: p.pos ? puntoCardinal(rumbo(destino, p.pos)) : null,
        retraso:
          p.eta != null && p.actualizadoEn
            ? Math.round((p.actualizadoEn.getTime() + p.eta * 1000 - hora.getTime()) / 1000)
            : null,
      };
    });
    this.vista.pintarParticipantes(ordenarParticipantes(enriquecidos));
    this.vista.mapa.actualizarParticipantes(enriquecidos, this.repo.uid);
  }

  #errorTiempoReal(e) {
    console.error(e);
    this.vista.error(
      e.code === "permission-denied"
        ? "Firebase denegó el acceso a la reunión (reglas de seguridad)."
        : "Se perdió la conexión en tiempo real. Reintentando…",
    );
  }

  #tic() {
    if (!this.reunion) return;
    this.vista.pintarCuenta(this.reunion.hora);
    this.#ticks += 1;
    if (this.#ticks % 5 === 0) this.#repintarParticipantes(); // "hace X s" y "sin señal"
    if (this.#ubicacion.activo && this.#pos && Date.now() - (this.#ultimaPublicacion?.ts ?? 0) > LATIDO_MS) {
      this.#publicar(true);
    }
  }

  // ------------------------------------------------------------ mi ubicación (GPS -> Firestore)
  #compartir() {
    if (!ServicioUbicacion.disponible()) return this.vista.error("Este dispositivo no ofrece ubicación.");
    if (this.reunion?.finalizada) return;
    this.vista.error("");
    this.#ubicacion.iniciar();
    this.vista.pintarCompartiendo(true);
    this.vista.pintarMiResumen({ buscando: true });
    this.#activarPantalla();
  }

  #pausar({ publicar = true } = {}) {
    this.#ubicacion.detener();
    // Al reanudar, la primera publicación debe volver a enviar el estado.
    this.#ultimaPublicacion = null;
    this.vista.pintarCompartiendo(false);
    this.vista.mapa.quitarYo();
    this.vista.mapa.dibujarRuta(null);
    this.#pantalla.desactivar();
    this.vista.pintarPantalla(false, BloqueoPantalla.disponible());
    if (publicar && this.codigo && !this.#detector?.llego) {
      this.repo.publicarEstado(this.codigo, { estado: "pausado" }).catch((e) => console.error(e));
    }
  }

  #alMoverse(pos) {
    if (!this.reunion) return;
    this.#pos = pos;
    this.vista.mapa.moverYo(pos);
    this.vista.pintarPrecision(pos);
    this.#quizasRecalcularRuta(pos);
    this.#recalcular();
  }

  /** Pide una ruta nueva solo si hace falta (sin ruta, se movió bastante o pasó tiempo). */
  #quizasRecalcularRuta(pos) {
    if (this.#rutaPendiente || !navigator.onLine) return;
    const ahora = Date.now();
    if (!this.#ruta && ahora - this.#rutaFalloTs < RUTA_REINTENTO_MS) return;
    if (this.#ruta) {
      const movido = distancia(pos, this.#ruta.origen);
      const viejo = ahora - this.#ruta.ts > RUTA_MIN_MS;
      if (!(movido > 300 || (viejo && movido > 50))) return;
    }
    // Sin buena precisión la ruta podría salir desde la calle equivocada.
    if (pos.prec > 100) return;

    const destino = this.reunion.destino;
    const modo = this.#perfil.modo;
    this.#rutaPendiente = true;
    calcularRuta(pos, destino, modo)
      .then((r) => {
        if (!this.reunion) return;
        this.#ruta = { ...r, distRectaBase: distancia(pos, destino), origen: pos, ts: Date.now() };
        this.vista.mapa.dibujarRuta(r.linea);
        this.#recalcular();
      })
      .catch(() => (this.#rutaFalloTs = Date.now()))
      .finally(() => (this.#rutaPendiente = false));
  }

  #recalcular() {
    const pos = this.#pos;
    if (!pos || !this.reunion) return;
    const dist = distancia(pos, this.reunion.destino);
    const llegada = estimarLlegada({ distRecta: dist, modo: this.#perfil.modo, ruta: this.#ruta, velObservada: pos.vel });
    const cambio = this.#detector.actualizar(dist, pos.prec);
    const llego = this.#detector.llego;

    if (cambio && llego) {
      alertaSonora();
      avisar("¡Llegaste al punto de encuentro!");
      this.vista.mapa.dibujarRuta(null);
    }
    this.#calculo = {
      dist: Math.round(dist),
      distRuta: llego ? 0 : llegada.distRuta,
      eta: llego ? 0 : llegada.segundos,
      fuente: llegada.fuente,
      retraso: Math.round((Date.now() + llegada.segundos * 1000 - this.reunion.hora.getTime()) / 1000),
      llego,
      modo: this.#perfil.modo,
    };
    this.vista.pintarMiResumen(this.#calculo);
    this.vista.pintarLlegue(llego);
    this.#publicar(cambio);
  }

  /** Escribe en Firestore respetando el ritmo mínimo (salvo cambios de estado). */
  #publicar(forzar = false) {
    const pos = this.#pos;
    const c = this.#calculo;
    if (!pos || !c || !this.codigo) return;
    const estado = c.llego ? "llego" : "en-camino";
    const ultima = this.#ultimaPublicacion;
    const ahora = Date.now();

    if (!forzar && ultima) {
      const pronto = ahora - ultima.ts < PUBLICAR_MIN_MS;
      const movido = distancia(pos, ultima.pos) > Math.max(5, pos.prec / 2);
      const etaCambio = Math.abs((ultima.eta ?? 0) - c.eta) >= 30;
      if (pronto || (estado === ultima.estado && !movido && !etaCambio && ahora - ultima.ts < LATIDO_MS)) return;
    }

    this.#ultimaPublicacion = { ts: ahora, pos, estado, eta: c.eta };
    const redondear = (n) => Math.round(n * 1e6) / 1e6; // ~11 cm: más no aporta y ocupa más
    const cambios = {
      estado,
      pos: {
        lat: redondear(pos.lat),
        lng: redondear(pos.lng),
        prec: pos.prec,
        vel: pos.vel == null ? null : Math.round(pos.vel * 10) / 10,
      },
      dist: c.dist,
      distRuta: c.distRuta,
      eta: c.eta,
      etaFuente: c.fuente,
    };
    // Solo al cambiar a "llegó" se fija llegoEn; en las demás publicaciones no se toca.
    if (ultima?.estado === estado) delete cambios.estado;
    this.repo.publicarEstado(this.codigo, cambios).catch((e) => {
      console.error(e);
      this.vista.error("No se pudo publicar tu ubicación en Firebase.");
    });
  }

  #marcarLlegada() {
    if (!this.codigo) return;
    this.#detector.forzarLlegada();
    this.vista.pintarLlegue(true);
    this.vista.mapa.dibujarRuta(null);
    if (this.#pos) {
      this.#recalcular();
      this.#publicar(true);
    } else {
      this.repo.publicarEstado(this.codigo, { estado: "llego", eta: 0, distRuta: 0 }).catch((e) => console.error(e));
    }
    this.vista.pintarMiResumen({ llego: true });
    avisar("Avisamos a todos que llegaste.");
  }

  // ------------------------------------------------------------ acciones
  async #activarPantalla() {
    const ok = await this.#pantalla.activar();
    this.vista.pintarPantalla(ok, BloqueoPantalla.disponible());
  }

  async #alternarPantalla() {
    if (this.#pantalla.deseado) {
      await this.#pantalla.desactivar();
      this.vista.pintarPantalla(false, true);
    } else {
      await this.#activarPantalla();
    }
  }

  async #invitar() {
    const { codigo, titulo } = this.reunion;
    const url = `${location.origin}${location.pathname}#/r/${codigo}`;
    const texto = `Únete a "${titulo}" en Punto de Encuentro. Código: ${codigo}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: titulo, text: texto, url });
      } else {
        await navigator.clipboard.writeText(`${texto}\n${url}`);
        avisar("Enlace de invitación copiado.");
      }
    } catch (e) {
      if (e.name !== "AbortError") avisar(`Comparte este código: ${codigo}`, 8000);
    }
  }

  async #salir() {
    const ok = await confirmar({
      titulo: "¿Salir de la reunión?",
      texto: "Se dejará de compartir tu ubicación y se borrará de Firebase. Puedes volver a unirte con el código.",
      accion: "Salir",
    });
    if (!ok) return;
    const codigo = this.codigo;
    await this.cerrarVista();
    this.repo.salir(codigo).catch((e) => console.error(e));
    this.navegar("#/");
  }

  async #finalizar() {
    const ok = await confirmar({
      titulo: "¿Finalizar la reunión?",
      texto: "Todos dejarán de compartir su ubicación. Esta acción no se puede deshacer.",
      accion: "Finalizar",
    });
    if (ok) this.repo.finalizar(this.codigo).catch(() => avisar("No se pudo finalizar la reunión."));
  }
}
