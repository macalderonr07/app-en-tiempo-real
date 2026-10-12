# Punto de Encuentro: reuniones con ubicación en tiempo real

PWA para planes y salidas. Alguien crea la reunión con un **lugar y una hora**, comparte un
código o enlace, y cada participante ve **en tiempo real** dónde están los que aún no llegan,
a qué **distancia** (por calle y en línea recta), cuánto **tiempo** les falta y si llegarán
**a tiempo o tarde**. Pensada para usarse en el **celular**.

**Stack:** HTML5 semántico (WCAG 2.2 AA, ARIA) · Tailwind CSS 3 (compilado) · JavaScript ES2022
(módulos, clases con campos privados) · **MVC** · **Firebase** (Authentication anónima + Cloud
Firestore en tiempo real) · Leaflet + OpenStreetMap · Service Worker (instalable, abre sin red).
Se publica en **Cloudflare Pages**.

## Cómo funciona la exactitud

| Dato | Cómo se obtiene |
|---|---|
| Posición | `watchPosition` con `enableHighAccuracy` y `maximumAge: 0` (GPS, no solo wifi). Se descartan lecturas peores que ±150 m y se suavizan con un **filtro de Kalman** que pondera cada lectura por su precisión. Si llegan dos lecturas precisas seguidas que no cuadran con la estimación, el filtro se reinicia (el primer fix suele venir del wifi). |
| Distancia en línea recta | Fórmula de **Vincenty** sobre el elipsoide WGS-84 (error de milímetros). Haversine, que supone una Tierra esférica, erra ~5,6 m por km en Quito. |
| Distancia por calle y tiempo | Ruta real con **OSRM** (perfiles a pie / bici / auto). Entre recálculos (cada ≥45 s si se movió >50 m, o al desviarse >300 m) se escala proporcionalmente. |
| ETA | Duración de la ruta mezclada 50/50 con la **velocidad real observada** (media móvil), si es razonable para el medio elegido. Sin red: línea recta × 1,3 y velocidad típica, marcado como "aprox.". |
| Llegada | Dentro del radio elegido (25-200 m) en **2 lecturas seguidas**. Para volver a "en camino" hay que alejarse al triple del radio (histéresis). También existe el botón "Ya llegué". |
| Datos viejos | Si alguien no actualiza en 2 min se marca "Sin señal reciente" y su marcador se ve gris. |

> Un navegador **no puede seguir el GPS con la pantalla apagada**. Por eso, al compartir, la app
> pide mantener la pantalla encendida (Screen Wake Lock API).

## Estructura (MVC)

```
pag_cloudfire/
├── src/                         ← lo que se publica (build -> dist/)
│   ├── index.html               vistas: cargando, error, inicio, reunión + diálogos
│   ├── sw.js · manifest.webmanifest · _headers (CSP y permisos para Cloudflare)
│   ├── assets/                  tailwind.css (fuente) e íconos
│   └── js/
│       ├── app.js               punto de entrada
│       ├── config/              firebase-config.js (tuyo, ignorado por git) + .example
│       ├── model/               lógica pura y testeable
│       │   ├── geo.js           Vincenty, rumbo, puntos cardinales
│       │   ├── filtro-kalman.js suavizado del GPS
│       │   ├── eta.js           distancia por calle + tiempo estimado
│       │   ├── reunion.js       validaciones, códigos, detector de llegada
│       │   └── servicios/       firebase, repositorio (Firestore), ubicacion (GPS),
│       │                        camara (Media Capture), mapas (OSRM/Nominatim), pantalla
│       ├── view/                DOM y mapa: vista-inicio, vista-reunion, vista-mapa,
│       │                        vista-camara, comun (avisos, aria-live), formato
│       └── controller/          controlador-app (router), -inicio, -reunion
├── firestore.rules              reglas de seguridad (¡publicarlas!)
├── firebase.json                para desplegar las reglas con la CLI
├── scripts/                     build, servidor local, pruebas e2e
└── tests/                       pruebas unitarias + doble de Firebase para e2e
```

### APIs del navegador usadas
Geolocation · **Media Capture (`getUserMedia`)** para la foto de perfil, con `<input capture>` como
alternativa · Canvas (recorte y compresión WebP) · Web Share · Clipboard · Screen Wake Lock ·
Vibration · Web Audio (aviso sonoro cuando alguien llega) · Permissions · Service Worker · `<dialog>`.

### Datos en Firebase (todo en tiempo real con `onSnapshot`)
```
usuarios/{uid}                         nombre, modo, foto (data URL ≤60 KB), recientes[]
reuniones/{codigo}                     titulo, destino{lat,lng,nombre}, hora, radioM,
                                       creadorUid, finalizada, creadaEn, expiraEn
reuniones/{codigo}/participantes/{uid} nombre, foto, modo, color, estado, pos{lat,lng,prec,vel},
                                       dist, distRuta, eta, etaFuente, actualizadoEn, llegoEn
```
La foto va dentro del documento (comprimida a ~15 KB) porque **Cloud Storage exige el plan de
pago Blaze** en proyectos nuevos. Firestore guarda una caché offline: sin red, la app muestra los
últimos datos y envía los cambios al reconectar.

---

## Conectar Firebase (paso a paso)

Tu proyecto es **`test-db-en-la-nube`**. Su configuración web ya está en
`src/js/config/firebase-config.js`, que **no se sube a git**. En la consola de Firebase
(<https://console.firebase.google.com>) haz lo siguiente:

1. **Authentication → Comenzar → Sign-in method → Anónimo → Habilitar → Guardar.**
   Cada celular obtiene un usuario anónimo sin pedir correo; las reglas usan su `uid`.
2. **Firestore Database → Crear base de datos.**
   - Ubicación: `southamerica-east1` (São Paulo, la más cercana a Ecuador) o `nam5`. **No se puede cambiar después.**
   - Modo: **producción** (bloqueado). Las reglas reales se cargan en el paso siguiente.
3. **Firestore → Reglas:** borra lo que haya, pega el contenido de `firestore.rules` y pulsa **Publicar**.
   (Alternativa con CLI: `npm i -g firebase-tools && firebase login && firebase use test-db-en-la-nube && firebase deploy --only firestore:rules`.)
4. **Authentication → Configuración → Dominios autorizados:** `localhost` ya viene incluido.
   Cuando publiques en Cloudflare, **agrega tu dominio** `xxxx.pages.dev`.
5. *(Opcional, recomendado)* **Firestore → TTL → Crear política** en el campo `expiraEn` para
   el grupo de colecciones `reuniones` y también para `participantes`. Firestore borrará solo
   las reuniones y ubicaciones 12 h después de la hora acordada.
6. *(Opcional)* En Google Cloud Console → APIs y servicios → Credenciales, restringe la API key a
   *referentes HTTP* (`localhost:*`, `*.pages.dev/*`).

No hace falta Analytics: el fragmento que entrega Firebase lo incluye, pero la app no lo usa.

Luego:

```bash
cd pag_cloudfire
npm install
npm run dev          # build + servidor en http://localhost:8080
```

> **¿La página sale sin estilos?** `assets/styles.css` (Tailwind) y `vendor/leaflet/` no
> están en git: los genera `npm run build`. Después de un build también puedes abrir
> `src/index.html` con Live Server. Si agregas clases de Tailwind, vuelve a correr
> `npm run build` o deja corriendo `npm run watch:css`.

Si algo falta, la app muestra el motivo en pantalla. Por ejemplo,
`auth/admin-restricted-operation` o `auth/configuration-not-found` significan que no se activó el acceso anónimo (paso 1) y
`permission-denied` que no se publicaron las reglas (paso 3).

## Probar en el celular

El GPS y la cámara solo funcionan en **HTTPS** (o `localhost`). Opciones:
- Publicar en Cloudflare Pages (abajo). Es lo más simple.
- Túnel temporal: `npx cloudflared tunnel --url http://localhost:8080` y abrir la URL `https://…trycloudflare.com`
  en el celular. Agrega ese dominio en *Dominios autorizados* de Firebase.

Para probar con varias personas: abre la reunión en dos dispositivos o en una ventana de incógnito.
Cada uno será un usuario anónimo distinto.

## Publicar en GitHub Pages (con verificación automática)

Publicada en **https://macalderonr07.github.io/app-en-tiempo-real/** desde el repo
[`macalderonr07/app-en-tiempo-real`](https://github.com/macalderonr07/app-en-tiempo-real). Ese repo
contiene solo esta carpeta; este es el repo de trabajo.

`.github/workflows/verificar-y-publicar.yml` corre en cada push a `main`:
1. **Verificar:** `npm ci` → pruebas unitarias → build → html-validate → pruebas en Chromium
   (celular, escritorio, axe WCAG 2.2 AA, flujo en tiempo real, Service Worker y modo sin red).
2. **Publicar:** solo si todo lo anterior pasó, sube a Pages **el mismo `dist/` que se probó**.
   Si algo falla, el sitio publicado queda como estaba. En un pull request solo se verifica.

La configuración de Firebase sale de las **variables del repositorio** (Settings → Secrets and
variables → Actions → *Variables*): `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`,
`FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`.

GitHub Pages no permite cabeceras propias, así que la CSP va también en un `<meta>` de
`index.html` (en Cloudflare se envía además por cabecera con `_headers`).

## Publicar en Cloudflare Pages

**Con Git** (Workers & Pages → Crear → Pages → Conectar a Git):

| Campo | Valor |
|---|---|
| Directorio raíz | `pag_cloudfire` |
| Comando de compilación | `npm run build` |
| Directorio de salida | `dist` |
| Variables de entorno | `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID` (los valores de tu `firebaseConfig`) |

El build genera `firebase-config.js` a partir de esas variables. `src/_headers` aplica la CSP y la
`Permissions-Policy` (geolocalización y cámara solo para el propio sitio).

**Sin Git** (desde tu máquina, usa tu `firebase-config.js` local):
```bash
npm run build
npx wrangler pages deploy dist --project-name punto-de-encuentro
```

## Verificación

```bash
npm test               # 12 pruebas unitarias del modelo (Vincenty, Kalman, ETA, reglas)
npm run verificar      # unitarias + build + html-validate + e2e en Chromium
```
Las pruebas e2e reemplazan Firebase, OSRM y Nominatim por dobles en memoria
(`tests/firebase-falso.mjs`) y recorren en celular y escritorio: perfil → crear reunión → GPS →
distancia/ETA → otra persona aparece y llega en tiempo real → llegada propia → salir. También corren
**axe-core (WCAG 2.2 AA)** y verifican que no haya scroll horizontal.

## Accesibilidad (WCAG 2.2 AA)
- Landmarks (`header`, `main`, `footer`, `section` con `aria-labelledby`), enlace "Saltar al contenido".
- Al cambiar de vista, el foco va al `<h1>` de la nueva vista.
- El mapa es visual; la **lista de participantes** da la misma información en texto (estado,
  distancia, dirección cardinal, ETA, puntualidad y antigüedad del dato).
- Llegadas y nuevas personas se anuncian con `aria-live="polite"`. La cuenta regresiva no se anuncia,
  para no saturar al lector de pantalla.
- Botones de alternar con `aria-pressed`, errores de formulario con `aria-invalid` + `aria-describedby`,
  objetivos táctiles de 44 px, foco visible de alto contraste y `prefers-reduced-motion` respetado.

## Créditos
Mapas, rutas y búsqueda: © colaboradores de OpenStreetMap (teselas OSM, OSRM en routing.openstreetmap.de, Nominatim).
Se respeta la política de Nominatim: búsqueda solo al enviar, máximo 1 petición por segundo.
