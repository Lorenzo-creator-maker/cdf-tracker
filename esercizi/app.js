/**
 * LIBRERIA ESERCIZI — collegata al CDF Tracker
 * SPA Preact via CDN (nessun build step).
 * Le attività NON si creano qui: arrivano dal CDF Tracker tramite deep-link
 *   esercizi/#act=<id>&name=<nome>&color=<verde|blu|ambra|viola>
 * Qui si gestiscono solo gli ESERCIZI di ciascuna attività, indicizzati per id.
 * Sincronizzazione: basket Pantry dedicato "esercizi" (stesso Pantry ID del CDF,
 * letto da localStorage 'cdfPantryId' — condiviso perché stessa origine su GitHub Pages).
 */

import { h, render, Fragment } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10.22.0/hooks';

/* Chart.js da CDN */
const loadChart = async () => {
  if (window.Chart) return window.Chart;
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
  await new Promise(resolve => { script.onload = resolve; document.head.appendChild(script); });
  return window.Chart;
};

/* ============================================================
   COSTANTI & HELPERS
   ============================================================ */
const COLORS = {
  verde:  { name: 'Fisica & Benessere', dot: '#2f9e6f', soft: '#e7f0ed', line: '#bcd6cf' },
  blu:    { name: 'Lavoro',             dot: '#178fb8', soft: '#e3eef3', line: '#b6d4e0' },
  ambra:  { name: 'Autotrattamento',    dot: '#e07b1a', soft: '#f6e9db', line: '#e7c6a0' },
  viola:  { name: 'Corsi',              dot: '#7c5cbf', soft: '#ece6f6', line: '#cdbfe8' },
};
const COLOR_KEYS = Object.keys(COLORS);

/* IDs builtin del CDF Tracker — speculare a SECTIONS in index.html */
const BUILTIN_IDS = new Set([
  'respiro','esvoce','schiena','bagua','trapz','cfg','esyoga','kf','occhi','perin','collo','polsi','allungamento','seqex',
  'at_p','at_s','at_focali','at_l',
  'indicazioni','risprec','mail','promemoria','ordinefile','foto','ripasso','enagic','pagamenti',
  'argA','argB','argC','argD','argE','argF','argG',
]);

/* Legge cdfTracker_v2 e restituisce il Set di actId validi nel CDF.
   Ritorna null se i dati CDF non sono disponibili su questo dispositivo (no filtro). */
function getCdfValidIds() {
  try {
    const raw = localStorage.getItem('cdfTracker_v2');
    if (!raw) return null;
    const d = JSON.parse(raw);
    const ids = new Set(BUILTIN_IDS);
    const deleted = d._deletedActivities || {};
    const customs = d._customActivities || {};
    for (const sid in customs) {
      (customs[sid] || []).forEach(a => { if (a && a.id) ids.add(a.id); });
    }
    for (const id in deleted) ids.delete(id);
    return ids;
  } catch { return null; }
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysSince = (iso) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso + 'T00:00:00').getTime();
  return Math.floor(ms / 86400000);
};
const freshness = (iso) => {
  const d = daysSince(iso);
  if (d === null) return { c: '#c2c2c2', label: 'mai fatto', bg: '#f4f4f4' };
  if (d <= 0)  return { c: '#2f9e6f', label: 'oggi', bg: '#e7f0ed' };
  if (d <= 3)  return { c: '#2f9e6f', label: `${d}g fa`, bg: '#e7f0ed' };
  if (d <= 7)  return { c: '#e0a91a', label: `${d}g fa`, bg: '#fef9e7' };
  return { c: '#d2552e', label: `${d}g fa`, bg: '#fdf0ec' };
};
const avgTime = (exercise) => {
  const log = exercise.timeLog || [];
  if (!log.length) return null;
  const total = log.reduce((s, entry) => s + (entry.minutes || 0), 0);
  return Math.round(total / log.length);
};
const uid = () => Math.random().toString(36).slice(2, 9);

/* Drive link -> embed URL */
function driveEmbed(url) {
  if (!url) return null;
  const m = url.match(/\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  return null;
}

/* ============================================================
   DATA LAYER — cache locale + sync Pantry (basket "esercizi")
   Forma dello store:
     { <actId>: { name, color, exercises: [ {id,name,videoUrl,notes,count,lastDone} ] },
       _updatedAt: <ms> }
   ============================================================ */
const PANTRY_KEY = 'cdfPantryId';        // condiviso col CDF (stessa origine)
const EX_BASKET  = 'esercizi';           // basket Pantry dedicato agli esercizi
const LOCAL_KEY  = 'exercise-data-v2';   // cache locale dello store

const getPantryId = () => { try { return localStorage.getItem(PANTRY_KEY) || ''; } catch { return ''; } };
const basketUrl   = () => 'https://getpantry.cloud/apiv1/pantry/' + encodeURIComponent(getPantryId()) + '/basket/' + EX_BASKET;
const isMeta      = (k) => k.startsWith('_');
function stripMeta(o) { if (!o || typeof o !== 'object') return o; const c = { ...o }; delete c._metadata; return c; }

const localStore = {
  get() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch (e) { console.error(e); } },
};

async function pullRemote() {
  if (!getPantryId()) return null;
  try {
    const r = await fetch(basketUrl(), { method: 'GET', cache: 'no-store' });
    if (r.status === 400) return null;            // basket non ancora creato
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return stripMeta(await r.json());
  } catch (e) { return 'ERR'; }
}
async function pushRemote(store) {
  if (!getPantryId()) return false;
  try {
    const r = await fetch(basketUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(store) });
    return r.ok;
  } catch (e) { return false; }
}

/* Tombstoni (come nel CDF Tracker): _deleted = { actId: ms } board eliminate,
   _deletedEx = { exId: ms } esercizi eliminati. Vengono uniti PRIMA del resto
   (vince il ms più recente) e sono AUTOREVOLI al merge: un id tombstonato non può
   rientrare nello store, da qualunque dispositivo/copia cloud provenga. Senza questo,
   il read-merge-write in persist() faceva risorgere ogni elemento appena cancellato. */
function mergeTomb(a, b) {
  const out = { ...(a || {}) };
  Object.keys(b || {}).forEach(id => { out[id] = Math.max(out[id] || 0, b[id] || 0); });
  return out;
}
function stripDeletedEx(entry, delEx) {
  if (!entry || !entry.exercises) return entry;
  return { ...entry, exercises: entry.exercises.filter(e => !delEx[e.id]) };
}

/* Unione non distruttiva di due store: union delle attività e degli esercizi (per id);
   sui conflitti vince l'esercizio con conteggio più alto / lastDone più recente / priorità.
   name/color vengono dal lato con _updatedAt più recente.
   I tombstoni (_deleted / _deletedEx) escludono board ed esercizi eliminati. */
function mergeStores(a, b) {
  if (!a) return b || {};
  if (!b) return a || {};
  const delAct = mergeTomb(a._deleted, b._deleted);
  const delEx  = mergeTomb(a._deletedEx, b._deletedEx);
  const out = {};
  const ids = new Set(Object.keys(a).concat(Object.keys(b)).filter(k => !isMeta(k)));
  const aNewer = (a._updatedAt || 0) >= (b._updatedAt || 0);
  ids.forEach(id => {
    if (delAct[id]) return;                        // board eliminata: non risorge
    const x = a[id], y = b[id];
    if (!x) { out[id] = stripDeletedEx(y, delEx); return; }
    if (!y) { out[id] = stripDeletedEx(x, delEx); return; }
    const byId = {};
    (x.exercises || []).forEach(e => { if (!delEx[e.id]) byId[e.id] = e; });
    (y.exercises || []).forEach(e => {
      if (delEx[e.id]) return;                      // esercizio eliminato: non risorge
      const p = byId[e.id];
      if (!p) { byId[e.id] = e; return; }
      const eScore = [(e.count || 0), (e.lastDone || ''), (e.priority ?? -1)];
      const pScore = [(p.count || 0), (p.lastDone || ''), (p.priority ?? -1)];
      byId[e.id] = (
        eScore[0] > pScore[0] ||
        (eScore[0] === pScore[0] && eScore[1] > pScore[1]) ||
        (eScore[0] === pScore[0] && eScore[1] === pScore[1] && eScore[2] > pScore[2])
      ) ? e : p;
    });
    const newer = aNewer ? x : y;
    out[id] = { name: newer.name || x.name || y.name, color: newer.color || x.color || y.color, exercises: Object.values(byId) };
  });
  out._updatedAt = Math.max(a._updatedAt || 0, b._updatedAt || 0);
  if (Object.keys(delAct).length) out._deleted   = delAct;
  if (Object.keys(delEx).length)  out._deletedEx = delEx;
  return out;
}

/* Deep-link: legge #act=..&name=..&color=.. */
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
/* Garantisce che lo store abbia una voce per l'attività del deep-link, aggiornandone nome/colore */
function ensureEntry(store, seed) {
  const s = { ...store };
  const prev = s[seed.id];
  s[seed.id] = { name: seed.name, color: seed.color, exercises: (prev && prev.exercises) || [] };
  // Riapertura esplicita dal deep-link del CDF: togli un eventuale tombstone della board
  // (l'utente la sta intenzionalmente riusando, quindi non deve restare cancellata).
  if (s._deleted && s._deleted[seed.id]) {
    const d = { ...s._deleted }; delete d[seed.id]; s._deleted = d;
  }
  return s;
}

/* ============================================================
   SVG ICONS (inline, no external dep)
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
  grip:    'M9 5h2M13 5h2M9 12h2M13 12h2M9 19h2M13 19h2',
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
  _toastSetState(ts => [...ts, { id, msg }]);
  setTimeout(() => _toastSetState(ts => ts.filter(t => t.id !== id)), 2200);
}

/* ============================================================
   CONFIRM DIALOG
   ============================================================ */
function ConfirmDialog({ title, msg, onConfirm, onCancel }) {
  return h('div', { className: 'confirm-overlay', onClick: onCancel },
    h('div', { className: 'confirm-box', onClick: e => e.stopPropagation() },
      h('div', { className: 'confirm-title' }, title),
      h('div', { className: 'confirm-msg' }, msg),
      h('div', { className: 'confirm-actions' },
        h('button', { className: 'btn-ghost', onClick: onCancel }, 'Annulla'),
        h('button', { className: 'btn-danger', onClick: onConfirm }, 'Elimina'),
      )
    )
  );
}

/* ============================================================
   APP ROOT
   ============================================================ */
function App() {
  const [store, setStore] = useState(null);   // null = loading
  const [openId, setOpenId] = useState(null);
  const [sortMode, setSortModeRaw] = useState(() => {
    try { return localStorage.getItem('exSortMode') || 'stale'; } catch { return 'stale'; }
  });
  const setSortMode = useCallback((m) => {
    setSortModeRaw(m);
    try { localStorage.setItem('exSortMode', m); } catch {}
  }, []);
  const [synced, setSynced] = useState(!!getPantryId());
  const pushTimer = useRef(null);

  /* Load: cache locale subito, poi merge col remoto. Gestisce anche il deep-link. */
  useEffect(() => {
    const seed = parseHash();
    let s = localStore.get();
    if (seed) s = ensureEntry(s, seed);
    setStore(s);
    if (seed) setOpenId(seed.id);

    (async () => {
      const remote = await pullRemote();
      if (remote && remote !== 'ERR') {
        setStore(prev => {
          let merged = mergeStores(prev || {}, remote);
          if (seed) merged = ensureEntry(merged, seed);   // nome/colore freschi dal link
          localStore.set(merged);
          return merged;
        });
      }
      setSynced(!!getPantryId());
    })();

    /* Navigazione in entrata da CDF mentre l'app è già aperta */
    const onHash = () => {
      const sd = parseHash();
      if (!sd) return;
      setStore(prev => { const ns = ensureEntry(prev || {}, sd); localStore.set(ns); return ns; });
      setOpenId(sd.id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /* Salva: locale immediato + push remoto con debounce (read-merge-write). */
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
    return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#a8a29e', fontFamily: 'Inter, sans-serif' } }, 'Carico la libreria…');
  }

  const open = (openId && store[openId]) ? { id: openId, ...store[openId] } : null;

  const updateActivity = (updated) => {
    const ns = { ...store };
    ns[updated.id] = { name: updated.name, color: updated.color, exercises: updated.exercises };
    persist(ns);
  };
  const removeActivity = (id) => {
    const ns = { ...store };
    delete ns[id];
    ns._deleted = { ...(ns._deleted || {}), [id]: Date.now() };   // tombstone: non risorge alla sync
    persist(ns);
  };
  // Elimina un singolo esercizio da una board e ne registra il tombstone.
  const removeExercise = (actId, exId) => {
    const ns = { ...store };
    const act = ns[actId];
    if (act) ns[actId] = { ...act, exercises: (act.exercises || []).filter(e => e.id !== exId) };
    ns._deletedEx = { ...(ns._deletedEx || {}), [exId]: Date.now() };
    persist(ns);
  };
  // Unisce tutti gli esercizi di sourceId in targetId, poi elimina la sorgente.
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
      // vince chi ha count più alto, poi lastDone più recente
      byId[e.id] = ((e.count || 0) > (p.count || 0) ||
        ((e.count || 0) === (p.count || 0) && (e.lastDone || '') > (p.lastDone || ''))) ? e : p;
    });
    ns[targetId] = { name: tgt.name || src.name, color: tgt.color || src.color, exercises: Object.values(byId) };
    delete ns[sourceId];
    ns._deleted = { ...(ns._deleted || {}), [sourceId]: Date.now() };  // il doppione resta eliminato
    persist(ns);
  };
  const goHome = () => {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    setOpenId(null);
  };

  return h(Fragment, null,
    open
      ? h(Board, {
          activity: open,
          sortMode, setSortMode,
          onBack: goHome,
          onChange: updateActivity,
          onRemoveExercise: removeExercise,
        })
      : h(Home, { store, synced, onOpen: setOpenId, onRemove: removeActivity, onMerge: mergeActivity }),
    h(ToastHost)
  );
}

/* ============================================================
   ACTIVITY TIME CHART — grafico a torta del tempo totale per attività (Home)
   ============================================================ */
function ActivityTimeChart({ activities }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const data = activities
      .map(a => {
        const totalTime = (a.exercises || []).reduce((s, e) => {
          const avg = avgTime(e);
          return s + (avg || 0);
        }, 0);
        return { name: a.name, color: COLORS[a.color]?.dot || '#999', total: totalTime };
      })
      .filter(item => item.total > 0);

    if (data.length === 0) return;

    (async () => {
      const Chart = await loadChart();
      if (!Chart || !canvasRef.current) return;

      if (chartRef.current) chartRef.current.destroy();

      const ctx = canvasRef.current.getContext('2d');
      chartRef.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: data.map(d => `${d.name} (${d.total}m)`),
          datasets: [{
            data: data.map(d => d.total),
            backgroundColor: data.map(d => d.color),
            borderColor: '#fff',
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12, usePointStyle: true } },
            tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed}m` } },
          },
        },
      });
    })();

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [activities]);

  return h('div', { className: 'time-chart-container' },
    h('p', { className: 'chart-title' }, '📊 Tempo per attività'),
    h('canvas', { ref: canvasRef, id: 'activity-time-chart' })
  );
}

/* ============================================================
   HOME — attività che hanno esercizi (arrivano dal CDF)
   ============================================================ */
function Home({ store, synced, onOpen, onRemove, onMerge }) {
  const [confirm, setConfirm] = useState(null);   // { id, name }
  const [movingId, setMovingId] = useState(null); // id della card da spostare

  const allActivities = Object.keys(store)
    .filter(k => !isMeta(k))
    .map(id => ({ id, ...store[id] }))
    .sort((a, b) => {
      const ci = COLOR_KEYS.indexOf(a.color) - COLOR_KEYS.indexOf(b.color);
      return ci !== 0 ? ci : (a.name || '').localeCompare(b.name || '');
    });

  const validIds = getCdfValidIds();
  const activities = validIds ? allActivities.filter(a => validIds.has(a.id)) : allActivities;
  const orphanCount = allActivities.length - activities.length;

  const totalExercises = activities.reduce((s, a) => s + (a.exercises ? a.exercises.length : 0), 0);
  const totalDone = activities.reduce((s, a) => s + (a.exercises || []).reduce((ss, e) => ss + (e.count || 0), 0), 0);

  const doRemove = () => { onRemove(confirm.id); setConfirm(null); showToast('Attività rimossa dalla libreria'); };

  return h('div', { className: 'page' },
    h('header', { className: 'header' },
      h('a', { className: 'header-back', href: '../' },
        h(Icon, { d: icons.back, size: 16 }),
        'CDF Tracker'
      ),
      h('div', { className: 'header-title-row' },
        h('h1', { style: { fontSize: '20px', fontWeight: 700, letterSpacing: '-0.4px' } }, '📚 Libreria Esercizi'),
      ),
      activities.length > 0
        ? h('p', { className: 'header-sub' },
            `${activities.length} attività · ${totalExercises} esercizi · ${totalDone} esecuzioni`)
        : h('p', { className: 'header-sub' }, synced ? 'Sincronizzato col cloud' : 'Solo su questo dispositivo'),
    ),

    h('div', { className: 'content' },
      activities.length === 0 && h('div', { className: 'empty' },
        h('div', { className: 'empty-icon' }, '🏋️'),
        h('p', null,
          'Nessun esercizio ancora.', h('br'),
          'Apri il ', h('a', { href: '../', style: { color: '#2f9e6f', fontWeight: 600 } }, 'CDF Tracker'),
          ' e tocca il nome di un’attività per aggiungere i suoi esercizi qui.'
        )
      ),

      activities.length > 0 && h('p', { className: 'home-hint' },
        'Le attività arrivano dal CDF Tracker. Tocca un’attività per gestirne gli esercizi.'
      ),

      activities.length > 0 && h(ActivityTimeChart, { activities }),

      orphanCount > 0 && h('p', { style: { textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 12px' } },
        `${orphanCount} ${orphanCount === 1 ? 'attività rimossa' : 'attività rimosse'} dal CDF Tracker`
      ),

      ...activities.map(a => {
        const c = COLORS[a.color] || COLORS.verde;
        const exs = a.exercises || [];
        const done = exs.reduce((s, e) => s + (e.count || 0), 0);
        const stale = exs.filter(e => { const d = daysSince(e.lastDone); return d === null || d > 7; }).length;
        const totalAvgTime = exs.reduce((s, e) => { const avg = avgTime(e); return s + (avg || 0); }, 0);
        const isMoving = movingId === a.id;
        const otherActivities = activities.filter(x => x.id !== a.id);
        return h('div', { key: a.id, className: 'activity-card' },
          h('button', {
            id: `activity-${a.id}`,
            className: 'activity-btn',
            onClick: () => { if (!isMoving) onOpen(a.id); },
          },
            h('span', { className: 'dot', style: { background: c.dot } }),
            h('div', { className: 'activity-info' },
              h('div', { className: 'activity-name' }, a.name),
              h('div', { style: { display: 'flex', gap: '6px', marginTop: '5px', flexWrap: 'wrap' } },
                h('span', { className: 'stat-pill' }, `${exs.length} esercizi`),
                h('span', { className: 'stat-pill' }, `${done}× eseguiti`),
                totalAvgTime > 0 && h('span', { className: 'stat-pill', style: { color: c.dot, background: c.soft } }, `⏱ ${totalAvgTime}m`),
                stale > 0 && h('span', { className: 'stat-pill', style: { color: '#d2552e', background: '#fdf0ec' } }, `${stale} da ripassare`),
              ),
            ),
            h(Icon, { d: icons.arrow, size: 16, style: { marginLeft: 'auto', color: '#d6d3ce' } }),
          ),
          h('div', { style: { display: 'flex', gap: '4px' } },
            h('button', {
              className: 'icon-btn',
              title: isMoving ? 'Annulla spostamento' : 'Sposta esercizi in un\'altra attività',
              style: isMoving ? { color: '#2563eb' } : {},
              onClick: () => setMovingId(isMoving ? null : a.id),
            }, isMoving ? '✕' : h(Icon, { d: 'M5 12h14M13 6l6 6-6 6', size: 15 })),
            h('button', {
              className: 'icon-btn',
              title: 'Rimuovi dalla libreria (gli esercizi vengono cancellati)',
              onClick: () => setConfirm({ id: a.id, name: a.name }),
            }, h(Icon, { d: icons.trash, size: 15 })),
          ),
          isMoving && h('div', { style: { padding: '8px 12px 10px', borderTop: '1px solid #f0ede8' } },
            h('p', { style: { fontSize: '12px', color: '#78716c', margin: '0 0 6px' } },
              'Sposta tutti gli esercizi di "' + a.name + '" in:'
            ),
            otherActivities.length === 0
              ? h('p', { style: { fontSize: '12px', color: '#a8a29e', fontStyle: 'italic' } }, 'Nessun\'altra attività disponibile.')
              : otherActivities.map(t =>
                  h('button', {
                    key: t.id,
                    style: {
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '7px 10px', margin: '3px 0',
                      background: '#f7f6f3', border: '1px solid #e8e4de',
                      borderRadius: '8px', fontSize: '13px', fontWeight: 500,
                      cursor: 'pointer',
                    },
                    onClick: () => {
                      onMerge(a.id, t.id);
                      setMovingId(null);
                      showToast('Esercizi spostati in "' + t.name + '" ✓');
                    },
                  }, t.name)
                )
          )
        );
      }),
    ),

    confirm && h(ConfirmDialog, {
      title: 'Rimuovi attività',
      msg: `Rimuovere "${confirm.name}" e tutti i suoi esercizi dalla libreria? L’attività resta nel CDF Tracker.`,
      onConfirm: doRemove,
      onCancel: () => setConfirm(null),
    })
  );
}

/* ============================================================
   BOARD — bacheca esercizi di una attività
   ============================================================ */
function Board({ activity, sortMode, setSortMode, onBack, onChange, onRemoveExercise }) {
  const c = COLORS[activity.color] || COLORS.verde;
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const update = (exercises) => onChange({ ...activity, exercises });

  const staleKey = (e) => (daysSince(e.lastDone) ?? 1e9);
  const prioKey  = (e) => (typeof e.priority === 'number' ? e.priority : -Infinity);
  const sorted = [...activity.exercises];
  if (sortMode === 'most')          sorted.sort((a, b) => (b.count || 0) - (a.count || 0));
  else if (sortMode === 'stale')    sorted.sort((a, b) => staleKey(b) - staleKey(a));
  else if (sortMode === 'priority') sorted.sort((a, b) => (prioKey(b) - prioKey(a)) || (staleKey(b) - staleKey(a)));

  const markDone = (id) => {
    update(activity.exercises.map(e =>
      e.id === id ? { ...e, count: (e.count || 0) + 1, lastDone: todayISO() } : e
    ));
    showToast('Esercizio segnato ✓');
  };
  const saveTimeForActivity = (minutes) => {
    const today = todayISO();
    update(activity.exercises.map(e => {
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
    update(activity.exercises.map(e =>
      e.id === id ? { ...e, count: Math.max(0, (e.count || 0) - 1) } : e
    ));
  };
  const remove = (id, name) => setConfirm({ id, name });
  const doRemove = () => {
    onRemoveExercise(activity.id, confirm.id);   // rimuove + tombstone (così non risorge)
    setConfirm(null);
    showToast('Esercizio eliminato');
  };
  const saveExercise = (ex) => {
    const exists = activity.exercises.some(e => e.id === ex.id);
    update(exists
      ? activity.exercises.map(e => e.id === ex.id ? ex : e)
      : [...activity.exercises, ex]
    );
    setAdding(false); setEditId(null);
    showToast(exists ? 'Esercizio aggiornato ✓' : 'Esercizio aggiunto ✓');
  };

  const doneCount = activity.exercises.reduce((s, e) => s + (e.count || 0), 0);

  return h('div', { className: 'page' },
    h('header', { className: 'header' },
      h('button', { className: 'header-back', onClick: onBack },
        h(Icon, { d: icons.back, size: 16 }),
        'Tutte le attività'
      ),
      h('div', { className: 'header-title-row' },
        h('span', { className: 'dot', style: { background: c.dot, width: 14, height: 14 } }),
        h('h1', null, activity.name),
      ),
      h('p', { className: 'header-sub' },
        `${activity.exercises.length} esercizi · ${doneCount} esecuzioni totali`
      ),
    ),

    h(Timer, { accent: c.dot, key: activity.id, onSaveTime: saveTimeForActivity }),
    h(TimeChart, { exercises: activity.exercises, color: c.dot }),

    /* sort bar */
    h('div', { className: 'sort-bar' },
      h(Icon, { d: icons.sort, size: 14, style: { color: '#a8a29e', flexShrink: 0 } }),
      [['stale', 'Da ripassare'], ['priority', 'Priorità'], ['most', 'Più fatti'], ['manual', 'Mio ordine']].map(([k, label]) =>
        h('button', {
          key: k,
          className: 'sort-pill' + (sortMode === k ? ' active' : ''),
          style: sortMode === k ? { background: c.soft, borderColor: c.line } : {},
          onClick: () => setSortMode(k),
        }, label)
      )
    ),

    h('div', { className: 'content' },
      activity.exercises.length === 0 && !adding && h('div', { className: 'empty' },
        h('div', { className: 'empty-icon' }, '🎯'),
        h('p', null, 'Nessun esercizio ancora.', h('br'), 'Aggiungine uno qui sotto.')
      ),

      ...sorted.map(e =>
        h(ExerciseRow, {
          key: e.id, ex: e, accent: c,
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
        className: 'add-trigger',
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
      /* freshness indicator */
      h('div', {
        style: {
          width: 10, height: 10,
          borderRadius: '50%',
          background: f.c,
          marginTop: 5,
          flexShrink: 0,
          boxShadow: `0 0 0 3px ${f.bg}`,
        },
        title: f.label,
      }),

      h('div', { className: 'exercise-info' },
        h('button', {
          className: 'exercise-name exercise-name-btn',
          title: 'Tocca per modificare',
          onClick: onEdit,
        }, ex.name),
        ex.notes && h('div', { className: 'exercise-notes' }, ex.notes),
        h('div', { className: 'exercise-stats' },
          h('span', null, `${ex.count || 0}× eseguito`),
          avgTime(ex) && h('span', null, `⏱ ${avgTime(ex)}m`),
          (typeof ex.priority === 'number') && h('span', {
            className: 'freshness-badge',
            style: { background: accent.soft, color: accent.dot },
          }, `priorità ${ex.priority}`),
          h('span', {
            className: 'freshness-badge',
            style: { background: f.bg, color: f.c },
          }, f.label),
        ),
      ),

      h('div', { className: 'exercise-actions' },
        h('button', {
          className: 'done-btn ripple',
          style: { background: accent.dot },
          onClick: onDone,
          title: 'Segna come fatto',
        },
          h(Icon, { d: icons.check, size: 13, color: '#fff' }),
          'Fatto'
        ),
        h('div', { className: 'mini-actions' },
          ex.videoUrl && h('button', {
            className: 'mini-btn play',
            title: showVideo ? 'Nascondi video' : 'Mostra video',
            onClick: () => setShowVideo(v => !v),
          }, h(Icon, { d: showVideo ? icons.minus : icons.video, size: 14 })),
          h('button', { className: 'mini-btn', title: 'Annulla esecuzione', onClick: onUndo },
            h(Icon, { d: icons.minus, size: 14 })
          ),
          h('button', { className: 'mini-btn edit', title: 'Modifica', onClick: onEdit },
            h(Icon, { d: icons.pencil, size: 14 })
          ),
          h('button', { className: 'mini-btn danger', title: 'Elimina', onClick: onRemove },
            h(Icon, { d: icons.trash, size: 14 })
          ),
        )
      )
    ),

    showVideo && ex.videoUrl && h('div', { className: 'video-panel' },
      embed
        ? h('div', { className: 'video-wrapper' },
            h('iframe', { src: embed, allow: 'autoplay', allowFullScreen: true, title: ex.name })
          )
        : h('p', { className: 'video-no-preview' }, 'Anteprima non disponibile per questo link.'),
      h('a', {
        href: ex.videoUrl, target: '_blank', rel: 'noreferrer',
        className: 'video-link',
        style: { color: accent.dot },
      },
        h(Icon, { d: icons.play, size: 12 }),
        'Apri video'
      )
    )
  );
}

/* ============================================================
   EXERCISE FORM
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
  const handleKey = (e) => { if (e.key === 'Enter' && e.ctrlKey) save(); };

  return h('div', {
    className: 'add-card',
    style: { borderColor: accent.line, borderWidth: '2px' },
  },
    h('div', { className: 'form-group' },
      h('input', {
        id: initial ? `edit-exercise-${initial.id}` : 'new-exercise-name',
        autoFocus: true,
        className: 'form-input',
        value: name,
        placeholder: 'Nome esercizio…',
        onInput: e => setName(e.target.value),
        onKeyDown: handleKey,
      }),
      h('input', {
        id: initial ? `edit-exercise-video-${initial.id}` : 'new-exercise-video',
        className: 'form-input',
        value: videoUrl,
        placeholder: 'Link video Google Drive (opzionale)',
        onInput: e => setVideoUrl(e.target.value),
      }),
      h('input', {
        id: initial ? `edit-exercise-notes-${initial.id}` : 'new-exercise-notes',
        className: 'form-input',
        value: notes,
        placeholder: 'Note: serie / ripetizioni (opzionale)',
        onInput: e => setNotes(e.target.value),
        onKeyDown: handleKey,
      }),
      h('input', {
        id: initial ? `edit-exercise-priority-${initial.id}` : 'new-exercise-priority',
        className: 'form-input',
        type: 'number',
        inputMode: 'numeric',
        value: priority,
        placeholder: 'Priorità: numero più alto = più in alto (opzionale)',
        onInput: e => setPriority(e.target.value),
        onKeyDown: handleKey,
      }),
      h('p', { style: { fontSize: '11px', color: '#a8a29e' } }, 'Ctrl+Enter per salvare'),
      h('div', { className: 'form-actions' },
        h('button', {
          className: 'btn-primary ripple',
          style: { background: accent.dot },
          onClick: save,
        }, initial ? 'Aggiorna' : '+ Aggiungi'),
        h('button', { className: 'btn-ghost', onClick: onCancel }, 'Annulla'),
      )
    )
  );
}

/* ============================================================
   TIME CHART — grafico a torta dei tempi per esercizio
   ============================================================ */
function TimeChart({ exercises, color }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const data = exercises
      .map(ex => ({ name: ex.name, avg: avgTime(ex), color }))
      .filter(item => item.avg !== null);

    if (data.length === 0) return;

    (async () => {
      const Chart = await loadChart();
      if (!Chart || !canvasRef.current) return;

      if (chartRef.current) chartRef.current.destroy();

      const colors = [
        '#2f9e6f', '#178fb8', '#e07b1a', '#7c5cbf',
        '#ec4899', '#f59e0b', '#10b981', '#6366f1',
      ];

      const ctx = canvasRef.current.getContext('2d');
      chartRef.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: data.map(d => `${d.name} (${d.avg}m)`),
          datasets: [{
            data: data.map(d => d.avg),
            backgroundColor: colors.slice(0, data.length),
            borderColor: '#fff',
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12, usePointStyle: true } },
            tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed}m` } },
          },
        },
      });
    })();

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [exercises]);

  const hasData = exercises.some(ex => avgTime(ex) !== null);
  if (!hasData) return null;

  return h('div', { className: 'time-chart-container' },
    h('canvas', { ref: canvasRef, id: 'time-chart' })
  );
}

/* ============================================================
   TIMER
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
    const minutes = Math.round(sec / 60);
    if (minutes > 0 && onSaveTime) {
      onSaveTime(minutes);
    }
    setRunning(false);
    setSec(0);
  };

  return h('div', { className: 'timer' + (running ? ' timer-running' : '') },
    h(Icon, { d: icons.clock, size: 16, style: { color: running ? accent : '#a8a29e', flexShrink: 0 } }),
    h('span', { className: 'timer-display' }, fmt(sec)),
    h('div', { className: 'timer-actions' },
      h('button', {
        id: 'timer-toggle-btn',
        className: 'timer-btn ripple',
        style: { background: accent },
        onClick: () => setRunning(r => !r),
      },
        h(Icon, { d: running ? icons.pause : icons.play, size: 13, color: '#fff' }),
        running ? ' Pausa' : ' Avvia'
      ),
      sec > 0 && h('button', {
        id: 'timer-save-btn',
        className: 'timer-save',
        style: { color: accent, borderColor: accent },
        onClick: saveAndReset,
        title: 'Salva tempo e azzera',
      },
        h(Icon, { d: icons.check, size: 13 }),
        ' Salva'
      ),
      h('button', {
        id: 'timer-reset-btn',
        className: 'timer-reset',
        title: 'Azzera',
        onClick: () => { setRunning(false); setSec(0); },
      }, h(Icon, { d: icons.reset, size: 15 }))
    )
  );
}

/* ============================================================
   MOUNT
   ============================================================ */
render(h(App), document.getElementById('app'));
