// Screen Wake Lock API: mantiene la pantalla encendida mientras se comparte la
// ubicación. Un navegador no puede seguir el GPS con la pantalla apagada o la app en
// segundo plano, así que en la reunión conviene que la pantalla no se bloquee.

export class BloqueoPantalla {
  #bloqueo = null;
  deseado = false;

  static disponible() {
    return "wakeLock" in navigator;
  }

  constructor() {
    // El sistema suelta el bloqueo al cambiar de pestaña; se recupera al volver.
    document.addEventListener("visibilitychange", () => {
      if (this.deseado && document.visibilityState === "visible") this.activar();
    });
  }

  async activar() {
    this.deseado = true;
    if (!BloqueoPantalla.disponible() || this.#bloqueo) return Boolean(this.#bloqueo);
    try {
      this.#bloqueo = await navigator.wakeLock.request("screen");
      this.#bloqueo.addEventListener("release", () => (this.#bloqueo = null));
      return true;
    } catch {
      return false;
    }
  }

  async desactivar() {
    this.deseado = false;
    await this.#bloqueo?.release();
    this.#bloqueo = null;
  }
}
