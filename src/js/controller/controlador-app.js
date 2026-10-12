// Controlador principal: conecta Firebase, crea los demás controladores y enruta.
//
// Rutas (hash, para que funcione en cualquier hosting estático sin reescrituras):
//   #/           inicio
//   #/r/CODIGO   reunión (también es el enlace de invitación)

import { normalizarCodigo, esCodigoValido } from "../model/reunion.js";
import { Repositorio } from "../model/servicios/repositorio.js";
import { $, avisar, mostrarEstadoRed, mostrarVista } from "../view/comun.js";
import { VistaCamara } from "../view/vista-camara.js";
import { VistaInicio } from "../view/vista-inicio.js";
import { VistaReunion } from "../view/vista-reunion.js";
import { ControladorInicio } from "./controlador-inicio.js";
import { ControladorReunion } from "./controlador-reunion.js";

export class ControladorApp {
  async iniciar() {
    this.#registrarServiceWorker();
    mostrarEstadoRed(navigator.onLine);
    window.addEventListener("online", () => {
      mostrarEstadoRed(true);
      avisar("Conexión recuperada: sincronizando con Firebase.");
    });
    window.addEventListener("offline", () => {
      mostrarEstadoRed(false);
      avisar("Sin conexión. Los cambios se enviarán al reconectar.");
    });
    // Un import dinámico fallido queda en caché del navegador: reintentar = recargar.
    $("btn-reintentar").addEventListener("click", () => location.reload());

    let repo;
    try {
      // Import dinámico: si el SDK de Firebase no carga, la página igual muestra el error.
      const { conectarFirebase } = await import("../model/servicios/firebase.js");
      repo = new Repositorio(await conectarFirebase());
    } catch (e) {
      console.error(e);
      $("error-detalle").textContent =
        e.name === "ErrorConfiguracion"
          ? e.message
          : navigator.onLine
            ? `Firebase respondió con un error: ${e.code ?? e.message}. ¿Está activado el inicio de sesión anónimo y creada la base de Firestore?`
            : "Sin conexión. Abre la app con internet al menos una vez para iniciar tu sesión.";
      mostrarVista("vista-error");
      return;
    }

    const navegar = (hash) => {
      if (location.hash === hash) this.#enrutar();
      else location.hash = hash;
    };
    this.inicio = new ControladorInicio({ repo, vista: new VistaInicio(), vistaCamara: new VistaCamara(), navegar });
    this.reunion = new ControladorReunion({
      repo,
      vista: new VistaReunion(),
      obtenerPerfil: () => this.inicio.perfilActual(),
      navegar,
    });

    // El inicio se muestra sin esperar el perfil: llega por onSnapshot y se pinta solo.
    // Solo entrar a una reunión necesita el perfil (ver #enrutar).
    this.perfilListo = this.inicio.iniciar();
    window.addEventListener("hashchange", () => this.#enrutar());
    this.#enrutar();
  }

  async #enrutar() {
    const coincidencia = location.hash.match(/^#\/r\/([^/?#]+)/);
    if (!coincidencia) {
      await this.reunion.cerrarVista();
      document.title = "Punto de Encuentro";
      mostrarVista("vista-inicio");
      return;
    }
    const codigo = normalizarCodigo(decodeURIComponent(coincidencia[1]));
    if (!esCodigoValido(codigo)) {
      avisar("El enlace de invitación no es válido.");
      location.hash = "#/";
      return;
    }
    await this.perfilListo;
    if (!this.inicio.perfilActual()) {
      // Enlace de invitación en un dispositivo sin perfil: primero el nombre.
      await this.reunion.cerrarVista();
      mostrarVista("vista-inicio", { enfocar: false });
      this.inicio.prepararUnion(codigo);
      return;
    }
    await this.reunion.entrar(codigo);
  }

  #registrarServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("Service Worker no registrado", e));
  }
}
