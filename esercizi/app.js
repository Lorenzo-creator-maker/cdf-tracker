/**
 * LIBRERIA ESERCIZI — Integrata con CDF Tracker
 * SPA Preact via CDN (nessun build step).
 * Sincronizzazione: basket Pantry dedicato "esercizi" (stesso Pantry ID del CDF).
 */

import { h, render, Fragment } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect, useRef, useCallback, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import { BUILTIN_IDS, SECTION_IDS, SECTION_COLOR_MAP, SECTION_HEX_MAP, DEFAULT_ACTIVITY_NAMES } from '../shared.js';

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
  verde:  { name: 'Fisica & Benessere', dot: '#10b981', soft: 'rgba(16,185,129,0.14)', line: 'rgba(16,185,129,0.35)', hex: '#10b981' },
  ambra:  { name: 'Autotrattamento',    dot: '#f59e0b', soft: 'rgba(245,158,11,0.14)', line: 'rgba(245,158,11,0.35)', hex: '#f59e0b' },
  viola:  { name: 'Corsi',              dot: '#8b5cf6', soft: 'rgba(139,92,246,0.14)', line: 'rgba(139,92,246,0.35)', hex: '#8b5cf6' },
  blu:    { name: 'Lavoro',             dot: '#0284c7', soft: 'rgba(2,132,199,0.14)', line: 'rgba(2,132,199,0.35)', hex: '#0284c7' },
};
const COLOR_KEYS = Object.keys(COLORS);

const todayISO = () => new Date().toISOString().slice(0, 10);
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
    let p = localStorage.getItem('cdfPantryId') || '';
    p = p.trim().replace(/['"“”;<>\/\s]/g, '');
    const m = p.match(/(?:pantry\/|id=)([0-9a-fA-F-]{10,})/i);
    return m ? m[1] : p;
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
    const res = await fetch(`https://getpantry.cloud/apiv1/pantry/${pId}/basket/${EX_BASKET}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return stripMeta(await res.json());
  } catch { return 'ERR'; }
}

async function pushRemote(store) {
  const pId = getPantryId();
  if (!pId) return;
  try {
    await fetch(`https://getpantry.cloud/apiv1/pantry/${pId}/basket/${EX_BASKET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store),
    });
  } catch {}
}

function mergeTomb(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = Math.max(out[k] || 0, v || 0);
  }
  return out;
}

function stripDeletedEx(entry, delEx) {
  if (!entry || !entry.exercises) return entry;
  return { ...entry, exercises: entry.exercises.filter(e => !delEx[e.id]) };
}

function mergeStores(a, b) {
  const delAct = mergeTomb(a._deleted, b._deleted);
  const delEx  = mergeTomb(a._deletedEx, b._deletedEx);
  const out = { _deleted: delAct, _deletedEx: delEx };

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.forEach(k => {
    if (isMeta(k) || delAct[k]) return;
    const ea = stripDeletedEx(a[k], delEx);
    const eb = stripDeletedEx(b[k], delEx);
    if (!ea) { out[k] = eb; return; }
    if (!eb) { out[k] = ea; return; }

    const byId = {};
    (ea.exercises || []).forEach(e => { byId[e.id] = e; });
    (eb.exercises || []).forEach(e => {
      if (delEx[e.id]) return;
      const prev = byId[e.id];
      if (!prev) { byId[e.id] = e; return; }
      const winE = ((e.count || 0) > (prev.count || 0) ||
        ((e.count || 0) === (prev.count || 0) && (e.lastDone || '') > (prev.lastDone || ''))) ? e : prev;
      byId[e.id] = winE;
    });

    out[k] = {
      name: eb.name || ea.name,
      color: eb.color || ea.color,
      exercises: Object.values(byId),
    };
  });
  return out;
}

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
        setStore(prev => {
          let merged = mergeStores(prev || {}, remote);
          const cl = cleanEmptyActivities(merged);
          merged = cl.cleaned;
          localStore.set(merged);
          return merged;
        });
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
    localStore.set(nextStore);
    setStore(nextStore);
    if (!getPantryId()) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      const remote = await pullRemote();
      const toSave = (remote && remote !== 'ERR') ? mergeStores(nextStore, remote) : nextStore;
      localStore.set(toSave);
      setStore(toSave);
      pushRemote(toSave);
    }, 1000);
  }, []);

  if (!store) {
    return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--text-muted)' } }, 'Caricamento libreria…');
  }

  // Risoluzione activity aperta (può essere una scheda nello store o una bozza transitoria)
  const open = openId
    ? (store[openId] ? { id: openId, ...store[openId] } : (draftSeed && draftSeed.id === openId ? { ...draftSeed, exercises: [] } : null))
    : null;

  const updateActivity = (updated) => {
    const ns = { ...store };
    ns[updated.id] = { name: updated.name, color: updated.color, exercises: updated.exercises };
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
      if (!p) { byId[e.id] = e; return; }
      byId[e.id] = ((e.count || 0) > (p.count || 0) ||
        ((e.count || 0) === (p.count || 0) && (e.lastDone || '') > (p.lastDone || ''))) ? e : p;
    });
    ns[targetId] = { name: tgt.name || src.name, color: tgt.color || src.color, exercises: Object.values(byId) };
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
          isDark, toggleTheme,
        })
      : h(Home, {
          store, synced,
          onOpen: setOpenId,
          onRemove: removeActivity,
          onMerge: mergeActivity,
          onAddBoard: (act) => {
            updateActivity({ id: act.id, name: act.name, color: act.color, exercises: [] });
            setOpenId(act.id);
          },
          searchQuery, setSearchQuery,
          isDark, toggleTheme,
        }),
    h(ToastHost)
  );
}

/* ============================================================
   HOME — Elenco attività della libreria
   ============================================================ */
function Home({ store, synced, onOpen, onRemove, onMerge, onAddBoard, searchQuery, setSearchQuery, isDark, toggleTheme }) {
  const [confirm, setConfirm] = useState(null);
  const [movingId, setMovingId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Lista attività che hanno almeno 1 esercizio
  const activeActivities = useMemo(() => {
    return Object.keys(store)
      .filter(k => !isMeta(k))
      .map(id => ({ id, ...store[id] }))
      .filter(a => Array.isArray(a.exercises) && a.exercises.length > 0)
      .sort((a, b) => {
        const ci = COLOR_KEYS.indexOf(a.color) - COLOR_KEYS.indexOf(b.color);
        return ci !== 0 ? ci : (a.name || '').localeCompare(b.name || '');
      });
  }, [store]);

  const totalExercises = activeActivities.reduce((s, a) => s + (a.exercises ? a.exercises.length : 0), 0);
  const totalDone = activeActivities.reduce((s, a) => s + (a.exercises || []).reduce((ss, e) => ss + (e.count || 0), 0), 0);

  // Filtro di ricerca
  const filteredActivities = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return activeActivities;
    return activeActivities.filter(a => {
      if ((a.name || '').toLowerCase().includes(q)) return true;
      return (a.exercises || []).some(e => (e.name || '').toLowerCase().includes(q) || (e.notes || '').toLowerCase().includes(q));
    });
  }, [activeActivities, searchQuery]);

  const doRemove = () => {
    onRemove(confirm.id);
    setConfirm(null);
    showToast('Scheda attività rimossa');
  };

  return h('div', { className: 'page' },
    h('header', { className: 'header' },
      h('div', { className: 'header-top-nav' },
        h('a', { className: 'nav-btn home-btn', href: '../', title: 'Torna all\'app principale ATTIVITÀ' },
          h(Icon, { d: icons.home, size: 16 }),
          h('span', null, '← Torna a CDF (Home)')
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
      h('div', { className: 'header-title-row' },
        h('h1', null, '📚 Libreria Esercizi'),
      ),
      h('div', { className: 'header-stats-chips' },
        h('span', { className: 'stat-chip' }, `${activeActivities.length} attività`),
        h('span', { className: 'stat-chip' }, `${totalExercises} esercizi`),
        h('span', { className: 'stat-chip' }, `${totalDone} esecuzioni`)
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
      ),
      h('div', { className: 'action-bar' },
        h('button', { className: 'btn-primary-action', onClick: () => setShowAddModal(true) },
          h(Icon, { d: icons.plus, size: 15, color: '#fff' }),
          'Nuova scheda per un’attività'
        )
      )
    ),

    h('div', { className: 'content' },
      filteredActivities.length === 0 && h('div', { className: 'empty-box' },
        h('div', { className: 'empty-box-icon' }, '🏋️'),
        h('p', null,
          searchQuery
            ? 'Nessun esercizio trovato con questa ricerca.'
            : 'Nessuna scheda con esercizi attivi ancora.',
          h('br'),
          h('span', { style: { fontSize: '13px' } }, 'Tocca "Nuova scheda per un’attività" per iniziare ad aggiungere esercizi.')
        )
      ),

      filteredActivities.map(a => {
        const c = COLORS[a.color] || COLORS.verde;
        const exs = a.exercises || [];
        const done = exs.reduce((s, e) => s + (e.count || 0), 0);
        const stale = exs.filter(e => { const d = daysSince(e.lastDone); return d === null || d > 7; }).length;
        const totalAvgTime = exs.reduce((s, e) => { const avg = avgTime(e); return s + (avg || 0); }, 0);
        const isMoving = movingId === a.id;
        const otherActivities = activeActivities.filter(x => x.id !== a.id);

        return h('div', {
          key: a.id,
          className: 'activity-card',
          style: { '--card-accent': c.dot },
        },
          h('div', { className: 'activity-card-row' },
            h('button', {
              id: `activity-${a.id}`,
              className: 'activity-btn',
              onClick: () => { if (!isMoving) onOpen(a.id); },
            },
              h('span', { className: 'dot', style: { background: c.dot } }),
              h('div', { className: 'activity-info' },
                h('div', { className: 'activity-name' }, a.name),
                h('div', { className: 'activity-chips' },
                  h('span', { className: 'stat-pill' }, `${exs.length} esercizi`),
                  h('span', { className: 'stat-pill' }, `${done}× fatti`),
                  totalAvgTime > 0 && h('span', { className: 'stat-pill' }, `⏱ ~${totalAvgTime}m`),
                  stale > 0 && h('span', { className: 'stat-pill stale' }, `${stale} da ripassare`),
                )
              ),
              h(Icon, { d: icons.arrow, size: 16, style: { marginLeft: 'auto', color: 'var(--text-muted)' } })
            ),
            h('div', { className: 'activity-actions' },
              h('button', {
                className: 'icon-btn',
                title: isMoving ? 'Annulla spostamento' : 'Sposta esercizi in un\'altra scheda',
                onClick: () => setMovingId(isMoving ? null : a.id),
              }, isMoving ? '✕' : h(Icon, { d: 'M5 12h14M13 6l6 6-6 6', size: 15 })),
              h('button', {
                className: 'icon-btn danger',
                title: 'Rimuovi scheda e i suoi esercizi',
                onClick: () => setConfirm({ id: a.id, name: a.name }),
              }, h(Icon, { d: icons.trash, size: 15 }))
            )
          ),
          isMoving && h('div', { style: { marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' } },
            h('p', { style: { fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: 6 } },
              `Sposta gli esercizi di "${a.name}" in:`
            ),
            otherActivities.length === 0
              ? h('p', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, 'Nessun\'altra scheda disponibile.')
              : otherActivities.map(t =>
                  h('button', {
                    key: t.id,
                    className: 'btn-ghost',
                    style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 },
                    onClick: () => {
                      onMerge(a.id, t.id);
                      setMovingId(null);
                      showToast(`Esercizi spostati in "${t.name}" ✓`);
                    },
                  }, t.name)
                )
          )
        );
      })
    ),

    /* Modal Nuova Scheda */
    showAddModal && h(NewBoardModal, {
      onClose: () => setShowAddModal(false),
      onCreate: (act) => {
        setShowAddModal(false);
        onAddBoard(act);
      },
    }),

    confirm && h(ConfirmDialog, {
      title: 'Rimuovi scheda',
      msg: `Vuoi rimuovere la scheda "${confirm.name}" e tutti i suoi esercizi dalla libreria?`,
      onConfirm: doRemove,
      onCancel: () => setConfirm(null),
    })
  );
}

/* ============================================================
   MODAL: NUOVA SCHEDA PER ATTIVITÀ
   ============================================================ */
function NewBoardModal({ onClose, onCreate }) {
  const cdfList = useMemo(() => getCdfActivities(), []);
  const [selectedId, setSelectedId] = useState(cdfList[0]?.id || 'custom');
  const [customName, setCustomName] = useState('');
  const [selectedColor, setSelectedColor] = useState('verde');

  const handleSelect = (e) => {
    const id = e.target.value;
    setSelectedId(id);
    const found = cdfList.find(x => x.id === id);
    if (found) {
      setSelectedColor(found.color || 'verde');
    }
  };

  const handleCreate = () => {
    if (selectedId === 'custom') {
      if (!customName.trim()) return;
      onCreate({
        id: 'cust_ex_' + uid(),
        name: customName.trim(),
        color: selectedColor,
      });
    } else {
      const found = cdfList.find(x => x.id === selectedId);
      if (!found) return;
      onCreate({
        id: found.id,
        name: found.name,
        color: found.color || selectedColor,
      });
    }
  };

  return h('div', { className: 'modal-backdrop', onClick: onClose },
    h('div', { className: 'modal-card', onClick: e => e.stopPropagation() },
      h('h3', { className: 'modal-title' }, 'Nuova Scheda Esercizi'),
      h('p', { className: 'modal-sub' }, 'Seleziona un’attività dal tuo CDF Tracker o inseriscine una personalizzata:'),

      h('div', { style: { marginBottom: 12 } },
        h('label', { className: 'form-label' }, 'Attività di riferimento'),
        h('select', { className: 'form-input', value: selectedId, onChange: handleSelect },
          cdfList.map(a => h('option', { key: a.id, value: a.id }, `${a.name} (${COLORS[a.color]?.name || a.color})`)),
          h('option', { value: 'custom' }, '➕ Altra attività personalizzata…')
        )
      ),

      selectedId === 'custom' && h('div', { style: { marginBottom: 12 } },
        h('label', { className: 'form-label' }, 'Nome nuova attività'),
        h('input', {
          type: 'text',
          className: 'form-input',
          placeholder: 'Es. Esercizi Respirazione, Postura…',
          value: customName,
          onInput: e => setCustomName(e.target.value),
        })
      ),

      h('div', { style: { marginBottom: 16 } },
        h('label', { className: 'form-label' }, 'Categoria / Colore'),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 4 } },
          COLOR_KEYS.map(k => h('button', {
            key: k,
            type: 'button',
            onClick: () => setSelectedColor(k),
            style: {
              width: 28, height: 28, borderRadius: '50%',
              background: COLORS[k].dot,
              border: selectedColor === k ? '3px solid #fff' : '2px solid transparent',
              boxShadow: selectedColor === k ? '0 0 0 2px ' + COLORS[k].dot : 'none',
              cursor: 'pointer',
            },
            title: COLORS[k].name,
          }))
        )
      ),

      h('div', { className: 'form-actions' },
        h('button', { className: 'btn-ghost', onClick: onClose }, 'Annulla'),
        h('button', { className: 'btn-submit', onClick: handleCreate }, 'Crea ed entra')
      )
    )
  );
}

/* ============================================================
   BOARD — Bacheca esercizi di una attività
   ============================================================ */
function Board({ activity, sortMode, setSortMode, onBack, onChange, onRemoveExercise, isDark, toggleTheme }) {
  const c = COLORS[activity.color] || COLORS.verde;
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const update = (exercises) => onChange({ ...activity, exercises });

  const staleKey = (e) => (daysSince(e.lastDone) ?? 1e9);
  const prioKey  = (e) => (typeof e.priority === 'number' ? e.priority : -Infinity);

  const sorted = [...(activity.exercises || [])];
  if (sortMode === 'most')          sorted.sort((a, b) => (b.count || 0) - (a.count || 0));
  else if (sortMode === 'stale')    sorted.sort((a, b) => staleKey(b) - staleKey(a));
  else if (sortMode === 'priority') sorted.sort((a, b) => (prioKey(b) - prioKey(a)) || (staleKey(b) - staleKey(a)));
  else if (sortMode === 'name')     sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const markDone = (id) => {
    update((activity.exercises || []).map(e =>
      e.id === id ? { ...e, count: (e.count || 0) + 1, lastDone: todayISO() } : e
    ));
    showToast('Esercizio completato ✓');
  };

  const saveTimeForActivity = (minutes) => {
    const today = todayISO();
    update((activity.exercises || []).map(e => {
      const log = e.timeLog || [];
      const today_entry = log.find(entry => entry.date === today);
      const updated_log = today_entry
        ? log.map(entry => entry.date === today ? { ...entry, minutes: entry.minutes + minutes } : entry)
        : [...log, { date: today, minutes }];
      return { ...e, timeLog: updated_log };
    }));
    showToast(`⏱ +${minutes} min registrati`);
  };

  const undo = (id) => {
    update((activity.exercises || []).map(e =>
      e.id === id ? { ...e, count: Math.max(0, (e.count || 0) - 1) } : e
    ));
  };

  const remove = (id, name) => setConfirm({ id, name });
  const doRemove = () => {
    onRemoveExercise(activity.id, confirm.id);
    setConfirm(null);
    showToast('Esercizio eliminato');
  };

  const saveExercise = (ex) => {
    const list = activity.exercises || [];
    const exists = list.some(e => e.id === ex.id);
    update(exists
      ? list.map(e => e.id === ex.id ? ex : e)
      : [...list, ex]
    );
    setAdding(false);
    setEditId(null);
    showToast(exists ? 'Esercizio aggiornato ✓' : 'Esercizio aggiunto ✓');
  };

  const doneCount = (activity.exercises || []).reduce((s, e) => s + (e.count || 0), 0);

  return h('div', { className: 'page' },
    h('header', { className: 'header' },
      h('div', { className: 'header-top-nav' },
        h('div', { className: 'header-nav-group' },
          h('a', { className: 'nav-btn home-btn', href: '../', title: 'Torna subito alla schermata principale di CDF' },
            h(Icon, { d: icons.home, size: 15 }),
            h('span', null, '← Home CDF')
          ),
          h('button', { className: 'nav-btn library-btn', onClick: onBack, title: 'Torna all\'elenco di tutte le schede' },
            h(Icon, { d: icons.book, size: 15 }),
            h('span', null, '📚 Tutte le schede')
          )
        ),
        h('div', { className: 'header-actions' },
          h('button', { className: 'theme-toggle-btn', onClick: toggleTheme, title: isDark ? 'Passa a tema chiaro' : 'Passa a tema scuro' },
            isDark ? '☀️' : '🌙'
          )
        )
      ),

      h('div', { className: 'header-title-row' },
        h('span', { className: 'dot', style: { background: c.dot, width: 14, height: 14 } }),
        h('h1', null, activity.name)
      ),
      h('p', { className: 'header-sub' },
        `${(activity.exercises || []).length} esercizi · ${doneCount} esecuzioni totali`
      )
    ),

    /* Timer compatto */
    h(Timer, { accent: c.dot, key: activity.id, onSaveTime: saveTimeForActivity }),

    /* Sort Bar */
    h('div', { className: 'sort-bar' },
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

    /* Elenco Esercizi */
    h('div', { className: 'content' },
      (activity.exercises || []).length === 0 && !adding && h('div', { className: 'empty-box' },
        h('div', { className: 'empty-box-icon' }, '🎯'),
        h('p', null, 'Nessun esercizio ancora.', h('br'), 'Aggiungine uno con il pulsante qui sotto.')
      ),

      sorted.map(e =>
        h(ExerciseRow, {
          key: e.id,
          ex: e,
          accent: c,
          onDone: () => markDone(e.id),
          onUndo: () => undo(e.id),
          onEdit: () => { setEditId(e.id); setAdding(false); },
          onRemove: () => remove(e.id, e.name),
          isEditing: editId === e.id,
          onSave: saveExercise,
          onCancelEdit: () => setEditId(null),
        })
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
      )
    ),

    confirm && h(ConfirmDialog, {
      title: 'Elimina esercizio',
      msg: `Vuoi eliminare "${confirm.name}"?`,
      onConfirm: doRemove,
      onCancel: () => setConfirm(null),
    })
  );
}

/* ============================================================
   EXERCISE ROW
   ============================================================ */
function ExerciseRow({ ex, accent, onDone, onUndo, onEdit, onRemove, isEditing, onSave, onCancelEdit }) {
  const [showVideo, setShowVideo] = useState(false);
  const f = freshness(ex.lastDone);
  const embed = driveEmbed(ex.videoUrl);

  if (isEditing) {
    return h(ExerciseForm, {
      accent,
      initial: ex,
      onSave,
      onCancel: onCancelEdit,
    });
  }

  return h('div', { className: 'exercise-row' },
    h('div', { className: 'exercise-row-main' },
      /* Freshness indicator */
      h('div', {
        className: 'freshness-indicator',
        style: {
          background: f.c,
          boxShadow: `0 0 0 3px ${f.bg}`,
        },
        title: f.label,
      }),

      h('div', { className: 'exercise-info' },
        h('button', {
          className: 'exercise-name-btn',
          title: 'Tocca per modificare',
          onClick: onEdit,
        }, ex.name),
        ex.notes && h('div', { className: 'exercise-notes' }, ex.notes),
        h('div', { className: 'exercise-meta-row' },
          h('span', { className: 'ex-tag' }, `${ex.count || 0}× fatto`),
          avgTime(ex) && h('span', { className: 'ex-tag' }, `⏱ ~${avgTime(ex)}m`),
          (typeof ex.priority === 'number') && h('span', {
            className: 'ex-tag',
            style: { background: accent.soft, color: accent.dot },
          }, `priorità ${ex.priority}`),
          h('span', {
            className: 'ex-tag freshness',
            style: { background: f.bg, color: f.c },
          }, f.label),
        )
      ),

      h('div', { className: 'exercise-actions' },
        h('button', {
          className: 'done-btn',
          style: { background: accent.dot },
          onClick: onDone,
          title: 'Segna come fatto',
        },
          h(Icon, { d: icons.check, size: 14, color: '#fff' }),
          'Fatto'
        ),
        h('div', { className: 'mini-actions' },
          ex.videoUrl && h('button', {
            className: 'mini-btn video-btn',
            title: showVideo ? 'Nascondi video' : 'Mostra video',
            onClick: () => setShowVideo(v => !v),
          }, h(Icon, { d: icons.video, size: 14 })),
          h('button', { className: 'mini-btn', title: 'Annulla esecuzione (-1)', onClick: onUndo },
            h(Icon, { d: icons.minus, size: 14 })
          ),
          h('button', { className: 'mini-btn', title: 'Modifica esercizio', onClick: onEdit },
            h(Icon, { d: icons.pencil, size: 14 })
          ),
          h('button', { className: 'mini-btn danger', title: 'Elimina esercizio', onClick: onRemove },
            h(Icon, { d: icons.trash, size: 14 })
          )
        )
      )
    ),

    showVideo && ex.videoUrl && h('div', { className: 'video-panel' },
      embed
        ? h('div', { className: 'video-wrapper' },
            h('iframe', { src: embed, allow: 'autoplay', allowFullScreen: true, title: ex.name })
          )
        : h('p', { style: { fontSize: '13px', color: 'var(--text-muted)' } }, 'Anteprima non disponibile.'),
      h('a', {
        href: ex.videoUrl, target: '_blank', rel: 'noreferrer',
        className: 'video-link',
        style: { color: accent.dot },
      },
        h(Icon, { d: icons.play, size: 13 }),
        'Apri video in nuova scheda'
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
