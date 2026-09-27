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

/* Palette completa per nuove aree personalizzate */
const PALETTE_COLORS = [
  { id: "verde",    name: "Verde",    hex: "#10b981", soft: "rgba(16,185,129,0.14)" },
  { id: "ambra",    name: "Ambra",    hex: "#f59e0b", soft: "rgba(245,158,11,0.14)" },
  { id: "viola",    name: "Viola",    hex: "#8b5cf6", soft: "rgba(139,92,246,0.14)" },
  { id: "blu",      name: "Blu",      hex: "#0284c7", soft: "rgba(2,132,199,0.14)" },
  { id: "rosa",     name: "Rosa",     hex: "#ec4899", soft: "rgba(236,72,153,0.14)" },
  { id: "ciano",    name: "Ciano",    hex: "#06b6d4", soft: "rgba(6,182,212,0.14)" },
  { id: "rosso",    name: "Rosso",    hex: "#ef4444", soft: "rgba(239,68,68,0.14)" },
  { id: "arancio",  name: "Arancio",  hex: "#f97316", soft: "rgba(249,115,22,0.14)" },
  { id: "indaco",   name: "Indaco",   hex: "#6366f1", soft: "rgba(99,102,241,0.14)" },
  { id: "smeraldo", name: "Smeraldo", hex: "#059669", soft: "rgba(5,150,105,0.14)" },
];

const PALETTE_HEX = {};
PALETTE_COLORS.forEach(c => { PALETTE_HEX[c.id] = c.hex; });

/* Nomi standard per le attività built-in */
const DEFAULT_ACTIVITY_NAMES = {
  respiro: "Respiro", esvoce: "Es Voce", schiena: "Schiena", bagua: "Ba Gua",
  trapz: "Tra pz e altro", cfg: "CFG", esyoga: "Es Yoga",
  kf: "KF", occhi: "Occhi", perin: "Perin",
  collo: "Collo", polsi: "Polsi", allungamento: "Allungamento", seqex: "Seqex e P",
  at_p: "Papimi", at_s: "S", at_focali: "Focali", at_l: "L",
  argF: "Mulligan", argA: "ATM", argB: "Belotti", argC: "FCC",
  argD: "Ipnovendita", argE: "Montemagno", argG: "Argomento G"
};

/* ===================== Coda richieste Pantry =====================
   getpantry.cloud accetta ~2 richieste ravvicinate per IP, poi risponde 429 per ~10 s.
   La risposta 429 NON ha l'header CORS: nel browser appare come errore di rete
   ("Load failed" / "Failed to fetch"). Tutte le chiamate Pantry passano da qui:
   una alla volta, distanziate, e con ritentativo dopo la pausa imposta da Pantry. */
const PANTRY_GAP_MS   = 5000;
const PANTRY_RETRY_MS = 10000;
const PANTRY_TIMEOUT_MS = 15000;  // una richiesta appesa non deve bloccare la coda
let _pantryQueue = Promise.resolve();
let _pantryNextAt = 0;
function pantryFetch(url, opts){
  const run = async ()=>{
    for(let attempt = 0; ; attempt++){
      const wait = _pantryNextAt - Date.now();
      if(wait > 0) await new Promise(r=>setTimeout(r, wait));
      _pantryNextAt = Date.now() + PANTRY_GAP_MS;
      try{
        const ctrl = new AbortController();
        const timer = setTimeout(()=>ctrl.abort(), PANTRY_TIMEOUT_MS);
        let r;
        try{ r = await fetch(url, Object.assign({}, opts, {signal: ctrl.signal})); }
        finally{ clearTimeout(timer); }
        if(r.status !== 429 || attempt >= 2) return r;
      }catch(e){
        if(attempt >= 2) throw new Error("Pantry non risponde (limite richieste o rete assente)");
      }
      _pantryNextAt = Date.now() + PANTRY_RETRY_MS;
    }
  };
  const p = _pantryQueue.then(run, run);
  _pantryQueue = p.catch(()=>{});
  return p;
}

// Export su window per script classici
if (typeof window !== "undefined") {
  window.BUILTIN_IDS = BUILTIN_IDS;
  window.SECTION_IDS = SECTION_IDS;
  window.SECTION_COLOR_MAP = SECTION_COLOR_MAP;
  window.SECTION_HEX_MAP = SECTION_HEX_MAP;
  window.PALETTE_COLORS = PALETTE_COLORS;
  window.PALETTE_HEX = PALETTE_HEX;
  window.DEFAULT_ACTIVITY_NAMES = DEFAULT_ACTIVITY_NAMES;
  window.pantryFetch = pantryFetch;
}
