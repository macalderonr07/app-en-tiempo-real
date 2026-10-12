// Controlador de la pantalla de inicio: perfil (con foto de cámara), creación de
// reuniones (búsqueda / mi ubicación / mapa) y unión por código.

import { validarPerfil, validarReunion, normalizarCodigo, esCodigoValido } from "../model/reunion.js";
import { ServicioCamara, fotoDesdeArchivo } from "../model/servicios/camara.js";
import { buscarLugar, nombrarLugar } from "../model/servicios/mapas.js";
import { avisar } from "../view/comun.js";

export class ControladorInicio {
  perfil = { nombre: "", modo: "pie", foto: "", recientes: [] };
  #destino = null;
  #lugares = [];
  #fotoTemporal = "";
  #camara = new ServicioCamara();
  #posicionConocida = null;

  /** @param {{repo, vista, vistaCamara, navegar: (hash:string)=>void}} deps */
  constructor({ repo, vista, vistaCamara, navegar }) {
    this.repo = repo;
    this.vista = vista;
    this.vistaCamara = vistaCamara;
    this.navegar = navegar;

    vista.vincular({
      onGuardarPerfil: (datos) => this.#guardarPerfil(datos),
      onFoto: () => this.#abrirCamara(),
      onQuitarFoto: () => this.#cambiarFoto(""),
      onCrear: (datos) => this.#crear(datos),
      onUnirse: (texto) => this.#unirse(texto),
      onBuscar: (texto) => this.#buscar(texto),
      onAqui: () => this.#usarMiUbicacion(),
      onElegirMapa: () => this.#mostrarMapa(),
      onPuntoMapa: (p) => this.#elegirPunto(p),
      onElegirResultado: (i) => this.#elegirResultado(i),
    });
    vistaCamara.vincular({
      onCapturar: () => this.#capturar(),
      onRepetir: () => this.#abrirCamara(),
      onUsar: () => {
        this.#cambiarFoto(this.#fotoTemporal);
        vistaCamara.cerrar();
      },
      onArchivo: (archivo) => this.#fotoDeArchivo(archivo),
      onCerrar: () => this.#camara.cerrar(),
    });
  }

  /** Se suscribe al perfil en Firestore; resuelve con la primera lectura. */
  iniciar() {
    return new Promise((resolver) => {
      this.repo.observarPerfil(
        (perfil) => {
          this.perfil = perfil;
          this.vista.pintarPerfil(perfil);
          this.vista.pintarRecientes(perfil.recientes);
          resolver();
        },
        (error) => {
          console.error(error);
          this.vista.estadoPerfil("No se pudo leer tu perfil de Firebase.");
          resolver();
        },
      );
    });
  }

  /**
   * Perfil con el que se entra a una reunión: lo del formulario si es válido (puede
   * ir un instante por delante de Firestore), si no, lo último guardado.
   * @returns {{nombre,modo,foto}|null}
   */
  perfilActual() {
    for (const candidato of [this.vista.leerPerfil(), this.perfil]) {
      if (Object.keys(validarPerfil(candidato)).length === 0) return candidato;
    }
    return null;
  }

  /** Llegó un enlace de invitación pero falta el nombre: se pide antes de entrar. */
  prepararUnion(codigo) {
    this.vista.fijarCodigo(codigo);
    avisar(`Escribe tu nombre y elige cómo llegas para unirte a ${codigo}.`, 6000);
    document.getElementById("perfil-nombre").focus();
  }

  // ------------------------------------------------------------ perfil
  /**
   * Las escrituras de Firestore se aplican al instante en la caché local (y los
   * listeners las ven); la promesa solo se resuelve cuando el servidor confirma, y
   * sin conexión eso ocurre al reconectar. Por eso no se bloquea la UI esperándola.
   */
  #persistirPerfil(datos) {
    this.vista.estadoPerfil(navigator.onLine ? "Guardando en Firebase…" : "Guardado; se sincronizará al reconectar.");
    this.repo
      .guardarPerfil(datos)
      .then(() => this.vista.estadoPerfil("Guardado en Firebase ✓"))
      .catch((e) => {
        console.error(e);
        this.vista.estadoPerfil("No se pudo guardar el perfil. Revisa las reglas de Firestore.");
      });
  }

  #guardarPerfil(datos) {
    if (!this.vista.erroresPerfil(validarPerfil(datos))) return null;
    this.#persistirPerfil(datos);
    return datos;
  }

  /** Antes de crear o unirse: el perfil del formulario tiene que ser válido. */
  #asegurarPerfil() {
    const datos = this.vista.leerPerfil();
    const errores = validarPerfil(datos);
    if (Object.keys(errores).length) {
      this.vista.erroresPerfil(errores);
      avisar("Completa tu perfil primero.");
      return null;
    }
    const cambio = datos.nombre.trim() !== this.perfil.nombre || datos.modo !== this.perfil.modo || datos.foto !== this.perfil.foto;
    if (cambio) this.#persistirPerfil(datos);
    return datos;
  }

  #cambiarFoto(foto) {
    this.vista.pintarFoto(foto);
    const datos = this.vista.leerPerfil();
    // Si el nombre ya es válido la foto se sube ya; si no, se guarda con el perfil.
    if (!Object.keys(validarPerfil(datos)).length) this.#persistirPerfil(datos);
  }

  // ------------------------------------------------------------ cámara
  async #abrirCamara() {
    if (!this.vistaCamara.dialogo.open) this.vistaCamara.abrir();
    this.vistaCamara.modoCaptura();
    if (!ServicioCamara.disponible()) {
      this.vistaCamara.modoCaptura({ camaraDisponible: false });
      this.vistaCamara.estado("Este navegador no permite usar la cámara aquí. Elige un archivo.");
      return;
    }
    this.vistaCamara.estado("Encendiendo la cámara…");
    try {
      await this.#camara.abrir(this.vistaCamara.video);
      this.vistaCamara.estado("Cámara lista. Encuadra tu cara y toca «Tomar foto».");
    } catch (e) {
      this.vistaCamara.modoCaptura({ camaraDisponible: false });
      this.vistaCamara.estado(
        e.name === "NotAllowedError"
          ? "Permiso de cámara denegado. Puedes elegir una foto desde un archivo."
          : "No se pudo abrir la cámara. Puedes elegir una foto desde un archivo.",
      );
    }
  }

  #capturar() {
    try {
      this.#fotoTemporal = this.#camara.capturar(this.vistaCamara.video);
      this.#camara.cerrar();
      this.vistaCamara.modoVistaPrevia(this.#fotoTemporal);
      this.vistaCamara.estado("¿Te gusta? Puedes usarla o repetirla.");
    } catch (e) {
      this.vistaCamara.estado(e.message);
    }
  }

  async #fotoDeArchivo(archivo) {
    try {
      this.#camara.cerrar();
      this.#fotoTemporal = await fotoDesdeArchivo(archivo);
      this.vistaCamara.modoVistaPrevia(this.#fotoTemporal);
      this.vistaCamara.estado("Vista previa de la foto elegida.");
    } catch (e) {
      this.vistaCamara.estado(e.message);
    }
  }

  // ------------------------------------------------------------ destino
  #fijarDestino(destino) {
    this.#destino = destino;
    this.vista.pintarDestino(destino);
  }

  async #buscar(texto) {
    const q = texto.trim();
    if (q.length < 3) return this.vista.estadoBusqueda("Escribe al menos 3 caracteres.");
    this.vista.estadoBusqueda("Buscando…");
    try {
      this.#lugares = await buscarLugar(q, this.#posicionConocida);
      this.vista.pintarResultados(this.#lugares);
      this.vista.estadoBusqueda(
        this.#lugares.length
          ? `${this.#lugares.length} resultado(s). Elige uno de la lista.`
          : "Sin resultados. Prueba con otra dirección o elige en el mapa.",
      );
    } catch {
      this.vista.estadoBusqueda("No se pudo buscar (¿sin conexión?). Prueba elegir en el mapa.");
    }
  }

  #elegirResultado(i) {
    const lugar = this.#lugares[i];
    if (!lugar) return;
    this.#fijarDestino(lugar);
    this.vista.mapaSeleccion.fijar(lugar);
  }

  #ubicacionActual() {
    return new Promise((ok, falla) =>
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => ok({ lat: coords.latitude, lng: coords.longitude, prec: coords.accuracy }),
        falla,
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
      ),
    );
  }

  async #usarMiUbicacion() {
    if (!("geolocation" in navigator)) return this.vista.estadoBusqueda("Este dispositivo no ofrece ubicación.");
    this.vista.estadoBusqueda("Obteniendo tu ubicación…");
    try {
      const pos = await this.#ubicacionActual();
      this.#posicionConocida = pos;
      this.vista.estadoBusqueda(`Ubicación obtenida (±${Math.round(pos.prec)} m).`);
      await this.#elegirPunto(pos);
      this.vista.mapaSeleccion.fijar(pos);
    } catch {
      this.vista.estadoBusqueda("No se pudo obtener tu ubicación. Revisa el permiso y el GPS.");
    }
  }

  async #mostrarMapa() {
    const centro = this.#destino ?? this.#posicionConocida;
    this.vista.mapaSeleccion.mostrar(centro ? [centro.lat, centro.lng] : null);
    if (this.#destino) this.vista.mapaSeleccion.fijar(this.#destino);
  }

  async #elegirPunto({ lat, lng }) {
    this.#fijarDestino({ lat, lng, nombre: "Buscando la dirección…" });
    const nombre = await nombrarLugar({ lat, lng });
    // Si mientras tanto se eligió otro punto, no se pisa.
    if (this.#destino?.lat === lat && this.#destino?.lng === lng) this.#fijarDestino({ lat, lng, nombre });
  }

  // ------------------------------------------------------------ crear / unirse
  async #crear(datos) {
    const perfil = this.#asegurarPerfil();
    if (!perfil) return;
    const reunion = { ...datos, destino: this.#destino };
    if (!this.vista.erroresCrear(validarReunion(reunion))) return;
    if (!navigator.onLine) return this.vista.estadoCrear("Necesitas conexión para crear la reunión.");

    this.vista.estadoCrear("Creando la reunión en Firebase…", true);
    try {
      const codigo = await this.repo.crearReunion(reunion);
      this.vista.estadoCrear("", false);
      this.vista.limpiarCrear();
      this.#destino = null;
      this.navegar(`#/r/${codigo}`);
    } catch (e) {
      console.error(e);
      this.vista.estadoCrear(
        e.code === "permission-denied"
          ? "Firebase rechazó la reunión (reglas de seguridad). Revisa firestore.rules."
          : "No se pudo crear la reunión. Intenta de nuevo.",
        false,
      );
    }
  }

  #unirse(texto) {
    const codigo = normalizarCodigo(texto);
    if (!esCodigoValido(codigo)) {
      this.vista.erroresUnirse({ codigo: "El código tiene 6 letras o números (sin O, I ni L)." });
      return;
    }
    this.vista.erroresUnirse({});
    if (!this.#asegurarPerfil()) return;
    this.navegar(`#/r/${codigo}`);
  }
}
