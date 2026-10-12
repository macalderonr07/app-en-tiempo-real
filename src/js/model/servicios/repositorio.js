// Acceso a datos en Cloud Firestore. Es la única capa que conoce las colecciones;
// el resto de la app trabaja con objetos planos (fechas como Date, no Timestamp).
//
// Esquema:
//   usuarios/{uid}                       perfil + reuniones recientes
//   reuniones/{codigo}                   datos del encuentro
//   reuniones/{codigo}/participantes/{uid}  ubicación y ETA de cada persona
//
// Todo lo que se muestra llega por onSnapshot (tiempo real): la UI nunca lee una
// copia propia, solo lo que Firestore notifica (incluidas las escrituras locales,
// que se notifican al instante aunque todavía no hayan llegado al servidor).

import { generarCodigo, HORAS_VIGENCIA } from "../reunion.js";

const MAX_RECIENTES = 8;

export class Repositorio {
  #db;
  #fs;

  constructor({ db, uid, fs }) {
    this.#db = db;
    this.#fs = fs;
    this.uid = uid;
  }

  // ---------------------------------------------------------------- conversión
  #fecha(valor) {
    return valor?.toDate ? valor.toDate() : null;
  }

  #datos(snap) {
    // "estimate": las marcas serverTimestamp() aún pendientes devuelven la hora local
    // estimada en vez de null, así la escritura propia se ve al instante.
    return snap.data({ serverTimestamps: "estimate" });
  }

  #reunionDesde(snap) {
    if (!snap.exists()) return null;
    const d = this.#datos(snap);
    return {
      codigo: snap.id,
      titulo: d.titulo,
      destino: { lat: d.destino.lat, lng: d.destino.lng, nombre: d.destino.nombre },
      hora: this.#fecha(d.hora),
      radioM: d.radioM,
      creadorUid: d.creadorUid,
      finalizada: d.finalizada === true,
    };
  }

  #participanteDesde(snap) {
    const d = this.#datos(snap);
    return {
      uid: snap.id,
      nombre: d.nombre,
      foto: d.foto || "",
      modo: d.modo,
      color: d.color,
      estado: d.estado,
      pos: d.pos ?? null,
      dist: d.dist ?? null,
      distRuta: d.distRuta ?? null,
      eta: d.eta ?? null,
      etaFuente: d.etaFuente ?? null,
      actualizadoEn: this.#fecha(d.actualizadoEn),
      llegoEn: this.#fecha(d.llegoEn),
      pendiente: snap.metadata.hasPendingWrites,
    };
  }

  // ---------------------------------------------------------------- perfil
  #refUsuario() {
    return this.#fs.doc(this.#db, "usuarios", this.uid);
  }

  observarPerfil(alCambiar, alFallar) {
    return this.#fs.onSnapshot(
      this.#refUsuario(),
      (snap) => {
        const d = snap.exists() ? this.#datos(snap) : {};
        alCambiar({
          nombre: d.nombre ?? "",
          modo: d.modo ?? "pie",
          foto: d.foto ?? "",
          recientes: (d.recientes ?? []).map((r) => ({ ...r, hora: this.#fecha(r.hora) })),
          existe: snap.exists(),
        });
      },
      alFallar,
    );
  }

  guardarPerfil({ nombre, modo, foto }) {
    return this.#fs.setDoc(
      this.#refUsuario(),
      { nombre: nombre.trim(), modo, foto: foto || "", actualizadoEn: this.#fs.serverTimestamp() },
      { merge: true },
    );
  }

  async #recordarReciente(reunion) {
    const ref = this.#refUsuario();
    const snap = await this.#fs.getDoc(ref);
    const actuales = snap.exists() ? (snap.data().recientes ?? []) : [];
    const recientes = [
      { codigo: reunion.codigo, titulo: reunion.titulo, hora: this.#fs.Timestamp.fromDate(reunion.hora) },
      ...actuales.filter((r) => r.codigo !== reunion.codigo),
    ].slice(0, MAX_RECIENTES);
    await this.#fs.setDoc(ref, { recientes, actualizadoEn: this.#fs.serverTimestamp() }, { merge: true });
  }

  // ---------------------------------------------------------------- reuniones
  #refReunion(codigo) {
    return this.#fs.doc(this.#db, "reuniones", codigo);
  }

  #refParticipante(codigo, uid = this.uid) {
    return this.#fs.doc(this.#db, "reuniones", codigo, "participantes", uid);
  }

  /** Crea la reunión con un código libre (transacción: no pisa una existente). */
  async crearReunion({ titulo, destino, hora, radioM }) {
    const { Timestamp, serverTimestamp, runTransaction } = this.#fs;
    for (let intento = 0; intento < 5; intento += 1) {
      const codigo = generarCodigo();
      const ref = this.#refReunion(codigo);
      const creada = await runTransaction(this.#db, async (tx) => {
        if ((await tx.get(ref)).exists()) return false;
        tx.set(ref, {
          titulo: titulo.trim(),
          destino: { lat: destino.lat, lng: destino.lng, nombre: destino.nombre.trim().slice(0, 120) },
          hora: Timestamp.fromDate(hora),
          radioM,
          creadorUid: this.uid,
          finalizada: false,
          creadaEn: serverTimestamp(),
          expiraEn: Timestamp.fromMillis(hora.getTime() + HORAS_VIGENCIA * 3600 * 1000),
        });
        return true;
      });
      if (creada) return codigo;
    }
    throw new Error("No se pudo generar un código libre. Intenta de nuevo.");
  }

  async obtenerReunion(codigo) {
    return this.#reunionDesde(await this.#fs.getDoc(this.#refReunion(codigo)));
  }

  observarReunion(codigo, alCambiar, alFallar) {
    return this.#fs.onSnapshot(this.#refReunion(codigo), (s) => alCambiar(this.#reunionDesde(s)), alFallar);
  }

  observarParticipantes(codigo, alCambiar, alFallar) {
    const col = this.#fs.collection(this.#db, "reuniones", codigo, "participantes");
    return this.#fs.onSnapshot(
      col,
      { includeMetadataChanges: false },
      (s) => alCambiar(s.docs.map((d) => this.#participanteDesde(d))),
      alFallar,
    );
  }

  /** Alta (o reingreso) como participante; conserva estado y llegada si ya estaba. */
  async unirse(reunion, perfil, color) {
    const ref = this.#refParticipante(reunion.codigo);
    const previo = await this.#fs.getDoc(ref).catch(() => null);
    const base = {
      nombre: perfil.nombre.trim(),
      foto: perfil.foto || "",
      modo: perfil.modo,
      color,
      actualizadoEn: this.#fs.serverTimestamp(),
      expiraEn: this.#fs.Timestamp.fromMillis(reunion.hora.getTime() + HORAS_VIGENCIA * 3600 * 1000),
    };
    if (previo?.exists()) await this.#fs.updateDoc(ref, base);
    else await this.#fs.setDoc(ref, { ...base, estado: "esperando", pos: null, unidoEn: this.#fs.serverTimestamp() });
    await this.#recordarReciente(reunion).catch(() => {});
  }

  /**
   * Publica la ubicación / ETA / estado propios. No se espera la respuesta del
   * servidor: Firestore aplica el cambio en la caché local (y lo notifica a los
   * listeners) de inmediato, y lo sincroniza cuando hay red.
   */
  publicarEstado(codigo, cambios) {
    const datos = { ...cambios, actualizadoEn: this.#fs.serverTimestamp() };
    if (cambios.estado === "llego") datos.llegoEn = this.#fs.serverTimestamp();
    if (cambios.estado && cambios.estado !== "llego") datos.llegoEn = null;
    return this.#fs.updateDoc(this.#refParticipante(codigo), datos);
  }

  /** Al salir se borra el documento propio: la ubicación no queda guardada. */
  salir(codigo) {
    return this.#fs.deleteDoc(this.#refParticipante(codigo));
  }

  finalizar(codigo) {
    return this.#fs.updateDoc(this.#refReunion(codigo), { finalizada: true });
  }
}
