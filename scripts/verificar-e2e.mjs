// Pruebas de extremo a extremo en Chromium (Playwright) sobre dist/: npm run verificar:e2e
//
// Firebase, OSRM, Nominatim y las teselas se reemplazan por dobles (tests/firebase-falso.mjs
// y respuestas fijas): la prueba no depende de la red ni de un proyecto real.
// Comprueba en celular y escritorio:
//   - sin errores de JS, sin scroll horizontal, axe-core WCAG 2.2 AA = 0 violaciones;
//   - error claro si Firebase no está configurado;
//   - flujo completo: perfil -> crear reunión -> GPS -> distancia/ETA -> otra persona
//     aparece y llega en tiempo real -> llegada propia por GPS.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, devices } from "playwright";
import { crearServidor } from "./servir.mjs";
import * as falso from "../tests/firebase-falso.mjs";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const servidor = crearServidor();
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
const BASE = `http://localhost:${servidor.address().port}/`;

// Destino de prueba: Plaza Grande, Quito. Inicio: ~1 km al sur.
const DESTINO = { lat: -0.2201, lng: -78.5123 };
const INICIO = { latitude: -0.2291, longitude: -78.5123, accuracy: 8 };

const fallos = [];
async function prueba(nombre, fn) {
  try {
    await fn();
    console.log(`  ✔ ${nombre}`);
  } catch (e) {
    fallos.push(nombre);
    console.log(`  ✘ ${nombre}\n      ${e.message.split("\n").slice(0, 6).join("\n      ")}`);
  }
}
const esperar = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function nuevaPagina(navegador, dispositivo, { configurado = true } = {}) {
  const contexto = await navegador.newContext({
    ...dispositivo,
    serviceWorkers: "block", // si no, el SW atendería las peticiones antes que page.route
    bypassCSP: true, // solo para poder inyectar axe-core como script en línea
    geolocation: INICIO,
    permissions: ["geolocation"],
    locale: "es-EC",
    timezoneId: "America/Guayaquil",
  });
  const js = (body) => ({ status: 200, contentType: "text/javascript", body });
  await contexto.route("https://www.gstatic.com/firebasejs/**", (r) => {
    const url = r.request().url();
    r.fulfill(js(url.endsWith("app.js") ? falso.APP : url.endsWith("auth.js") ? falso.AUTH : falso.FIRESTORE));
  });
  await contexto.route("**/js/config/firebase-config.js", (r) =>
    configurado ? r.fulfill(js(falso.CONFIG)) : r.fulfill({ status: 404, body: "" }),
  );
  await contexto.route("https://routing.openstreetmap.de/**", (r) =>
    r.fulfill({
      json: {
        code: "Ok",
        routes: [{ distance: 1350, duration: 1000, geometry: { coordinates: [[INICIO.longitude, INICIO.latitude], [DESTINO.lng, DESTINO.lat]] } }],
      },
    }),
  );
  await contexto.route("https://nominatim.openstreetmap.org/**", (r) =>
    r.request().url().includes("/search")
      ? r.fulfill({ json: [{ lat: String(DESTINO.lat), lon: String(DESTINO.lng), display_name: "Plaza Grande, Centro Histórico, Quito" }] })
      : r.fulfill({ json: { display_name: "Calle de prueba, Quito" } }),
  );
  await contexto.route("https://*.tile.openstreetmap.org/**", (r) => r.fulfill({ status: 204 }));
  await contexto.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 204 }));

  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on("pageerror", (e) => errores.push(`JS: ${e.message}`));
  pagina.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errores.push(m.text()));
  return { contexto, pagina, errores };
}

async function revisarPagina(pagina, errores, etiqueta) {
  const problemas = [...errores];
  const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (desborde > 0) problemas.push(`scroll horizontal de ${desborde}px`);
  await pagina.addScriptTag({ content: AXE });
  const { violations } = await pagina.evaluate(() =>
    window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }),
  );
  for (const v of violations) problemas.push(`axe ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")})`);
  esperar(problemas.length === 0, `${etiqueta}:\n${problemas.join("\n")}`);
}

const navegador = await chromium.launch();
const DISPOSITIVOS = { celular: devices["Pixel 7"], escritorio: { viewport: { width: 1366, height: 900 } } };

await prueba("Sin configuración de Firebase muestra cómo conectarla", async () => {
  const { contexto, pagina } = await nuevaPagina(navegador, DISPOSITIVOS.celular, { configurado: false });
  await pagina.goto(BASE);
  await pagina.locator("#vista-error").waitFor();
  const texto = await pagina.locator("#error-detalle").textContent();
  esperar(texto.includes("firebase-config"), `mensaje inesperado: ${texto}`);
  await revisarPagina(pagina, [], "pantalla de error");
  await contexto.close();
});

await prueba("Service Worker se instala y la app abre sin conexión", async () => {
  // Sin bloquear el SW (las demás pruebas lo bloquean para poder simular Firebase).
  const contexto = await navegador.newContext({ ...DISPOSITIVOS.celular });
  await contexto.route("https://www.gstatic.com/**", (r) => r.fulfill({ status: 503, body: "" }));
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on("pageerror", (e) => errores.push(e.message));
  pagina.on("console", (m) => /ServiceWorker|Service Worker/i.test(m.text()) && errores.push(m.text()));
  await pagina.goto(BASE);
  const activo = await pagina.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then((r) => Boolean(r.active)),
      new Promise((ok) => setTimeout(() => ok(false), 10_000)),
    ]),
  );
  esperar(activo, `el Service Worker no se activó. ${errores.join(" | ")}`);
  await contexto.setOffline(true);
  await pagina.reload();
  const estilos = await pagina.evaluate(() => getComputedStyle(document.body).backgroundColor);
  esperar(estilos === "rgb(241, 245, 249)", `sin conexión la página no tiene estilos (${estilos})`);
  esperar((await pagina.title()) === "Punto de Encuentro", "sin conexión no cargó la página");
  await contexto.close();
});

for (const [nombre, dispositivo] of Object.entries(DISPOSITIVOS)) {
  await prueba(`[${nombre}] flujo completo en tiempo real`, async () => {
    const { contexto, pagina, errores } = await nuevaPagina(navegador, dispositivo);
    await pagina.goto(BASE);
    await pagina.locator("#vista-inicio").waitFor();
    await revisarPagina(pagina, errores, "inicio");

    // Perfil: se valida y se guarda en "Firestore".
    await pagina.getByRole("button", { name: "Guardar perfil" }).click();
    esperar((await pagina.locator("#perfil-nombre-error").textContent()).length > 0, "falta error de nombre");
    await pagina.getByLabel("Nombre o apodo").fill("Matías");
    await pagina.getByLabel("A pie").check();
    await pagina.getByRole("button", { name: "Guardar perfil" }).click();
    await pagina.getByText("Guardado en Firebase ✓").waitFor();

    // Crear reunión: buscar lugar y elegir resultado.
    await pagina.getByLabel("¿Qué plan es?").fill("Café en la Plaza");
    await pagina.getByLabel("Buscar dirección o lugar").fill("Plaza Grande");
    await pagina.getByRole("button", { name: "Buscar", exact: true }).click();
    await pagina.getByLabel(/Plaza Grande, Centro/).check();
    await pagina.getByText("Punto elegido: Plaza Grande").waitFor();
    await pagina.getByRole("button", { name: "Crear y compartir" }).click();

    await pagina.locator("#vista-reunion").waitFor();
    esperar(/^#\/r\/[A-HJKMNP-Z2-9]{6}$/.test(new URL(pagina.url()).hash), `ruta: ${pagina.url()}`);
    esperar((await pagina.locator("#titulo-reunion").textContent()) === "Café en la Plaza", "título");

    // GPS ya permitido: comparte solo y calcula distancia/ETA con la ruta.
    await pagina.getByText(/Estás a 1,4 km por calle \(995 m en línea recta\)/).waitFor({ timeout: 10_000 });
    esperar((await pagina.locator("#btn-compartir").getAttribute("aria-pressed")) === "true", "no comparte");
    await pagina.locator("#lista-faltan").getByText("Matías (tú)").waitFor();
    await revisarPagina(pagina, errores, "reunión");

    // Otra persona se une y se mueve (escritura "remota" en Firestore).
    const codigo = new URL(pagina.url()).hash.slice(4);
    await pagina.evaluate((codigo) => {
      const { almacen, notificar, Timestamp } = window.__firestore;
      almacen.set(`reuniones/${codigo}/participantes/uid-ana`, {
        nombre: "Ana", foto: "", modo: "bici", color: 2, estado: "en-camino",
        pos: { lat: -0.2101, lng: -78.5123, prec: 12, vel: 4 }, dist: 1110, distRuta: 1400, eta: 330,
        etaFuente: "ruta", actualizadoEn: Timestamp.now(), llegoEn: null,
      });
      notificar();
    }, codigo);
    await pagina.locator("#lista-faltan").getByText("Ana").waitFor();
    await pagina.locator("#lista-faltan").getByText(/al norte del punto/).waitFor();

    await pagina.evaluate((codigo) => {
      const { almacen, notificar, Timestamp } = window.__firestore;
      const ruta = `reuniones/${codigo}/participantes/uid-ana`;
      almacen.set(ruta, { ...almacen.get(ruta), estado: "llego", llegoEn: Timestamp.now(), eta: 0 });
      notificar();
    }, codigo);
    await pagina.locator("#lista-llegaron").getByText("Ana").waitFor();
    await pagina.getByText("Ana llegó al punto de encuentro.").first().waitFor();

    // Llegada propia: dos lecturas de GPS dentro del radio.
    for (let i = 0; i < 3; i += 1) {
      await contexto.setGeolocation({ latitude: DESTINO.lat + 0.00001 * i, longitude: DESTINO.lng, accuracy: 5 });
      await pagina.waitForTimeout(400);
    }
    await pagina.getByText("Llegaste al punto de encuentro.").waitFor({ timeout: 10_000 });
    await pagina.waitForTimeout(4500); // ritmo mínimo de publicación
    await pagina.locator("#lista-llegaron").getByText("Matías (tú)").waitFor({ timeout: 10_000 });

    // Salir borra la participación.
    await pagina.getByRole("button", { name: "Salir y borrar mi ubicación" }).click();
    await pagina.locator("#dialogo-confirmar").getByRole("button", { name: "Salir" }).click();
    await pagina.locator("#vista-inicio").waitFor();
    const sigue = await pagina.evaluate((c) => window.__firestore.almacen.has(`reuniones/${c}/participantes/uid-yo`), codigo);
    esperar(!sigue, "el documento del participante no se borró");
    await pagina.getByRole("link", { name: /Café en la Plaza/ }).waitFor();
    esperar(errores.length === 0, errores.join("\n"));
    await contexto.close();
  });
}

await navegador.close();
servidor.close();
console.log(fallos.length ? `\n${fallos.length} prueba(s) fallaron` : "\nTodas las pruebas pasaron");
process.exit(fallos.length ? 1 : 0);
