// Dobles de prueba del SDK de Firebase para verificar-e2e.mjs.
// Playwright los sirve en lugar de los módulos reales de gstatic, así las pruebas
// recorren la app completa (crear, unirse, tiempo real) sin un proyecto real.
// Implementan solo lo que usa src/js/model/servicios/{firebase,repositorio}.js.

export const APP = `export const initializeApp = (config) => ({ config });`;

export const AUTH = `
const auth = { currentUser: null, authStateReady: async () => {} };
export const initializeAuth = () => auth;
export const indexedDBLocalPersistence = {};
export const browserLocalPersistence = {};
export async function signInAnonymously(a) { a.currentUser = { uid: "uid-yo" }; return { user: a.currentUser }; }
`;

export const FIRESTORE = `
export class Timestamp {
  constructor(ms) { this.ms = ms; }
  toDate() { return new Date(this.ms); }
  static fromDate(d) { return new Timestamp(d.getTime()); }
  static fromMillis(ms) { return new Timestamp(ms); }
  static now() { return new Timestamp(Date.now()); }
}
const almacen = new Map();
const oyentes = new Set();
const resolver = (v) =>
  v && v.__servidor ? Timestamp.now()
  : v && typeof v === "object" && !(v instanceof Timestamp) && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolver(x)]))
    : v;
const foto = (ruta) => {
  const d = almacen.get(ruta);
  return { id: ruta.split("/").at(-1), exists: () => d !== undefined, data: () => (d ? { ...d } : undefined),
           metadata: { hasPendingWrites: false } };
};
function emitir(o) {
  if (o.ref.tipo === "doc") return o.cb(foto(o.ref.ruta));
  const n = o.ref.ruta.split("/").length + 1;
  const docs = [...almacen.keys()].filter((k) => k.startsWith(o.ref.ruta + "/") && k.split("/").length === n).map(foto);
  o.cb({ docs });
}
const notificar = () => queueMicrotask(() => oyentes.forEach(emitir));
export const serverTimestamp = () => ({ __servidor: true });
export const initializeFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const doc = (_db, ...s) => ({ tipo: "doc", ruta: s.join("/") });
export const collection = (_db, ...s) => ({ tipo: "col", ruta: s.join("/") });
export async function getDoc(ref) { return foto(ref.ruta); }
export async function setDoc(ref, datos, op) {
  almacen.set(ref.ruta, { ...(op?.merge ? almacen.get(ref.ruta) : {}), ...resolver(datos) });
  notificar();
}
export async function updateDoc(ref, datos) {
  if (!almacen.has(ref.ruta)) throw Object.assign(new Error("no existe"), { code: "not-found" });
  almacen.set(ref.ruta, { ...almacen.get(ref.ruta), ...resolver(datos) });
  notificar();
}
export async function deleteDoc(ref) { almacen.delete(ref.ruta); notificar(); }
export function onSnapshot(ref, ...args) {
  const o = { ref, cb: args.find((a) => typeof a === "function") };
  oyentes.add(o);
  queueMicrotask(() => emitir(o));
  return () => oyentes.delete(o);
}
export async function runTransaction(_db, fn) {
  return fn({ get: getDoc, set: (ref, d) => { setDoc(ref, d); } });
}
// Para que la prueba simule a otra persona escribiendo en la reunión.
window.__firestore = { almacen, notificar, Timestamp };
`;

export const CONFIG = `export const firebaseConfig = { apiKey: "prueba", authDomain: "prueba.firebaseapp.com", projectId: "prueba", appId: "1:1:web:1" };`;
