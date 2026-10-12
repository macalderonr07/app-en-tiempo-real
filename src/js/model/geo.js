// Geodesia: distancias y rumbos sobre el elipsoide WGS-84 (el mismo que usa el GPS).
//
// Se usa la fórmula inversa de Vincenty, exacta al milímetro, en vez de Haversine:
// Haversine supone una Tierra esférica y puede errar hasta ~0,5 %. En 2 km eso son
// 10 m, más que el radio de "llegada" de una reunión. Haversine queda como respaldo
// para los casos casi antipodales en los que Vincenty no converge.

const A = 6378137; // semieje mayor (m)
const F = 1 / 298.257223563; // achatamiento
const B = A * (1 - F); // semieje menor
const RADIO_MEDIO = 6371008.8;
const RAD = Math.PI / 180;

export function coordenadaValida(p) {
  return (
    p != null &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

export function distanciaHaversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_MEDIO * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distancia en metros con Vincenty; null si no converge. */
export function distanciaVincenty(a, b) {
  const L = (b.lng - a.lng) * RAD;
  const U1 = Math.atan((1 - F) * Math.tan(a.lat * RAD));
  const U2 = Math.atan((1 - F) * Math.tan(b.lat * RAD));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let lambdaPrevia;
  let iteraciones = 0;
  let sinSigma, cosSigma, sigma, cos2Alfa, cos2SigmaM;

  do {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2,
    );
    if (sinSigma === 0) return 0; // puntos coincidentes
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlfa = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cos2Alfa = 1 - sinAlfa ** 2;
    // En el ecuador cos2Alfa = 0 y el término no aplica.
    cos2SigmaM = cos2Alfa !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cos2Alfa : 0;
    const C = (F / 16) * cos2Alfa * (4 + F * (4 - 3 * cos2Alfa));
    lambdaPrevia = lambda;
    lambda =
      L +
      (1 - C) *
        F *
        sinAlfa *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
  } while (Math.abs(lambda - lambdaPrevia) > 1e-12 && ++iteraciones < 200);

  if (iteraciones >= 200) return null;

  const u2 = (cos2Alfa * (A ** 2 - B ** 2)) / B ** 2;
  const Acoef = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const Bcoef = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const deltaSigma =
    Bcoef *
    sinSigma *
    (cos2SigmaM +
      (Bcoef / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
          (Bcoef / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  return B * Acoef * (sigma - deltaSigma);
}

/** Distancia en metros entre dos {lat, lng}. */
export function distancia(a, b) {
  return distanciaVincenty(a, b) ?? distanciaHaversine(a, b);
}

/** Rumbo inicial de a hacia b, en grados (0 = norte, 90 = este). */
export function rumbo(a, b) {
  const f1 = a.lat * RAD;
  const f2 = b.lat * RAD;
  const dL = (b.lng - a.lng) * RAD;
  const y = Math.sin(dL) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dL);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

const PUNTOS_CARDINALES = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"];

/** "noreste", "sur"... para describir una dirección en texto (alternativa al mapa). */
export function puntoCardinal(grados) {
  return PUNTOS_CARDINALES[Math.round(grados / 45) % 8];
}
