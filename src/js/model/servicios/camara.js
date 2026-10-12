// Captura de foto de perfil con la Media Capture API (getUserMedia).
//
// La foto se recorta cuadrada, se reduce a 192 px y se comprime (WebP, o JPEG en
// Safari que no codifica WebP). Así pesa ~10-25 KB y se guarda como data URL dentro
// del documento de Firestore del usuario: no hace falta Cloud Storage (que en
// proyectos nuevos exige el plan de pago Blaze).

import { MAX_FOTO } from "../reunion.js";

const LADO = 192;

export class ServicioCamara {
  #stream = null;

  static disponible() {
    return Boolean(navigator.mediaDevices?.getUserMedia);
  }

  /** Enciende la cámara frontal y la conecta al <video>. */
  async abrir(video, frontal = true) {
    this.cerrar();
    this.#stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: frontal ? "user" : "environment", width: { ideal: 720 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = this.#stream;
    await video.play();
  }

  /** Apaga la cámara (libera el indicador de "cámara en uso" del sistema). */
  cerrar() {
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
  }

  capturar(video) {
    return comprimir(video, video.videoWidth, video.videoHeight, true);
  }
}

/** Para el respaldo <input type="file" capture>: convierte el archivo en data URL. */
export async function fotoDesdeArchivo(archivo) {
  if (!archivo?.type.startsWith("image/")) throw new Error("El archivo no es una imagen.");
  const bitmap = await createImageBitmap(archivo);
  try {
    return comprimir(bitmap, bitmap.width, bitmap.height, false);
  } finally {
    bitmap.close();
  }
}

function comprimir(fuente, ancho, alto, espejo) {
  const lado = Math.min(ancho, alto);
  if (!lado) throw new Error("La cámara todavía no entrega imagen.");
  const lienzo = document.createElement("canvas");
  lienzo.width = LADO;
  lienzo.height = LADO;
  const ctx = lienzo.getContext("2d");
  if (espejo) {
    // La vista previa de la cámara frontal se muestra en espejo; la foto también,
    // para que salga como la persona se vio al tomarla.
    ctx.translate(LADO, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(fuente, (ancho - lado) / 2, (alto - lado) / 2, lado, lado, 0, 0, LADO, LADO);

  for (const calidad of [0.8, 0.6, 0.4]) {
    let url = lienzo.toDataURL("image/webp", calidad);
    if (!url.startsWith("data:image/webp")) url = lienzo.toDataURL("image/jpeg", calidad);
    if (url.length <= MAX_FOTO) return url;
  }
  throw new Error("No se pudo comprimir la foto.");
}
