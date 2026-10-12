// Diálogo de la cámara (<dialog> nativo: trae foco atrapado, Escape y fondo inerte).
// La vista no sabe cómo se obtiene la imagen: el controlador le pasa los callbacks.

import { $ } from "./comun.js";

export class VistaCamara {
  dialogo = $("dialogo-camara");
  video = $("camara-video");
  #vista = $("camara-vista");
  #estado = $("camara-estado");
  #capturar = $("btn-capturar");
  #repetir = $("btn-repetir");
  #usar = $("btn-usar-foto");

  /** @param {{onCapturar, onRepetir, onUsar, onArchivo, onCerrar}} acciones */
  vincular({ onCapturar, onRepetir, onUsar, onArchivo, onCerrar }) {
    this.#capturar.addEventListener("click", onCapturar);
    this.#repetir.addEventListener("click", onRepetir);
    this.#usar.addEventListener("click", onUsar);
    $("btn-cerrar-camara").addEventListener("click", () => this.dialogo.close());
    $("camara-archivo").addEventListener("change", (e) => {
      const archivo = e.target.files?.[0];
      e.target.value = "";
      if (archivo) onArchivo(archivo);
    });
    // "close" cubre Cancelar, Escape y el cierre tras "Usar esta foto".
    this.dialogo.addEventListener("close", onCerrar);
  }

  abrir() {
    this.modoCaptura();
    this.dialogo.showModal();
  }

  cerrar() {
    if (this.dialogo.open) this.dialogo.close();
  }

  estado(texto) {
    this.#estado.textContent = texto;
  }

  modoCaptura({ camaraDisponible = true } = {}) {
    this.#vista.hidden = true;
    this.#vista.removeAttribute("src");
    this.video.hidden = !camaraDisponible;
    this.#capturar.hidden = !camaraDisponible;
    this.#repetir.hidden = true;
    this.#usar.hidden = true;
  }

  modoVistaPrevia(dataUrl) {
    this.#vista.src = dataUrl;
    this.#vista.hidden = false;
    this.#capturar.hidden = true;
    this.#repetir.hidden = false;
    this.#usar.hidden = false;
    this.#usar.focus();
  }
}
