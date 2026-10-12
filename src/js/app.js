// Punto de entrada. Arquitectura MVC:
//   model/       reglas de negocio puras (geo, ETA, validaciones) + servicios
//                (Firebase, GPS, cámara, mapas, pantalla)
//   view/        todo lo que toca el DOM y el mapa
//   controller/  orquesta: recibe eventos de la vista, usa el modelo, pide repintar

import { ControladorApp } from "./controller/controlador-app.js";

new ControladorApp().iniciar();
