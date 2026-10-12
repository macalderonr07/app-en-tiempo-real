// Pruebas unitarias del modelo (lógica pura, sin navegador): npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { distancia, distanciaHaversine, distanciaVincenty, rumbo, puntoCardinal } from "../src/js/model/geo.js";
import { FiltroKalman } from "../src/js/model/filtro-kalman.js";
import { estimarLlegada, FACTOR_DESVIO, MODOS, retrasoEstimado } from "../src/js/model/eta.js";
import {
  DetectorLlegada,
  esCodigoValido,
  estadoVisible,
  generarCodigo,
  normalizarCodigo,
  ordenarParticipantes,
  validarPerfil,
  validarReunion,
} from "../src/js/model/reunion.js";

test("Vincenty coincide con el valor de referencia (Flinders Peak -> Buninyong)", () => {
  // Ejemplo clásico del artículo de Vincenty / Geoscience Australia: 54 972,271 m.
  const a = { lat: -(37 + 57 / 60 + 3.7203 / 3600), lng: 144 + 25 / 60 + 29.5244 / 3600 };
  const b = { lat: -(37 + 39 / 60 + 10.1561 / 3600), lng: 143 + 55 / 60 + 35.3839 / 3600 };
  assert.ok(Math.abs(distanciaVincenty(a, b) - 54972.271) < 0.01);
});

test("distancia corta en Quito: Haversine (esfera) erra ~5 m por km frente a Vincenty", () => {
  const a = { lat: -0.2105, lng: -78.4910 };
  const b = { lat: -0.2015, lng: -78.4910 };
  const v = distancia(a, b);
  // En el ecuador un grado de latitud mide 110 574 m en el elipsoide WGS-84.
  assert.ok(Math.abs(v - 995.17) < 0.05, `obtuvo ${v}`);
  const errorEsfera = distanciaHaversine(a, b) - v;
  assert.ok(errorEsfera > 5 && errorEsfera < 6.5, `error esfera ${errorEsfera}`);
  assert.equal(distancia(a, a), 0);
});

test("rumbo y punto cardinal", () => {
  const o = { lat: 0, lng: 0 };
  assert.equal(Math.round(rumbo(o, { lat: 1, lng: 0 })), 0);
  assert.equal(Math.round(rumbo(o, { lat: 0, lng: 1 })), 90);
  assert.equal(puntoCardinal(rumbo(o, { lat: -1, lng: -1 })), "suroeste");
});

test("Kalman: una lectura imprecisa casi no mueve una estimación buena", () => {
  const f = new FiltroKalman();
  f.procesar({ lat: 0, lng: 0, prec: 5, ts: 0 });
  const r = f.procesar({ lat: 0.001, lng: 0, prec: 200, ts: 1000 }); // salto de ~110 m con ±200 m
  assert.ok(distancia({ lat: 0, lng: 0 }, r) < 5, "debería quedarse cerca");
  const r2 = f.procesar({ lat: 0.0001, lng: 0, prec: 3, ts: 2000 }); // lectura muy buena a 11 m
  assert.ok(distancia({ lat: 0.0001, lng: 0 }, r2) < 6, "una lectura precisa sí se sigue");
});

test("Kalman: dos lecturas precisas lejanas seguidas reinician la estimación (salto)", () => {
  const f = new FiltroKalman();
  f.procesar({ lat: 0, lng: 0, prec: 8, ts: 0 });
  const lejos = { lat: 0.009, lng: 0 }; // ~1 km
  const r1 = f.procesar({ ...lejos, prec: 5, ts: 500 });
  assert.ok(distancia(lejos, r1) > 100, "una sola lectura lejana se toma como ruido");
  const r2 = f.procesar({ ...lejos, prec: 5, ts: 1000 });
  assert.ok(distancia(lejos, r2) < 1, "la segunda confirma el salto");
});

test("ETA sin ruta usa desvío urbano y velocidad del modo", () => {
  const r = estimarLlegada({ distRecta: 1000, modo: "pie" });
  assert.equal(r.fuente, "estimada");
  assert.equal(r.distRuta, 1000 * FACTOR_DESVIO);
  assert.equal(r.segundos, Math.round((1000 * FACTOR_DESVIO) / MODOS.pie.velocidad));
});

test("ETA con ruta se escala con lo que falta y mezcla velocidad observada", () => {
  const ruta = { distancia: 1500, duracion: 1200, distRectaBase: 1000 };
  const mitad = estimarLlegada({ distRecta: 500, modo: "pie", ruta });
  assert.equal(mitad.fuente, "ruta");
  assert.equal(mitad.distRuta, 750);
  assert.equal(mitad.segundos, 600);
  const rapido = estimarLlegada({ distRecta: 500, modo: "pie", ruta, velObservada: 2.5 });
  assert.ok(rapido.segundos < 600);
  // Velocidad absurda (salto de GPS) se ignora.
  assert.equal(estimarLlegada({ distRecta: 500, modo: "pie", ruta, velObservada: 40 }).segundos, 600);
});

test("retraso respecto a la hora acordada", () => {
  const hora = new Date(10 * 60_000);
  assert.equal(retrasoEstimado(300, hora, 0), -300);
  assert.equal(retrasoEstimado(900, hora, 0), 300);
});

test("códigos: formato, alfabeto sin ambiguos y normalización", () => {
  for (let i = 0; i < 200; i += 1) assert.ok(esCodigoValido(generarCodigo()));
  assert.equal(normalizarCodigo(" ab-c 23x "), "ABC23X");
  assert.equal(esCodigoValido("ABCO23"), false); // la O no existe en el alfabeto
});

test("validaciones de perfil y reunión", () => {
  assert.deepEqual(validarPerfil({ nombre: "Ana", modo: "pie", foto: "" }), {});
  assert.ok(validarPerfil({ nombre: "A", modo: "nave", foto: "data:text/html,x" }).nombre);
  const ahora = new Date("2026-10-12T12:00:00");
  const ok = {
    titulo: "Cine",
    hora: new Date("2026-10-12T18:00:00"),
    destino: { lat: -0.2, lng: -78.5, nombre: "Plaza" },
    radioM: 50,
  };
  assert.deepEqual(validarReunion(ok, ahora), {});
  const mal = validarReunion({ ...ok, hora: new Date("2026-10-10T18:00:00"), destino: null, radioM: 7 }, ahora);
  assert.deepEqual(Object.keys(mal).sort(), ["destino", "hora", "radioM"]);
});

test("detector de llegada: 2 lecturas dentro, histéresis al salir y llegada manual", () => {
  const d = new DetectorLlegada(50);
  assert.equal(d.actualizar(30, 10), false);
  assert.equal(d.llego, false, "una sola lectura no alcanza");
  assert.equal(d.actualizar(28, 10), true);
  assert.equal(d.llego, true);
  d.actualizar(120, 10); // fuera del radio pero dentro de 3x: sigue "llegó"
  assert.equal(d.llego, true);
  d.actualizar(400, 10);
  assert.equal(d.llego, false);
  d.forzarLlegada();
  d.actualizar(900, 10);
  assert.equal(d.llego, true, "lo marcado a mano se respeta");
});

test("estado visible y orden de participantes", () => {
  const ahora = Date.now();
  const viejo = { estado: "en-camino", pos: { lat: 0, lng: 0 }, actualizadoEn: new Date(ahora - 5 * 60_000) };
  assert.equal(estadoVisible(viejo, ahora), "sin-senal");
  assert.equal(estadoVisible({ ...viejo, actualizadoEn: new Date(ahora) }, ahora), "en-camino");
  const { faltan, llegaron } = ordenarParticipantes([
    { nombre: "B", estado: "en-camino", eta: 600 },
    { nombre: "A", estado: "en-camino", eta: 120 },
    { nombre: "C", estado: "llego", llegoEn: new Date(1) },
    { nombre: "D", estado: "esperando", eta: null },
  ]);
  assert.deepEqual(faltan.map((p) => p.nombre), ["A", "B", "D"]);
  assert.deepEqual(llegaron.map((p) => p.nombre), ["C"]);
});
