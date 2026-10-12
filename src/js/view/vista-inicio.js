// Vista de inicio: perfil, crear reunión, unirse con código y reuniones recientes.
// Solo lee el DOM y lo pinta; las decisiones las toma ControladorInicio.

import { MODOS } from "../model/eta.js";
import { $, mostrarErrores, pintarAvatar } from "./comun.js";
import { aValorFechaLocal, fechaYHora } from "./formato.js";
import { MapaSeleccion } from "./vista-mapa.js";

export class VistaInicio {
  formPerfil = $("form-perfil");
  formCrear = $("form-crear");
  formUnirse = $("form-unirse");
  #modos = $("perfil-modos");
  #resultados = $("resultados");
  #fotoActual = "";
  mapaSeleccion;

  constructor() {
    // Radios de "¿Cómo vas a llegar?" generados desde el modelo (una sola fuente).
    for (const [valor, { etiqueta }] of Object.entries(MODOS)) {
      const label = document.createElement("label");
      label.className =
        "flex min-h-tap cursor-pointer items-center gap-2 rounded-lg border border-slate-400 px-3 has-[:checked]:border-teal-700 has-[:checked]:bg-teal-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-amber-500";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "modo";
      input.value = valor;
      input.className = "h-5 w-5 accent-teal-700";
      // "A pie" marcado de entrada: el perfil de Firestore puede tardar en llegar y
      // el formulario debe poder guardarse igual.
      input.checked = valor === "pie";
      label.append(input, document.createTextNode(etiqueta));
      this.#modos.append(label);
    }
    this.mapaSeleccion = new MapaSeleccion($("mapa-seleccion"), () => {});
    this.reiniciarHora();
  }

  /** @param {{onGuardarPerfil, onFoto, onQuitarFoto, onCrear, onUnirse, onBuscar, onAqui, onElegirMapa, onPuntoMapa, onElegirResultado}} h */
  vincular(h) {
    this.formPerfil.addEventListener("submit", (e) => {
      e.preventDefault();
      h.onGuardarPerfil(this.leerPerfil());
    });
    $("btn-foto").addEventListener("click", h.onFoto);
    $("btn-quitar-foto").addEventListener("click", h.onQuitarFoto);
    this.formCrear.addEventListener("submit", (e) => {
      e.preventDefault();
      h.onCrear(this.leerReunion());
    });
    this.formUnirse.addEventListener("submit", (e) => {
      e.preventDefault();
      h.onUnirse($("unirse-codigo").value);
    });
    $("btn-buscar").addEventListener("click", () => h.onBuscar($("crear-buscar").value));
    // Enter en el buscador busca (no envía el formulario de creación).
    $("crear-buscar").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        h.onBuscar(e.target.value);
      }
    });
    $("btn-aqui").addEventListener("click", h.onAqui);
    $("btn-elegir-mapa").addEventListener("click", () => {
      const caja = $("mapa-seleccion-caja");
      const abrir = caja.hidden;
      caja.hidden = !abrir;
      $("btn-elegir-mapa").setAttribute("aria-expanded", String(abrir));
      if (abrir) h.onElegirMapa();
    });
    this.mapaSeleccion.alElegir = h.onPuntoMapa;
    this.#resultados.addEventListener("change", (e) => h.onElegirResultado(Number(e.target.value)));
  }

  // ------------------------------------------------------------ perfil
  leerPerfil() {
    return {
      nombre: $("perfil-nombre").value,
      modo: this.formPerfil.querySelector('input[name="modo"]:checked')?.value ?? "",
      foto: this.#fotoActual,
    };
  }

  /** Pinta el perfil que llega de Firestore sin pisar lo que el usuario está escribiendo. */
  pintarPerfil(perfil, { forzar = false } = {}) {
    const nombre = $("perfil-nombre");
    if (forzar || document.activeElement !== nombre) nombre.value = perfil.nombre;
    const radio = this.formPerfil.querySelector(`input[name="modo"][value="${perfil.modo}"]`);
    if (radio) radio.checked = true;
    this.pintarFoto(perfil.foto, perfil.nombre);
  }

  pintarFoto(foto, nombre = $("perfil-nombre").value) {
    this.#fotoActual = foto;
    pintarAvatar($("perfil-avatar"), { nombre, foto });
    $("btn-quitar-foto").hidden = !foto;
    $("btn-foto").textContent = foto ? "Cambiar foto" : "Tomar foto";
  }

  erroresPerfil(errores) {
    return mostrarErrores(this.formPerfil, errores, "perfil");
  }

  estadoPerfil(texto) {
    $("perfil-estado").textContent = texto;
  }

  // ------------------------------------------------------------ crear
  reiniciarHora() {
    // Propuesta: dentro de una hora, redondeado al cuarto de hora siguiente.
    const d = new Date(Date.now() + 60 * 60_000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    $("crear-hora").value = aValorFechaLocal(d);
    $("crear-hora").min = aValorFechaLocal(new Date());
  }

  leerReunion() {
    const hora = $("crear-hora").value;
    return {
      titulo: $("crear-titulo").value,
      hora: hora ? new Date(hora) : null,
      radioM: Number($("crear-radio").value),
    };
  }

  erroresCrear(errores) {
    return mostrarErrores(this.formCrear, errores, "crear");
  }

  estadoCrear(texto, ocupado = false) {
    $("crear-estado").textContent = texto;
    this.formCrear.querySelector('button[type="submit"]').disabled = ocupado;
  }

  estadoBusqueda(texto) {
    $("buscar-estado").textContent = texto;
  }

  /** Resultados de búsqueda como grupo de radios (navegable con flechas). */
  pintarResultados(lugares) {
    this.#resultados.replaceChildren();
    lugares.forEach((lugar, i) => {
      const label = document.createElement("label");
      label.className =
        "flex min-h-tap cursor-pointer items-start gap-3 rounded-lg border border-slate-300 p-3 has-[:checked]:border-teal-700 has-[:checked]:bg-teal-50";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "resultado";
      input.value = String(i);
      input.className = "mt-1 h-5 w-5 shrink-0 accent-teal-700";
      const texto = document.createElement("span");
      texto.className = "text-sm";
      texto.textContent = lugar.nombre;
      label.append(input, texto);
      this.#resultados.append(label);
    });
  }

  pintarDestino(destino) {
    $("destino-elegido").textContent = destino ? `Punto elegido: ${destino.nombre}` : "";
    $("crear-destino-error").textContent = "";
  }

  limpiarCrear() {
    this.formCrear.reset();
    this.#resultados.replaceChildren();
    this.pintarDestino(null);
    this.estadoBusqueda("");
    this.reiniciarHora();
  }

  // ------------------------------------------------------------ unirse / recientes
  erroresUnirse(errores) {
    return mostrarErrores(this.formUnirse, errores, "unirse");
  }

  fijarCodigo(codigo) {
    $("unirse-codigo").value = codigo;
  }

  pintarRecientes(recientes) {
    const lista = $("lista-recientes");
    lista.replaceChildren(
      ...recientes.map((r) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `#/r/${encodeURIComponent(r.codigo)}`;
        a.className = "flex min-h-tap flex-wrap items-center justify-between gap-x-3 py-2 hover:underline";
        const titulo = document.createElement("span");
        titulo.className = "font-medium text-teal-800";
        titulo.textContent = r.titulo;
        const detalle = document.createElement("span");
        detalle.className = "text-sm text-slate-700";
        detalle.textContent = `${fechaYHora(r.hora)} · ${r.codigo}`;
        a.append(titulo, detalle);
        li.append(a);
        return li;
      }),
    );
    $("recientes-vacio").hidden = recientes.length > 0;
  }
}
