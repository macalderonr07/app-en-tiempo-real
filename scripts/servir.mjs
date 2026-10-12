// Servidor estático mínimo para probar dist/ en http://localhost:8080
// (localhost es "contexto seguro": funcionan GPS, cámara y Service Worker).
// Para probar en el celular hace falta HTTPS: ver README ("Probar en el celular").

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PUERTO = Number(process.env.PORT ?? 8080);
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export function crearServidor(raiz = RAIZ) {
  return createServer(async (req, res) => {
    const ruta = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const archivo = normalize(join(raiz, ruta.endsWith("/") ? `${ruta}index.html` : ruta));
    if (!archivo.startsWith(raiz)) return res.writeHead(403).end();
    try {
      const cuerpo = await readFile(archivo);
      res.writeHead(200, { "Content-Type": TIPOS[extname(archivo)] ?? "application/octet-stream" }).end(cuerpo);
    } catch {
      res.writeHead(404).end("No encontrado");
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  crearServidor().listen(PUERTO, () => console.log(`Sirviendo dist/ en http://localhost:${PUERTO}`));
}
