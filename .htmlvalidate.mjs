// Configuración de html-validate (la usa `npm run verificar:html` y GitHub Actions).
export default {
  extends: ["html-validate:recommended"],
  rules: {
    // role="list" en <ul>/<ol> es INTENCIONAL: Tailwind (preflight) les quita las
    // viñetas con list-style:none y Safari/VoiceOver deja de anunciarlas como listas.
    // role="list" devuelve esa semántica. Por eso se permite el rol "redundante".
    "no-redundant-role": "off",
    // Misma razón: no sugerir cambiar <ol role="list"> por <ul>.
    "prefer-native-element": ["error", { exclude: ["list"] }],
  },
};
