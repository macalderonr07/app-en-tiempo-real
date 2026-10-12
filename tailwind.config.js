/** @type {import('tailwindcss').Config} */
// Tailwind se COMPILA (scripts/build.mjs) en vez de usar el Play CDN: un CSS estático
// entra en la caché del Service Worker y la app sigue con estilos sin conexión.
export default {
  // Se escanean también los módulos JS: las vistas arman clases al renderizar.
  content: ["./src/**/*.html", "./src/js/**/*.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Ubuntu", "sans-serif"],
      },
      // Tamaño mínimo de objetivo táctil (WCAG 2.5.8 pide 24px; usamos 44px, la guía móvil).
      minHeight: { tap: "2.75rem" },
      minWidth: { tap: "2.75rem" },
      keyframes: {
        pulso: {
          "0%": { transform: "scale(0.6)", opacity: "0.7" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
      },
      animation: { pulso: "pulso 1.8s ease-out infinite" },
    },
  },
  plugins: [],
};
