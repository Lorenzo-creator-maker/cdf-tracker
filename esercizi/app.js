/**
 * LIBRERIA ESERCIZI — Integrata con CDF Tracker
 * SPA Preact via CDN (nessun build step).
 * Sincronizzazione: basket Pantry dedicato "esercizi" (stesso Pantry ID del CDF).
 */

import { h, render, Fragment } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect, useRef, useCallback, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';

/* Fallback costanti condivise con il CDF Tracker */
const BUILTIN_IDS = (typeof window !== 'undefined' && window.BUILTIN_IDS) || new Set([
  'respiro','esvoce','schiena','bagua','trapz','cfg','esyoga','kf','occhi','perin','collo','polsi','allungamento','seqex',
  'at_p','at_s','at_focali','at_l',
  'argF','argA','argB','argC','argD','argE','argG'
]);
const DEFAULT_ACTIVITY_NAMES = (typeof window !== 'undefined' && window.DEFAULT_ACTIVITY_NAMES) || {
  respiro: "Respiro", esvoce: "Es Voce", schiena: "Schiena", bagua: "Ba Gua",
  trapz: "Tra pz e altro", cfg: "CFG", esyoga: "Es Yoga",
  kf: "KF", occhi: "Occhi", perin: "Perin",
  collo: "Collo", polsi: "Polsi", allungamento: "Allungamento", seqex: "Seqex e P",
  at_p: "Papimi", at_s: "S", at_focali: "Focali", at_l: "L",
  argF: "Mulligan", argA: "ATM", argB: "Belotti", argC: "FCC",
  argD: "Ipnovendita", argE: "Montemagno", argG: "Argomento G"
};

/* Chart.js lazy load da CDN */
const loadChart = async () => {
  if (window.Chart) return window.Chart;
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
  await new Promise(resolve => { script.onload = resolve; document.head.appendChild(script); });
  return window.Chart;
};

/* ============================================================
   COSTANTI & COLORI
   ============================================================ */
const COLORS = {
  verde:    { name: 'Fisica & Benessere', dot: '#10b981', soft: 'rgba(16,185,129,0.14)', line: 'rgba(16,185,129,0.35)', hex: '#10b981' },
  ambra:    { name: 'Autotrattamento',    dot: '#f59e0b', soft: 'rgba(245,158,11,0.14)', line: 'rgba(245,158,11,0.35)', hex: '#f59e0b' },
  viola:    { name: 'Corsi',              dot: '#8b5cf6', soft: 'rgba(139,92,246,0.14)', line: 'rgba(139,92,246,0.35)', hex: '#8b5cf6' },
  blu:      { name: 'Lavoro',             dot: '#0284c7', soft: 'rgba(2,132,199,0.14)', line: 'rgba(2,132,199,0.35)', hex: '#0284c7' },
  rosa:     { name: 'Rosa',               dot: '#ec4899', soft: 'rgba(236,72,153,0.14)', line: 'rgba(236,72,153,0.35)', hex: '#ec4899' },
  ciano:    { name: 'Ciano',              dot: '#06b6d4', soft: 'rgba(6,182,212,0.14)', line: 'rgba(6,182,212,0.35)', hex: '#06b6d4' },
  rosso:    { name: 'Rosso',              dot: '#ef4444', soft: 'rgba(239,68,68,0.14)', line: 'rgba(239,68,68,0.35)', hex: '#ef4444' },
  arancio:  { name: 'Arancio',            dot: '#f97316', soft: 'rgba(249,115,22,0.14)', line: 'rgba(249,115,22,0.35)', hex: '#f97316' },
  indaco:   { name: 'Indaco',             dot: '#6366f1', soft: 'rgba(99,102,241,0.14)', line: 'rgba(99,102,241,0.35)', hex: '#6366f1' },
  smeraldo: { name: 'Smeraldo',           dot: '#059669', soft: 'rgba(5,150,105,0.14)', line: 'rgba(5,150,105,0.35)', hex: '#059669' },
};
const COLOR_KEYS = Object.keys(COLORS);

// Data locale (non UTC): fra mezzanotte e l'una toISOString() dava ancora ieri.
const todayISO = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

/* Spunta del giorno (19/11/2026). Un esercizio e' «fatto oggi» se lastDone e' oggi.
   Spuntare conserva in prevDone la data di prima, cosi' togliere la spunta la
   rimette com'era. updatedAt dice quale copia e' piu' recente nella sync. */
const doneToday = (e) => !!e && e.lastDone === todayISO();
const tickExercise = (e) => doneToday(e) ? e : {
  ...e, count: (e.count || 0) + 1, prevDone: e.lastDone || null, lastDone: todayISO(), updatedAt: Date.now(),
};
const untickExercise = (e) => !doneToday(e) ? e : {
  ...e, count: Math.max(0, (e.count || 0) - 1), lastDone: e.prevDone || null, prevDone: null, updatedAt: Date.now(),
};

const daysSince = (iso) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso + 'T00:00:00').getTime();
  return Math.floor(ms / 86400000);
};

const freshness = (iso) => {
  const d = daysSince(iso);
  if (d === null) return { c: '#94a3b8', label: 'mai fatto', bg: 'var(--fresh-gray-bg)' };
  if (d <= 0)     return { c: '#10b981', label: 'oggi', bg: 'var(--fresh-green-bg)' };
  if (d <= 3)     return { c: '#10b981', label: `${d}g fa`, bg: 'var(--fresh-green-bg)' };
  if (d <= 7)     return { c: '#f59e0b', label: `${d}g fa`, bg: 'var(--fresh-yellow-bg)' };
  return { c: '#ef4444', label: `${d}g fa (da ripassare)`, bg: 'var(--fresh-red-bg)' };
};

const avgTime = (exercise) => {
  const log = exercise.timeLog || [];
  if (!log.length) return null;
  const total = log.reduce((s, entry) => s + (entry.minutes || 0), 0);
  return Math.round(total / log.length);
};

const uid = () => Math.random().toString(36).slice(2, 9);

/* Drive / Video embed URL */
function driveEmbed(url) {
  if (!url) return null;
  const m = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  const m2 = url.match(/youtu(?:\.be\/|be\.com\/(?:watch\?v=|embed\/))([a-zA-Z0-9_-]+)/);
  if (m2) return `https://www.youtube.com/embed/${m2[1]}`;
  const m3 = url.match(/vimeo\.com\/(\d+)/);
  if (m3) return `https://player.vimeo.com/video/${m3[1]}`;
  return null;
}

/* ============================================================
   DATA LAYER & PANTRY SYNC
   ============================================================ */
const EX_KEY    = 'cdf_exercises_v1';
const EX_BASKET = 'esercizi';

const getPantryId = () => {
  try {
    const p = String(localStorage.getItem('cdfPantryId') || '').trim();
    if (!p) return '';
    const uuidMatch = p.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    if (uuidMatch) return uuidMatch[0].toLowerCase();
    const m = p.match(/(?:pantry\/|id[:=\s]+)?([0-9a-fA-F-]{20,})/i);
    if (m) return m[1].replace(/[^0-9a-fA-F-]/g, '').toLowerCase();
    return p.replace(/['"“”;<>\/\s:]/g, '').replace(/\.+$/, '').trim();
  } catch { return ''; }
};

const localStore = {
  get: () => {
    try { return JSON.parse(localStorage.getItem(EX_KEY)) || {}; }
    catch { return {}; }
  },
  set: (s) => {
    try { localStorage.setItem(EX_KEY, JSON.stringify(s)); }
    catch {}
  }
};

const isMeta = (k) => k.startsWith('_');

function stripMeta(o) {
  if (!o || typeof o !== 'object') return o;
  const c = { ...o };
  delete c._metadata;
  return c;
}

/* Rimuove schede vuote con 0 esercizi create accidentalmente */
function cleanEmptyActivities(store) {
  let changed = false;
  const next = { ...store };
  for (const k of Object.keys(next)) {
    if (isMeta(k)) continue;
    const act = next[k];
    if (!act || !Array.isArray(act.exercises) || act.exercises.length === 0) {
      delete next[k];
      changed = true;
    }
  }
  return { cleaned: next, changed };
}

/* Legge tutte le attività censite nel CDF Tracker con nomi reali */
function getCdfActivities() {
  const result = [];
  const seen = new Set();

  // 1. Built-in da shared.js
  const defaultNames = window.DEFAULT_ACTIVITY_NAMES || DEFAULT_ACTIVITY_NAMES || {};
  for (const [id, name] of Object.entries(defaultNames)) {
    let color = 'verde';
    if (['at_p','at_s','at_focali','at_l'].includes(id)) color = 'ambra';
    else if (id.startsWith('arg')) color = 'viola';
    result.push({ id, name, color });
    seen.add(id);
  }

  // 2. Custom da cdfTracker_v2
  try {
    const raw = localStorage.getItem('cdfTracker_v2');
    if (raw) {
      const d = JSON.parse(raw);
      const customs = d._customActivities || {};
      const labels = d._labels || {};
      const secColor = { fisica: 'verde', autotrattamento: 'ambra', corsi: 'viola', lavoro: 'blu' };
      if (Array.isArray(d._customSections)) {
        d._customSections.forEach(cs => {
          if (cs && cs.id && cs.color) secColor[cs.id] = cs.color;
        });
      }
      if (d._sectionColors) {
        for (const sid in d._sectionColors) {
          if (d._sectionColors[sid]) secColor[sid] = d._sectionColors[sid];
        }
      }

      for (const sid in customs) {
        (customs[sid] || []).forEach(a => {
          if (a && a.id && !seen.has(a.id)) {
            const lbl = labels[a.id] || a.name || a.id;
            result.push({ id: a.id, name: lbl, color: secColor[sid] || 'verde' });
            seen.add(a.id);
          }
        });
      }
    }
  } catch(e) {}

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function pullRemote() {
  const pId = getPantryId();
  if (!pId) return null;
  try {
    const res = await window.pantryFetch(`https://getpantry.cloud/apiv1/pantry/${pId}/basket/${EX_BASKET}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return stripMeta(await res.json());
  } catch { return 'ERR'; }
}

async function pushRemote(store) {
  const pId = getPantryId();
  if (!pId) return;
  try {
    await window.pantryFetch(`https://getpantry.cloud/apiv1/pantry/${pId}/basket/${EX_BASKET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store),
    });
  } catch {}
}







/* L'unione fra copie (locale, cloud) sta in ../shared.js, cosi' la usa anche
   l'app principale quando aggiorna gli esercizi locali (19/11/2026). */
const { exMergeStores: mergeStores, exNewerExercise: newerExercise } = window;

/* Deep link #act=..&name=..&color=.. */
function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  const id = p.get('act');
  if (!id) return null;
  const colorRaw = p.get('color') || 'verde';
  return {
    id,
    name: p.get('name') ? decodeURIComponent(p.get('name')) : id,
    color: COLORS[colorRaw] ? colorRaw : 'verde',
  };
}

/* ============================================================
   ICONS
   ============================================================ */
const Icon = ({ d, size = 16, strokeWidth = 2, color, style: s }) =>
  h('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size, height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color || 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: s,
  }, h('path', { d }));

const icons = {
  back:    'M15 18l-6-6 6-6',
  home:    'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
  book:    'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z',
  plus:    'M12 5v14M5 12h14',
  play:    'M5 3l14 9-14 9V3z',
  pause:   'M6 4h4v16H6zM14 4h4v16h-4z',
  reset:   'M1 4v6h6M23 20v-6h-6M20.5 9A9 9 0 0 0 5 5.5L1 10M23 14l-4 4.5A9 9 0 0 1 3.5 15',
  trash:   'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  pencil:  'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  minus:   'M5 12h14',
  check:   'M20 6L9 17l-5-5',
  sort:    'M3 6h18M6 12h12M10 18h4',
  clock:   'M12 2a10 10 0 1 1 0 20A10 10 0 0 1 12 2zM12 6v6l4 2',
  video:   'M23 7l-7 5 7 5V7zM1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1z',
  arrow:   'M5 12h14M12 5l7 7-7 7',
  search:  'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35',
  close:   'M18 6L6 18M6 6l12 12',
};

/* ============================================================
   TOAST
   ============================================================ */
let _toastSetState = null;
function ToastHost() {
  const [toasts, setToasts] = useState([]);
  _toastSetState = setToasts;
  return h('div', { className: 'toast-container' },
    toasts.map(t => h('div', { key: t.id, className: 'toast' }, t.msg))
  );
}
function showToast(msg) {
  if (!_toastSetState) return;
  const id = uid();
  _toastSetState(prev => [...prev, { id, msg }]);
  setTimeout(() => {
    if (_toastSetState) _toastSetState(prev => prev.filter(t => t.id !== id));
  }, 2400);
}

/* Dialog Conferma */
function ConfirmDialog({ title, msg, onConfirm, onCancel }) {
  return h('div', { className: 'modal-backdrop', onClick: onCancel },
    h('div', { className: 'modal-card', onClick: e => e.stopPropagation() },
      h('h3', { className: 'modal-title' }, title),
      h('p', { className: 'modal-sub' }, msg),
      h('div', { className: 'form-actions' },
        h('button', { className: 'btn-ghost', onClick: onCancel }, 'Annulla'),
        h('button', { className: 'btn-submit', style: { background: '#ef4444' }, onClick: onConfirm }, 'Elimina'),
      )
    )
  );
}

/* ============================================================
   APP ROOT
   ============================================================ */
function App() {
  const [store, setStore] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [draftSeed, setDraftSeed] = useState(null); // transient activity for uncommitted deep link
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortModeRaw] = useState(() => {
    try { return localStorage.getItem('exSortMode') || 'stale'; } catch { return 'stale'; }
  });
  const setSortMode = useCallback((m) => {
    setSortModeRaw(m);
    try { localStorage.setItem('exSortMode', m); } catch {}
  }, []);

  const [isDark, setIsDark] = useState(() => {
    try {
      const t = localStorage.getItem('cdfTheme');
      return t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch { return true; }
  });

  const toggleTheme = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      try { localStorage.setItem('cdfTheme', next ? 'dark' : 'light'); } catch {}
      if (next) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
      const meta = document.querySelector("meta[name='theme-color']");
      if (meta) meta.setAttribute('content', next ? '#090d16' : '#ffffff');
      return next;
    });
  }, []);

  const [synced, setSynced] = useState(!!getPantryId());
  const pushTimer = useRef(null);
  // Ultimo stato salvato: il salvataggio ritardato unisce il cloud a questo, non
  // allo stato di quando e' partito (rimetteva in pagina spunte vecchie).
  const storeRef = useRef(null);

  /* Caricamento iniziale + pulizia automatica schede vuote */
  useEffect(() => {
    const seed = parseHash();
    let raw = localStore.get();

    // Pulizia delle schede vuote con 0 esercizi create accidentalmente
    const { cleaned, changed } = cleanEmptyActivities(raw);
    if (changed) {
      localStore.set(cleaned);
      raw = cleaned;
    }
    storeRef.current = raw;
    setStore(raw);

    if (seed) {
      // Se esiste già nello store, aprila
      if (raw[seed.id]) {
        setOpenId(seed.id);
      } else {
        // Altrimenti salvala solo come bozza in memoria, NON nello store persistente
        setDraftSeed(seed);
        setOpenId(seed.id);
      }
    }

    (async () => {
      const remote = await pullRemote();
      if (remote && remote !== 'ERR') {
        const merged = cleanEmptyActivities(mergeStores(storeRef.current || raw, remote)).cleaned;
        storeRef.current = merged;
        localStore.set(merged);
        setStore(merged);
        // Modifiche rimaste solo su questo dispositivo (pagina lasciata prima
        // dell'invio, o fatte senza rete): si mandano adesso.
        if (JSON.stringify(merged) !== JSON.stringify(mergeStores({}, remote))) pushRemote(merged);
      }
      setSynced(!!getPantryId());
    })();

    const onHash = () => {
      const sd = parseHash();
      if (!sd) {
        setOpenId(null);
        setDraftSeed(null);
        return;
      }
      setStore(prev => {
        if (prev && prev[sd.id]) {
          setOpenId(sd.id);
          setDraftSeed(null);
        } else {
          setDraftSeed(sd);
          setOpenId(sd.id);
        }
        return prev;
      });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /* Salvataggio con debounce */
  const persist = useCallback((nextStore) => {
    nextStore._updatedAt = Date.now();
    storeRef.current = nextStore;
    localStore.set(nextStore);
    setStore(nextStore);
    if (!getPantryId()) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      const remote = await pullRemote();
      const cur = storeRef.current || nextStore;
      const toSave = (remote && remote !== 'ERR') ? mergeStores(cur, remote) : cur;
      storeRef.current = toSave;
      localStore.set(toSave);
      setStore(toSave);
      pushRemote(toSave);
    }, 1000);
  }, []);

  if (!store) {
    return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--text-muted)' } }, 'Caricamento libreria…');
  }

  // Risoluzione activity aperta (può essere una scheda nello store o una bozza transitoria)
  const found = openId
    ? (store[openId] ? { id: openId, ...store[openId] } : (draftSeed && draftSeed.id === openId ? { ...draftSeed, exercises: [] } : null))
    : null;
  // Nome e colore come li mostra ora l'app (rinomine e colori d'area cambiati).
  const label = found && appActivity(found.id);
  const open = label ? { ...found, name: label.name, color: label.color } : found;

  const updateActivity = (updated) => {
    const ns = { ...store };
    ns[updated.id] = { name: updated.name, color: updated.color, exercises: updated.exercises, updatedAt: Date.now() };
    setDraftSeed(null); // ora è memorizzata nello store
    persist(ns);
  };

  const removeActivity = (id) => {
    const ns = { ...store };
    delete ns[id];
    ns._deleted = { ...(ns._deleted || {}), [id]: Date.now() };
    persist(ns);
    if (openId === id) setOpenId(null);
  };

  const removeExercise = (actId, exId) => {
    const ns = { ...store };
    const act = ns[actId];
    if (act) {
      const remaining = (act.exercises || []).filter(e => e.id !== exId);
      ns[actId] = { ...act, exercises: remaining };
    }
    ns._deletedEx = { ...(ns._deletedEx || {}), [exId]: Date.now() };
    persist(ns);
  };

  const mergeActivity = (sourceId, targetId) => {
    if (sourceId === targetId) return;
    const ns = { ...store };
    const src = ns[sourceId] || {};
    const tgt = ns[targetId] || {};
    const byId = {};
    (tgt.exercises || []).forEach(e => { byId[e.id] = e; });
    (src.exercises || []).forEach(e => {
      const p = byId[e.id];
      byId[e.id] = p ? newerExercise(p, e) : e;
    });
    ns[targetId] = { name: tgt.name || src.name, color: tgt.color || src.color, exercises: Object.values(byId), updatedAt: Date.now() };
    delete ns[sourceId];
    ns._deleted = { ...(ns._deleted || {}), [sourceId]: Date.now() };
    persist(ns);
  };

  const goHome = () => {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    setOpenId(null);
    setDraftSeed(null);
  };

  return h(Fragment, null,
    open
      ? h(Board, {
          activity: open,
          sortMode, setSortMode,
          onBack: goHome,
          onChange: updateActivity,
          onRemoveExercise: removeExercise,
          onRemoveActivity: (id) => { removeActivity(id); goHome(); },
          onMerge: (src, tgt) => { mergeActivity(src, tgt); setOpenId(tgt); },
          otherActivities: Object.keys(store)
            .filter(k => !isMeta(k) && k !== open.id && store[k])
            .map(k => ({ id: k, name: store[k].name || k })),
          isDark, toggleTheme,
        })
      : h(Home, {
          store, synced,
          // Un'attivita' senza esercizi si apre come bozza: entra nello store al primo esercizio.
          onOpen: (act) => { setDraftSeed(store[act.id] ? null : act); setOpenId(act.id); },
          searchQuery, setSearchQuery,
          isDark, toggleTheme,
        }),
    h(ToastHost)
  );
}

/* ============================================================
   AREE E SPUNTE VERSO L'APP (19/11/2026)
   ============================================================ */
/* Aree e attivita' come le mostra l'app (le scrive app.js in cdfAreas_v1:
   nomi, colori, ordine, senza nascoste ed eliminate). Se la Libreria si apre
   prima dell'app su un dispositivo nuovo, un solo gruppo con le attivita' note. */
function getAreas() {
  try {
    const a = JSON.parse(localStorage.getItem('cdfAreas_v1') || 'null');
    if (Array.isArray(a) && a.length) return a;
  } catch {}
  return [{ id: '_tutte', name: 'Attività', emoji: '', color: 'verde',
    activities: getCdfActivities().map(x => ({ id: x.id, name: x.name })) }];
}

/* L'attivita' dell'app con questo id ({ name, color, hidden }), o null. */
function appActivity(id) {
  // Solo dall'elenco scritto dall'app: il ripiego non conosce i colori veri.
  let areas = null;
  try { areas = JSON.parse(localStorage.getItem('cdfAreas_v1') || 'null'); } catch {}
  if (!Array.isArray(areas)) return null;
  for (const area of areas) {
    const a = (area.activities || []).find(x => x.id === id);
    if (a) return { name: a.name, color: area.color, hidden: !!a.hidden };
  }
  return null;
}

/* Finiti tutti gli esercizi di un'attivita', la Libreria lascia una «spunta in
   attesa» che l'app applica alla prossima apertura (vedi applyPendingTicks in
   ../app.js). Le schede nate solo qui (cust_ex_) non hanno un'attivita' nell'app. */
function addPendingTick(actId) {
  if (!actId || actId.startsWith('cust_ex_')) return false;  // schede nate qui: nessuna attivita' nell'app
  let hasAreas = false;
  try { hasAreas = Array.isArray(JSON.parse(localStorage.getItem('cdfAreas_v1') || 'null')); } catch {}
  // Con l'elenco dell'app: nascoste o sconosciute non vanno in Oggi. Senza elenco
  // (app mai aperta qui) la spunta si lascia lo stesso: decide l'app all'apertura.
  const a = appActivity(actId);
  if (hasAreas && (!a || a.hidden)) return false;
  try {
    const date = todayISO();
    // Le attivita' che Oggi mostra oggi (le scrive l'app). Se l'elenco e' di un
    // altro giorno si lascia la spunta (l'app la controlla) ma senza promettere.
    let shown = null;
    try { shown = JSON.parse(localStorage.getItem('cdfTodayActs_v1') || 'null'); } catch {}
    const known = shown && shown.date === date && Array.isArray(shown.ids);
    if (known && !shown.ids.includes(actId)) return false;
    let list = JSON.parse(localStorage.getItem('cdfPendingTicks') || '[]');
    if (!Array.isArray(list)) list = [];
    if (!list.some(t => t && t.act === actId && t.date === date)) list.push({ act: actId, date });
    localStorage.setItem('cdfPendingTicks', JSON.stringify(list));
    return known;
  } catch { return false; }
}

const DATA_LUNGA = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const chevron = 'M9 18l6-6-6-6';

/* ============================================================
   HOME — Tutte le attivita', divise per area
   ============================================================ */
function Home({ store, synced, onOpen, searchQuery, setSearchQuery, isDark, toggleTheme }) {
  const areas = useMemo(getAreas, []);
  const q = searchQuery.trim().toLowerCase();

  const listed = new Set();
  const groups = areas.map(area => ({
    area,
    rows: (area.activities || []).filter(a => {
      listed.add(a.id);          // le nascoste non si mostrano, ma non finiscono in «Altre schede»
      return !a.hidden;
    }).map(a => ({ id: a.id, name: a.name, color: area.color, exs: (store[a.id] && store[a.id].exercises) || [] })),
  }));
  // Schede della Libreria che non sono (piu') attivita' dell'app: restano visibili.
  const extra = Object.keys(store)
    .filter(k => !isMeta(k) && !listed.has(k) && store[k])
    .map(k => ({ id: k, name: store[k].name || k, color: store[k].color || 'verde', exs: store[k].exercises || [] }));
  if (extra.length) groups.push({ area: { id: '_altre', name: 'Altre schede', emoji: '', color: 'verde' }, rows: extra });

  // I riquadri contano solo le schede mostrate (non quelle delle attivita' nascoste).
  const allEx = groups.flatMap(g => g.rows.flatMap(r => r.exs));
  const doneN = allEx.filter(doneToday).length;
  const staleN = allEx.filter(e => { const d = daysSince(e.lastDone); return d === null || d > 7; }).length;

  const match = r => !q || r.name.toLowerCase().includes(q) ||
    r.exs.some(e => (e.name || '').toLowerCase().includes(q) || (e.notes || '').toLowerCase().includes(q));
  const shown = groups.map(g => ({ ...g, rows: g.rows.filter(match) })).filter(g => g.rows.length);

  const tile = (n, label) => h('div', { className: 'lib-tile' }, h('b', null, n), h('span', null, label));

  return h('div', { className: 'page' },
    h('header', { className: 'header' },
      h('div', { className: 'header-title-row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
        h('div', null,
          h('p', { className: 'lib-date' }, DATA_LUNGA.format(new Date())),
          h('h1', { className: 'lib-title' }, 'Esercizi')
        ),
        h('div', { className: 'header-actions' },
          h('button', { className: 'theme-toggle-btn', onClick: toggleTheme, title: isDark ? 'Passa a tema chiaro' : 'Passa a tema scuro' },
            isDark ? '☀️' : '🌙'
          ),
          synced && h('span', { className: 'sync-badge ok', title: 'Sincronizzazione Cloud Pantry attiva' },
            h('span', { className: 'dot ok', style: { width: 6, height: 6 } }),
            'Sync'
          )
        )
      ),
      h('div', { className: 'lib-tiles' },
        tile(doneN, 'fatti oggi'),
        tile(staleN, 'da ripassare'),
        tile(allEx.length, 'esercizi in tutto')
      )
    ),

    h('div', { className: 'search-toolbar' },
      h('div', { className: 'search-box' },
        h('span', { className: 'search-icon' }, h(Icon, { d: icons.search, size: 16 })),
        h('input', {
          type: 'text',
          value: searchQuery,
          placeholder: 'Cerca esercizio o attività…',
          onInput: e => setSearchQuery(e.target.value),
        }),
        searchQuery && h('button', { className: 'search-clear', onClick: () => setSearchQuery('') }, '✕')
      )
    ),

    h('div', { className: 'content' },
      shown.length === 0 && h('div', { className: 'empty-box' },
        h('div', { className: 'empty-box-icon' }, '🔎'),
        h('p', null, 'Nessuna attività o esercizio con questa ricerca.')
      ),
      shown.map(g => {
        const ca = COLORS[g.area.color] || COLORS.verde;
        return h('section', { key: g.area.id, className: 'lib-area' },
          h('h2', { className: 'lib-area-title', style: { color: ca.dot } },
            (g.area.emoji ? g.area.emoji + ' ' : '') + g.area.name),
          h('div', { className: 'lib-group' },
            g.rows.map(r => {
              const c = COLORS[r.color] || ca;
              const n = r.exs.length;
              const dn = r.exs.filter(doneToday).length;
              return h('button', {
                key: r.id,
                id: `activity-${r.id}`,
                className: 'lib-row',
                onClick: () => onOpen({ id: r.id, name: r.name, color: r.color }),
              },
                h('span', {
                  className: 'lib-row-dot' + (n > 0 && dn === n ? ' tutto' : ''),
                  style: { '--acc': c.dot },
                  'aria-hidden': 'true',
                }, n > 0 && dn === n ? h(Icon, { d: icons.check, size: 12, color: '#fff', strokeWidth: 3 }) : null),
                h('span', { className: 'lib-row-name' }, r.name),
                n === 0
                  ? h('span', { className: 'lib-row-add' }, '+ aggiungi')
                  : h('span', { className: 'lib-row-count' }, `${dn}/${n}`),
                h(Icon, { d: chevron, size: 16, style: { color: 'var(--text-muted)', flexShrink: 0 } })
              );
            })
          )
        );
      })
    )
  );
}

/* ============================================================
   BOARD — Esercizi di un'attivita'
   ============================================================ */
function Board({ activity, sortMode, setSortMode, onBack, onChange, onRemoveExercise, onRemoveActivity, onMerge, otherActivities, isDark, toggleTheme }) {
  const c = COLORS[activity.color] || COLORS.verde;
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [openRowId, setOpenRowId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [moving, setMoving] = useState(false);
  const [training, setTraining] = useState(false);

  const exs = activity.exercises || [];
  const update = (exercises) => onChange({ ...activity, exercises });

  const staleKey = (e) => (daysSince(e.lastDone) ?? 1e9);
  const prioKey  = (e) => (typeof e.priority === 'number' ? e.priority : -Infinity);

  const sorted = [...exs];
  if (sortMode === 'most')          sorted.sort((a, b) => (b.count || 0) - (a.count || 0));
  else if (sortMode === 'stale')    sorted.sort((a, b) => staleKey(b) - staleKey(a));
  else if (sortMode === 'priority') sorted.sort((a, b) => (prioKey(b) - prioKey(a)) || (staleKey(b) - staleKey(a)));
  else if (sortMode === 'name')     sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  /* Applica una spunta (o la toglie). Se con questa sono fatti tutti, l'attivita'
     si segna anche in Oggi nell'app. */
  const applyChange = (id, fn) => {
    const next = exs.map(e => e.id === id ? fn(e) : e);
    update(next);
    const wasAll = exs.length > 0 && exs.every(doneToday);
    const nowAll = next.length > 0 && next.every(doneToday);
    if (nowAll && !wasAll) {
      showToast(addPendingTick(activity.id)
        ? `${activity.name} completata: segnata anche in Oggi ✓`
        : 'Tutti gli esercizi fatti oggi ✓');
    }
  };
  const toggleDone = (id) => applyChange(id, e => doneToday(e) ? untickExercise(e) : tickExercise(e));
  const markDone = (id) => applyChange(id, tickExercise);

  const saveTimeForActivity = (minutes) => {
    const today = todayISO();
    update(exs.map(e => {
      const log = e.timeLog || [];
      const today_entry = log.find(entry => entry.date === today);
      const updated_log = today_entry
        ? log.map(entry => entry.date === today ? { ...entry, minutes: entry.minutes + minutes } : entry)
        : [...log, { date: today, minutes }];
      return { ...e, timeLog: updated_log, updatedAt: Date.now() };
    }));
    showToast(`⏱ +${minutes} min registrati`);
  };

  const doConfirm = () => {
    if (confirm.kind === 'activity') {
      onRemoveActivity(activity.id);
      showToast('Scheda rimossa');
    } else {
      onRemoveExercise(activity.id, confirm.id);
      showToast('Esercizio eliminato');
    }
    setConfirm(null);
  };

  const saveExercise = (ex) => {
    const prev = exs.find(e => e.id === ex.id);
    const saved = { ...(prev || {}), ...ex, updatedAt: Date.now() };
    update(prev ? exs.map(e => e.id === ex.id ? saved : e) : [...exs, saved]);
    setAdding(false);
    setEditId(null);
    showToast(prev ? 'Esercizio aggiornato ✓' : 'Esercizio aggiunto ✓');
  };

  if (training) {
    return h(Allenamento, {
      activity,
      exercises: sorted,
      accent: c,
      onDone: markDone,
      onSaveTime: saveTimeForActivity,
      onExit: () => setTraining(false),
    });
  }

  const doneN = exs.filter(doneToday).length;
  const pct = exs.length ? Math.round(doneN / exs.length * 100) : 0;

  return h('div', { className: 'page' },
    h('header', { className: 'header' },
      h('div', { className: 'header-top-nav' },
        h('button', { className: 'nav-btn library-btn', onClick: onBack, title: 'Torna a tutte le attività' },
          h(Icon, { d: icons.back, size: 15 }),
          h('span', null, 'Esercizi')
        ),
        h('div', { className: 'header-actions' },
          h('button', { className: 'theme-toggle-btn', onClick: toggleTheme, title: isDark ? 'Passa a tema chiaro' : 'Passa a tema scuro' },
            isDark ? '☀️' : '🌙'
          )
        )
      ),
      h('h1', { className: 'lib-title', style: { color: c.dot } }, activity.name),
      h('p', { className: 'header-sub' },
        exs.length ? `${doneN} di ${exs.length} fatti oggi` : 'Nessun esercizio ancora'),
      exs.length > 0 && h('div', { className: 'lib-progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
        h('i', { style: { width: pct + '%', background: c.dot } })
      ),
      exs.length > 0 && h('button', {
        className: 'start-btn',
        style: { background: c.dot },
        onClick: () => setTraining(true),
      },
        h(Icon, { d: icons.play, size: 15, color: '#fff' }),
        doneN === exs.length ? 'Rifai l’allenamento' : 'Inizia allenamento'
      )
    ),

    h(Timer, { accent: c.dot, key: activity.id, onSaveTime: saveTimeForActivity }),

    exs.length > 1 && h('div', { className: 'sort-bar' },
      h(Icon, { d: icons.sort, size: 14, style: { color: 'var(--text-muted)', flexShrink: 0, marginRight: 2 } }),
      [
        ['stale', '⚡ Da ripassare'],
        ['priority', '⭐ Priorità'],
        ['most', '🔥 Più fatti'],
        ['name', 'A-Z Nome'],
      ].map(([k, label]) =>
        h('button', {
          key: k,
          className: 'sort-pill' + (sortMode === k ? ' active' : ''),
          style: sortMode === k ? { background: c.soft, borderColor: c.line, color: c.dot } : {},
          onClick: () => setSortMode(k),
        }, label)
      )
    ),

    h('div', { className: 'content' },
      exs.length === 0 && !adding && h('div', { className: 'empty-box' },
        h('div', { className: 'empty-box-icon' }, '🎯'),
        h('p', null, 'Nessun esercizio ancora.', h('br'), 'Aggiungine uno con il pulsante qui sotto.')
      ),

      sorted.length > 0 && h('div', { className: 'lib-group' },
        sorted.map(e =>
          editId === e.id
            ? h(ExerciseForm, { key: e.id, accent: c, initial: e, onSave: saveExercise, onCancel: () => setEditId(null) })
            : h(ExerciseRow, {
                key: e.id,
                ex: e,
                accent: c,
                open: openRowId === e.id,
                onToggleOpen: () => setOpenRowId(openRowId === e.id ? null : e.id),
                onToggleDone: () => toggleDone(e.id),
                onEdit: () => { setEditId(e.id); setAdding(false); },
                onRemove: () => setConfirm({ kind: 'exercise', id: e.id, name: e.name }),
              })
        )
      ),

      (adding && !editId) && h(ExerciseForm, {
        accent: c,
        initial: null,
        onSave: saveExercise,
        onCancel: () => setAdding(false),
      }),

      !adding && !editId && h('button', {
        id: 'add-exercise-btn',
        className: 'add-trigger-btn',
        onClick: () => setAdding(true),
      },
        h(Icon, { d: icons.plus, size: 16 }),
        'Nuovo esercizio'
      ),

      exs.length > 0 && h('div', { className: 'lib-manage' },
        otherActivities.length > 0 && h('button', { className: 'btn-ghost', onClick: () => setMoving(m => !m) },
          moving ? 'Annulla spostamento' : 'Sposta gli esercizi in un’altra scheda'),
        h('button', { className: 'btn-ghost danger', onClick: () => setConfirm({ kind: 'activity', name: activity.name }) },
          'Elimina la scheda'),
        moving && h('div', { className: 'lib-move-list' },
          h('p', null, `Sposta gli esercizi di "${activity.name}" in:`),
          otherActivities.map(t => h('button', {
            key: t.id,
            className: 'btn-ghost',
            onClick: () => {
              onMerge(activity.id, t.id);
              setMoving(false);
              showToast(`Esercizi spostati in "${t.name}" ✓`);
            },
          }, t.name))
        )
      )
    ),

    confirm && h(ConfirmDialog, {
      title: confirm.kind === 'activity' ? 'Elimina scheda' : 'Elimina esercizio',
      msg: confirm.kind === 'activity'
        ? `Vuoi eliminare la scheda "${confirm.name}" e tutti i suoi esercizi?`
        : `Vuoi eliminare "${confirm.name}"?`,
      onConfirm: doConfirm,
      onCancel: () => setConfirm(null),
    })
  );
}

/* ============================================================
   EXERCISE ROW — cerchio da spuntare, dettagli a richiesta
   ============================================================ */
function ExerciseRow({ ex, accent, open, onToggleOpen, onToggleDone, onEdit, onRemove }) {
  const done = doneToday(ex);
  const f = freshness(ex.lastDone);
  const embed = driveEmbed(ex.videoUrl);
  const when = done ? 'fatto oggi' : f.label;

  return h('div', { className: 'ex-row' + (done ? ' done' : '') },
    h('div', { className: 'ex-row-main' },
      h('button', {
        className: 'ex-check' + (done ? ' on' : ''),
        style: { '--acc': accent.dot },
        onClick: onToggleDone,
        'aria-pressed': done ? 'true' : 'false',
        'aria-label': done ? `Togli la spunta a ${ex.name}` : `Segna ${ex.name} come fatto oggi`,
      }, done ? h(Icon, { d: icons.check, size: 14, color: '#fff', strokeWidth: 3 }) : null),
      h('button', { className: 'ex-row-info', onClick: onToggleOpen, 'aria-expanded': open ? 'true' : 'false' },
        h('span', { className: 'ex-row-name' }, ex.name),
        h('span', { className: 'ex-row-meta' },
          h('span', { style: { color: f.c } }, when),
          ` · ${ex.count || 0}× fatto`,
          (typeof ex.priority === 'number') ? ` · priorità ${ex.priority}` : '',
          avgTime(ex) ? ` · ~${avgTime(ex)} min` : ''
        )
      ),
      ex.videoUrl && h(Icon, { d: icons.video, size: 16, style: { color: 'var(--text-muted)', flexShrink: 0 } })
    ),

    open && h('div', { className: 'ex-row-more' },
      ex.notes && h('p', { className: 'exercise-notes' }, ex.notes),
      ex.videoUrl && (embed
        ? h('div', { className: 'video-wrapper' },
            h('iframe', { src: embed, allow: 'autoplay', allowFullScreen: true, title: ex.name }))
        : null),
      ex.videoUrl && h('a', { href: ex.videoUrl, target: '_blank', rel: 'noreferrer', className: 'video-link', style: { color: accent.dot } },
        h(Icon, { d: icons.play, size: 13 }), 'Apri il video'),
      h('div', { className: 'ex-row-actions' },
        h('button', { className: 'btn-ghost', onClick: onEdit }, h(Icon, { d: icons.pencil, size: 14 }), ' Modifica'),
        h('button', { className: 'btn-ghost danger', onClick: onRemove }, h(Icon, { d: icons.trash, size: 14 }), ' Elimina')
      )
    )
  );
}

/* ============================================================
   ALLENAMENTO GUIDATO — un esercizio alla volta
   ============================================================ */
function Allenamento({ activity, exercises, accent, onDone, onSaveTime, onExit }) {
  // Ordine fissato all'inizio: i dati si rileggono per id dalla prop aggiornata
  const [allIds] = useState(() => exercises.map(e => e.id));
  const [order, setOrder] = useState(allIds);
  const [idx, setIdx] = useState(0);
  const [skipped, setSkipped] = useState([]);

  const byId = (id) => exercises.find(e => e.id === id);
  const total = order.length;
  const finished = idx >= total;
  const ex = finished ? null : byId(order[idx]);

  // Cambio esercizio: si riparte dall'alto
  useEffect(() => { window.scrollTo(0, 0); }, [idx, order]);

  const next = () => setIdx(i => i + 1);
  const skip = () => {
    if (ex) setSkipped(s => s.includes(ex.id) ? s : [...s, ex.id]);
    next();
  };
  const doneAndNext = () => {
    if (ex && !doneToday(ex)) onDone(ex.id);
    next();
  };

  if (finished) {
    const fatti = allIds.filter(id => doneToday(byId(id))).length;
    const saltati = skipped.filter(id => byId(id) && !doneToday(byId(id)));
    const rifai = () => { setOrder(saltati); setSkipped([]); setIdx(0); };
    return h('div', { className: 'page' },
      h('div', { className: 'content tr-end' },
        h('div', { className: 'tr-end-icon', style: { background: accent.dot } },
          h(Icon, { d: icons.check, size: 32, color: '#fff', strokeWidth: 3 })),
        h('h2', { className: 'tr-end-title' }, 'Allenamento finito'),
        h('p', { className: 'tr-end-sub' }, `Fatti oggi ${fatti} di ${allIds.length}`),
        h('div', { className: 'tr-actions' },
          saltati.length > 0 && h('button', { className: 'tr-btn tr-btn-sec', onClick: rifai }, 'Rifai i saltati'),
          h('button', { className: 'tr-btn tr-btn-main', style: { background: accent.dot }, onClick: onExit },
            `Torna a ${activity.name}`)
        )
      )
    );
  }

  // Esercizio sparito nel frattempo (eliminato): si passa oltre
  if (!ex) return h('div', { className: 'page' }, h('div', { className: 'content' },
    h('button', { className: 'tr-btn tr-btn-sec', onClick: next }, 'Avanti')));

  const done = doneToday(ex);
  const f = freshness(ex.lastDone);
  const d = daysSince(ex.lastDone);
  const last = done ? 'fatto oggi' : (ex.lastDone ? (d === 1 ? '1 giorno fa' : `${d} giorni fa`) : 'mai fatto');
  const embed = driveEmbed(ex.videoUrl);

  return h('div', { className: 'page' },
    h('div', { className: 'content tr-wrap' },
      h('div', { className: 'tr-top' },
        h('button', { className: 'tr-exit', onClick: onExit },
          h(Icon, { d: icons.back, size: 18 }), 'Esci'),
        h('span', { className: 'tr-count' }, `${activity.name} · esercizio ${idx + 1} di ${total}`)
      ),
      h('div', { className: 'tr-bar' },
        h('div', { className: 'tr-bar-fill', style: { width: (idx / total * 100) + '%', background: accent.dot } })),
      h('div', { className: 'tr-card' },
        h('h2', { className: 'tr-name' }, ex.name),
        h('p', { className: 'tr-last', style: { color: done ? f.c : undefined } }, `ultima volta: ${last}`),
        ex.videoUrl && (embed
          ? h('div', { className: 'video-wrapper' },
              h('iframe', { src: embed, allow: 'autoplay; fullscreen', allowFullScreen: true, title: ex.name }))
          : h('a', { href: ex.videoUrl, target: '_blank', rel: 'noreferrer', className: 'video-link', style: { color: accent.dot } },
              h(Icon, { d: icons.play, size: 13 }), 'Apri il video')),
        ex.notes && h('p', { className: 'tr-notes' }, ex.notes)
      ),
      h(Timer, { key: ex.id, accent: accent.dot, onSaveTime }),
      h('div', { className: 'tr-actions' },
        h('button', { className: 'tr-btn tr-btn-sec', onClick: skip }, 'Salta'),
        h('button', { className: 'tr-btn tr-btn-main', style: { background: accent.dot },
          onClick: done ? next : doneAndNext }, done ? 'Avanti' : 'Fatto, avanti')
      )
    )
  );
}

/* ============================================================
   EXERCISE FORM (CREAZIONE / MODIFICA)
   ============================================================ */
function ExerciseForm({ initial, accent, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [priority, setPriority] = useState(initial?.priority != null ? String(initial.priority) : '');

  const save = () => {
    if (!name.trim()) return;
    const prRaw = priority.trim();
    const prNum = prRaw === '' ? null : parseInt(prRaw, 10);
    onSave({
      id:       initial?.id || uid(),
      name:     name.trim(),
      videoUrl: videoUrl.trim(),
      notes:    notes.trim(),
      count:    initial?.count || 0,
      lastDone: initial?.lastDone || null,
      timeLog:  initial?.timeLog  || [],
      priority: Number.isFinite(prNum) ? prNum : null,
    });
  };

  return h('div', { className: 'exercise-form-card' },
    h('div', null,
      h('label', { className: 'form-label' }, 'Nome esercizio *'),
      h('input', {
        type: 'text',
        className: 'form-input',
        placeholder: 'Es. Stretching bicipite femorale, Squat…',
        value: name,
        onInput: e => setName(e.target.value),
        autoFocus: true,
      })
    ),
    h('div', null,
      h('label', { className: 'form-label' }, 'Link Video (Drive, YouTube, Vimeo)'),
      h('input', {
        type: 'url',
        className: 'form-input',
        placeholder: 'https://…',
        value: videoUrl,
        onInput: e => setVideoUrl(e.target.value),
      })
    ),
    h('div', null,
      h('label', { className: 'form-label' }, 'Istruzioni / Serie / Ripetizioni / Note'),
      h('textarea', {
        className: 'form-input form-textarea',
        placeholder: 'Es. 3 serie da 10 rip con 60s di recupero…',
        value: notes,
        onInput: e => setNotes(e.target.value),
      })
    ),
    h('div', null,
      h('label', { className: 'form-label' }, 'Priorità (opzionale, es. 1 alta, 2 media…)'),
      h('input', {
        type: 'number',
        className: 'form-input',
        placeholder: 'Es. 1',
        value: priority,
        onInput: e => setPriority(e.target.value),
        style: { width: '120px' },
      })
    ),
    h('div', { className: 'form-actions' },
      h('button', { className: 'btn-ghost', onClick: onCancel }, 'Annulla'),
      h('button', { className: 'btn-submit', style: { background: accent.dot }, onClick: save }, 'Salva esercizio')
    )
  );
}

/* ============================================================
   TIMER DIGITALE
   ============================================================ */
function Timer({ accent, onSaveTime }) {
  const [sec, setSec] = useState(0);
  const [running, setRunning] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (running) {
      ref.current = setInterval(() => setSec(s => s + 1), 1000);
      return () => clearInterval(ref.current);
    }
  }, [running]);

  const fmt = (t) => {
    const m = String(Math.floor(t / 60)).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const saveAndReset = () => {
    const minutes = Math.max(1, Math.round(sec / 60));
    if (onSaveTime) onSaveTime(minutes);
    setRunning(false);
    setSec(0);
  };

  return h('div', { className: 'timer-card' },
    h('div', { className: 'timer-left' },
      h(Icon, { d: icons.clock, size: 20, style: { color: running ? accent : 'var(--text-muted)' } }),
      h('span', { className: 'timer-display' }, fmt(sec))
    ),
    h('div', { className: 'timer-controls' },
      h('button', {
        className: 'timer-toggle-btn',
        style: { background: accent },
        onClick: () => setRunning(r => !r),
      },
        h(Icon, { d: running ? icons.pause : icons.play, size: 14, color: '#fff' }),
        running ? 'Pausa' : 'Avvia'
      ),
      sec > 0 && h('button', {
        className: 'timer-save-btn',
        onClick: saveAndReset,
        title: 'Registra tempo e azzera',
      },
        h(Icon, { d: icons.check, size: 14 }),
        'Salva'
      ),
      h('button', {
        className: 'timer-reset-btn',
        title: 'Azzera cronometro',
        onClick: () => { setRunning(false); setSec(0); },
      }, h(Icon, { d: icons.reset, size: 15 }))
    )
  );
}

/* ============================================================
   MOUNT
   ============================================================ */
render(h(App), document.getElementById('app'));
