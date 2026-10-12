// Vista de la reunión: cabecera, "tu llegada", mapa en vivo y lista de participantes.
// La lista es la alternativa en texto del mapa (WCAG 1.1.1 / 1.3.1): dice estado,
// distancia, tiempo, puntualidad y la antigüedad del dato de cada persona.

import { MODOS } from "../model/eta.js";
import { ESTADOS } from "../model/reunion.js";
import { $, pintarAvatar } from "./comun.js";
import * as f from "./formato.js";
import { MapaReunion } from "./vista-mapa.js";

const INSIGNIAS = {
  llego: ["Llegó", "bg-emerald-100 text-emerald-900"],
  "en-camino": ["En camino", "bg-sky-100 text-sky-900"],
  esperando: ["Sin ubicación", "bg-slate-200 text-slate-800"],
  pausado: ["Pausado", "bg-slate-200 text-slate-800"],
  "sin-senal": ["Sin señal reciente", "bg-amber-100 text-amber-900"],
};

export class VistaReunion {
  mapa = new MapaReunion($("mapa"));

  /** @param {{onCompartir, onLlegue, onPantalla, onInvitar, onEncuadrar, onSalir, onFinalizar}} h */
  vincular(h) {
    $("btn-compartir").addEventListener("click", h.onCompartir);
    $("btn-llegue").addEventListener("click", h.onLlegue);
    $("btn-pantalla").addEventListener("click", h.onPantalla);
    $("btn-invitar").addEventListener("click", h.onInvitar);
    $("btn-encuadrar").addEventListener("click", h.onEncuadrar);
    $("btn-salir").addEventListener("click", h.onSalir);
    $("btn-finalizar").addEventListener("click", h.onFinalizar);
  }

  pintarReunion(r, esCreador) {
    $("titulo-reunion").textContent = r.titulo;
    $("r-destino").textContent = r.destino.nombre;
    $("r-hora").textContent = f.fechaYHora(r.hora);
    $("r-hora").dateTime = r.hora.toISOString();
    $("r-codigo").textContent = r.codigo;
    $("r-finalizada").hidden = !r.finalizada;
    $("btn-finalizar").hidden = !esCreador || r.finalizada;
    for (const id of ["btn-compartir", "btn-llegue"]) $(id).disabled = r.finalizada;
    document.title = `${r.titulo} · Punto de Encuentro`;
    this.mapa.iniciar(r.destino, r.radioM);
  }

  pintarCuenta(hora) {
    $("r-cuenta").textContent = f.cuentaRegresiva(hora);
  }

  // ------------------------------------------------------------ mi estado
  pintarCompartiendo(activo) {
    const b = $("btn-compartir");
    b.setAttribute("aria-pressed", String(activo));
    b.textContent = activo ? "Compartiendo ubicación" : "Compartir mi ubicación";
  }

  pintarPantalla(activo, disponible) {
    const b = $("btn-pantalla");
    b.hidden = !disponible;
    b.setAttribute("aria-pressed", String(activo));
  }

  pintarLlegue(llego) {
    $("btn-llegue").textContent = llego ? "Ya marcaste que llegaste" : "Ya llegué";
    $("btn-llegue").disabled = llego;
  }

  /** @param {{dist, distRuta, eta, fuente, retraso, llego, modo}} m */
  pintarMiResumen(m) {
    let texto;
    if (m.llego) texto = "Llegaste al punto de encuentro.";
    else if (m.buscando) texto = "Buscando señal GPS…";
    else if (m.dist == null) texto = "Activa «Compartir mi ubicación» para calcular tu distancia y tiempo de llegada.";
    else {
      const aprox = m.fuente === "ruta" ? "" : " aprox.";
      texto =
        `Estás a ${f.distancia(m.distRuta)}${aprox} por calle (${f.distancia(m.dist)} en línea recta). ` +
        `${MODOS[m.modo]?.etiqueta ?? ""}: ≈ ${f.duracion(m.eta)}, llegarías ${f.puntualidad(m.retraso)}.`;
    }
    $("mi-resumen").textContent = texto;
  }

  pintarPrecision(pos) {
    $("mi-precision").textContent = pos
      ? `Precisión del GPS: ±${pos.prec} m (${f.calidadPrecision(pos.prec)})` +
        (pos.vel != null && pos.vel > 0.5 ? ` · velocidad ${Math.round(pos.vel * 3.6)} km/h` : "")
      : "";
  }

  error(texto) {
    $("mi-error").textContent = texto ?? "";
  }

  // ------------------------------------------------------------ participantes
  /**
   * @param {{faltan: any[], llegaron: any[]}} grupos  participantes ya enriquecidos
   *        con estadoVisible, retraso y esYo.
   */
  pintarParticipantes({ faltan, llegaron }) {
    $("titulo-faltan").textContent = `Faltan llegar (${faltan.length})`;
    $("titulo-llegaron").textContent = `Ya llegaron (${llegaron.length})`;
    this.#pintarLista($("lista-faltan"), faltan, "Todos llegaron. ¡A disfrutar!");
    this.#pintarLista($("lista-llegaron"), llegaron, "Nadie llegó todavía.");
  }

  #pintarLista(ul, lista, vacio) {
    if (!lista.length) {
      const li = document.createElement("li");
      li.className = "text-slate-700";
      li.textContent = vacio;
      ul.replaceChildren(li);
      return;
    }
    ul.replaceChildren(...lista.map((p) => this.#item(p)));
  }

  #item(p) {
    const li = document.createElement("li");
    li.className = "flex gap-3 rounded-xl border border-slate-200 p-3";

    const avatar = document.createElement("div");
    avatar.className =
      "grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full text-base font-bold text-white";
    avatar.setAttribute("aria-hidden", "true");
    pintarAvatar(avatar, p);

    const cuerpo = document.createElement("div");
    cuerpo.className = "min-w-0 flex-1";

    const fila = document.createElement("p");
    fila.className = "flex flex-wrap items-center gap-x-2 gap-y-1";
    const nombre = document.createElement("span");
    nombre.className = "font-semibold";
    nombre.textContent = p.esYo ? `${p.nombre} (tú)` : p.nombre;
    const [texto, clases] = INSIGNIAS[p.estadoVisible] ?? INSIGNIAS.esperando;
    const insignia = document.createElement("span");
    insignia.className = `rounded-full px-2 py-0.5 text-xs font-semibold ${clases}`;
    insignia.textContent = texto;
    fila.append(nombre, insignia);
    if (p.retraso != null && p.retraso >= 90 && p.estado !== "llego") {
      const tarde = document.createElement("span");
      tarde.className = "rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900";
      tarde.textContent = "Llegará tarde";
      fila.append(tarde);
    }

    const detalle = document.createElement("p");
    detalle.className = "mt-1 text-sm text-slate-800";
    detalle.textContent = this.#detalle(p);

    const meta = document.createElement("p");
    meta.className = "mt-0.5 text-xs text-slate-700";
    meta.textContent = [
      MODOS[p.modo]?.etiqueta,
      p.pos ? `±${Math.round(p.pos.prec)} m` : null,
      p.estado === "llego" ? `llegó a las ${f.horaCorta(p.llegoEn)}` : `actualizado ${f.hace(p.actualizadoEn)}`,
      p.pendiente ? "sincronizando…" : null,
    ]
      .filter(Boolean)
      .join(" · ");

    cuerpo.append(fila, detalle, meta);
    li.append(avatar, cuerpo);
    return li;
  }

  #detalle(p) {
    if (p.estado === "llego") return "Está en el punto de encuentro.";
    if (p.estadoVisible === "pausado") return ESTADOS.pausado + ".";
    if (p.dist == null) return "Aún no comparte su ubicación.";
    const aprox = p.etaFuente === "ruta" ? "" : " aprox.";
    const recta = `${f.distancia(p.dist)} en línea recta${p.direccion ? `, al ${p.direccion} del punto` : ""}`;
    const partes = [`A ${f.distancia(p.distRuta ?? p.dist)}${aprox} por calle (${recta})`, `≈ ${f.duracion(p.eta)}`];
    if (p.eta != null && p.actualizadoEn) {
      const llegada = new Date(p.actualizadoEn.getTime() + p.eta * 1000);
      partes.push(`llega ~${f.horaCorta(llegada)} (${f.puntualidad(p.retraso)})`);
    }
    return partes.join(" · ");
  }
}
