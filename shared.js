/**
 * SHARED CONSTANTS — Condivise tra CDF Tracker e Libreria Esercizi.
 * Importato da entrambe le app per evitare duplicazione degli ID built-in.
 * 
 * Uso:
 *   CDF Tracker (app.js):   caricato via <script src="shared.js"> PRIMA di app.js
 *   Esercizi (app.js):      import { BUILTIN_IDS, SECTION_IDS } from '../shared.js'
 *                           (oppure letto come global se servito senza module)
 */

/* IDs delle sezioni del CDF Tracker */
const SECTION_IDS = ["fisica", "autotrattamento", "lavoro", "corsi"];

/* IDs builtin di tutte le attività nel CDF Tracker */
const BUILTIN_IDS = new Set([
  // Fisica & Benessere
  "respiro","esvoce","schiena","bagua","trapz","cfg","esyoga","kf","occhi","perin","collo","polsi","allungamento","seqex",
  // Autotrattamento
  "at_p","at_s","at_focali","at_l",
  // Lavoro
  "indicazioni","risprec","mail","promemoria","ordinefile","foto","ripasso","enagic","pagamenti",
  // Corsi
  "argA","argB","argC","argD","argE","argF","argG",
]);

/* Colori per sezione (usati nel deep-link CDF → Esercizi) */
const SECTION_COLOR_MAP = {
  fisica: "verde",
  autotrattamento: "ambra",
  lavoro: "blu",
  corsi: "viola",
};

const SECTION_HEX_MAP = {
  fisica: "#2f9e6f",
  autotrattamento: "#e07b1a",
  lavoro: "#178fb8",
  corsi: "#7c5cbf",
};

// Export per ES modules (Esercizi usa import)
if (typeof window !== "undefined") {
  window.BUILTIN_IDS = BUILTIN_IDS;
  window.SECTION_IDS = SECTION_IDS;
  window.SECTION_COLOR_MAP = SECTION_COLOR_MAP;
  window.SECTION_HEX_MAP = SECTION_HEX_MAP;
}
