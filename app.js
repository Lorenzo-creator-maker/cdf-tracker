"use strict";
const APP_VERSION = "1787489951";  // sostituito col timestamp ad ogni pubblicazione (auto-aggiornamento)

/* ===================== Tema (dark / light) ===================== */
const THEME_KEY = "cdfTheme";
function applyTheme(){
  let saved = null;
  try{ saved = localStorage.getItem(THEME_KEY); }catch(e){}
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = saved === "dark" || (saved !== "light" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
  const btn = document.getElementById("themeToggle");
  if(btn) btn.textContent = dark ? "☀️" : "🌙";
  const meta = document.querySelector("meta[name='theme-color']");
  if(meta) meta.setAttribute("content", dark ? "#0f172a" : "#f1f5f9");
}
applyTheme();

/* ===================== Sezioni e attività =====================
   Tipi di attività:
   - normale  -> 7 caselle (una al giorno)
   - weekly:true -> 1 sola casella per settimana
   - odd:true -> spuntabile solo nei giorni dispari del mese            */
const SECTIONS = [
  { id:"fisica", name:"Fisica & Benessere", emoji:"🏃", activities:[
    {id:"respiro",name:"Respiro"},{id:"esvoce",name:"Es Voce"},{id:"schiena",name:"Schiena"},{id:"bagua",name:"Ba Gua"},
    {id:"trapz",name:"Tra pz e altro"},{id:"cfg",name:"CFG"},{id:"esyoga",name:"Es Yoga"},
    {id:"kf",name:"KF"},{id:"occhi",name:"Occhi"},{id:"perin",name:"Perin"},
    {id:"collo",name:"Collo"},{id:"polsi",name:"Polsi"},{id:"allungamento",name:"Allungamento"},
    {id:"seqex",name:"Seqex e P"}
  ]},
  { id:"autotrattamento", name:"Autotrattamento", emoji:"💆", activities:[
    {id:"at_p",name:"P"},{id:"at_s",name:"S"},{id:"at_focali",name:"Focali"},{id:"at_l",name:"L"}
  ]},
  { id:"lavoro", name:"Lavoro", emoji:"💼", activities:[
    {id:"indicazioni",name:"Indicazioni pz"},{id:"risprec",name:"Risp recensioni"},
    {id:"mail",name:"Mail importanti",freq:3},{id:"promemoria",name:"Promemoria"},
    {id:"ordinefile",name:"Ordine file"},{id:"foto",name:"Foto",freq:3},
    {id:"ripasso",name:"Ripasso"},{id:"enagic",name:"Enagic"},
    {id:"pagamenti",name:"Pagamenti",freq:1}
  ]},
  { id:"corsi", name:"Corsi", emoji:"📚", activities:[
    {id:"argF",name:"Mulligan",freq:1},
    {id:"argA",name:"ATM",freq:1},
    {id:"argB",name:"Belotti",freq:1},
    {id:"argC",name:"FCC",freq:1},
    {id:"argD",name:"Ipnovendita",freq:1},
    {id:"argE",name:"Montemagno",freq:1},
    {id:"argG",name:"Argomento G",freq:1}
  ]}
];

const DEFAULT_LABEL = {};
SECTIONS.forEach(s=>s.activities.forEach(a=>DEFAULT_LABEL[a.id]=a.name));

const DAYS_SHORT = ["L","M","M","G","V","S","D"];
const MONTHS = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];
const STORAGE_KEY = "cdfTracker_v2";
const PANTRY_KEY  = "cdfPantryId";
const BASKET = "cdf";

/* ===================== Ponte verso la Libreria Esercizi =====================
   Le attività del CDF sono la "lista madre": dalla libreria non si creano,
   si raggiungono via deep-link che porta nome + colore-sezione.            */
const SECTION_COLOR = SECTION_COLOR_MAP;  // from shared.js
const SECTION_HEX   = SECTION_HEX_MAP;    // from shared.js
function exHref(actId, secId){
  return "esercizi/index.html#act="+encodeURIComponent(actId)+
         "&name="+encodeURIComponent(actLabel(actId))+
         "&color="+(SECTION_COLOR[secId]||"verde");
}

/* ===================== Stato + persistenza locale ===================== */
let data = {};
try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch(e){ data = {}; }
const MIN_WEEK = "2026-08-17";
let pruned = false;
Object.keys(data).forEach(k => {
  if (!k.startsWith("_") && k < MIN_WEEK) {
    delete data[k];
    pruned = true;
  }
});
// Pulizia timestamps _ts per settimane passate
if (data._ts) {
  Object.keys(data._ts).forEach(k => {
    const wk = k.slice(0, 10);
    if (wk < MIN_WEEK) {
      delete data._ts[k];
      pruned = true;
    }
  });
}
// Pulisci i giorni precedenti a oggi nella settimana corrente se rimasti da sessioni passate
const currentMondayKey = fmtKey(getMonday(new Date()));
const curDayIndex = todayIndex(new Date());
if (data[currentMondayKey]) {
  Object.keys(data[currentMondayKey]).forEach(actId => {
    const arr = data[currentMondayKey][actId];
    if (Array.isArray(arr)) {
      for (let i = 0; i < curDayIndex; i++) {
        if (arr[i]) {
          arr[i] = false;
          pruned = true;
          if (data._ts) delete data._ts[`${currentMondayKey}_${actId}_${i}`];
        }
      }
    }
  });
}
if (pruned) {
  data._updatedAt = Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
}
if(!data._labels)           data._labels = {};
if(!data._updatedAt)        data._updatedAt = 0;
if(!data._sectionNames)     data._sectionNames = {};     // { secId: {name,emoji} }
if(!data._customActivities) data._customActivities = {};  // { secId: [{id,name,...}] }
if(!data._hiddenActivities) data._hiddenActivities = {};  // { actId: +ts nascosta | -ts esplicitamente mostrata }
if(!data._deletedActivities) data._deletedActivities = {}; // { actId: true } — eliminazione definitiva
if(!data._activityTypes)    data._activityTypes = {};     // { actId: {type,day?} } — override tipo

let pantryId = "";
try { pantryId = localStorage.getItem(PANTRY_KEY) || ""; } catch(e){}

let todayViewDate = new Date(); // Data mostrata nel tab Oggi

/* Sezioni richiuse nel tab Oggi — preferenza per-dispositivo, non sincronizzata */
const TFOLD_KEY = "cdfTodayFold";
let todayFold = {};
try{ todayFold = JSON.parse(localStorage.getItem(TFOLD_KEY)) || {}; }catch(e){ todayFold = {}; }
function saveFold(){ try{ localStorage.setItem(TFOLD_KEY, JSON.stringify(todayFold)); }catch(e){} }

// Migrazione dati vecchi (odd -> freq:3, weekly -> freq:1)
if(data._activityTypes){
  for(const k in data._activityTypes){
    const t = data._activityTypes[k];
    if(t.type === 'odd') { t.type = 'freq'; t.freq = 3; }
    if(t.type === 'weekly') { t.type = 'freq'; t.freq = 1; }
  }
}
if(data._customActivities){
  for(const sid in data._customActivities){
    data._customActivities[sid].forEach(a => {
      if(a.odd) { delete a.odd; a.freq = 3; }
      if(a.weekly) { delete a.weekly; a.freq = 1; }
    });
  }
}
let initialLoading = !!(pantryId && !hasRealData(data));

function saveLocal(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch(e){ alert("Impossibile salvare in locale. Esci dalla navigazione privata."); }
}

/* ===================== Sincronizzazione (Pantry) ===================== */
let syncState = pantryId ? "ok" : "off";
let pushTimer = null;

function pantryUrl(){ return "https://getpantry.cloud/apiv1/pantry/"+encodeURIComponent(pantryId)+"/basket/"+BASKET; }
function setSync(s){ syncState=s; paintSync(); }
function paintSync(){
  const dot=document.getElementById("syncDot"), txt=document.getElementById("syncTxt");
  dot.className="dot "+syncState;
  txt.textContent = syncState==="ok"?"Sincronizzato":
                    syncState==="saving"?"Salvataggio…":
                    syncState==="syncing"?"Ricezione…":
                    syncState==="error"?"Errore sync":"Sync off";
}
async function pullRemote(){
  if(!pantryId) return undefined;
  try{
    const r = await fetch(pantryUrl(), {method:"GET", cache:"no-store"});
    if(r.status===400 || r.status===404) return null;
    if(!r.ok) throw new Error("HTTP "+r.status);
    return await r.json();
  }catch(e){ return "ERR"; }
}
/* Pantry aggiunge _metadata: lo togliamo dal nostro oggetto */
function stripMeta(o){ if(!o || typeof o!=="object") return o; const c=Object.assign({},o); delete c._metadata; return c; }
/* Unisce due versioni dei dati senza perdere nulla (nomi, ordine, spunte). */
function mergeData(local, remote){
  remote = stripMeta(remote);
  if(!remote || typeof remote!=="object") return local;
  if(!local) return remote;
  const localNewer = (local._updatedAt||0) >= (remote._updatedAt||0);
  const newerGlobal = localNewer?local:remote, olderGlobal = localNewer?remote:local;
  const out = {};
  
  // _deletedActivities: union — se eliminato su un dispositivo, resta eliminato ovunque.
  // Lo calcoliamo PRIMA delle custom e delle settimane per usarlo come filtro autorevole.
  const mergedDeleted = Object.assign({}, olderGlobal._deletedActivities||{}, newerGlobal._deletedActivities||{});
  out._deletedActivities = mergedDeleted;

  const localTs = local._ts || {};
  const remoteTs = remote._ts || {};
  const mergedTs = {};
  const allTsKeys = new Set(Object.keys(localTs).concat(Object.keys(remoteTs)));
  allTsKeys.forEach(k => {
    const wk = k.slice(0, 10);
    if (wk >= MIN_WEEK) {
      mergedTs[k] = Math.max(localTs[k] || 0, remoteTs[k] || 0);
    }
  });
  out._ts = mergedTs;

  const weeks = {};
  Object.keys(local).concat(Object.keys(remote)).forEach(k=>{ if(!k.startsWith("_")) weeks[k]=1; });
  Object.keys(weeks).forEach(wk=>{
    if(wk < MIN_WEEK) return; // Filtra le settimane precedenti
    const merged = {};
    const allActs = new Set(Object.keys(local[wk]||{}).concat(Object.keys(remote[wk]||{})));
    allActs.forEach(actId=>{
      if(mergedDeleted[actId]) return;
      const a=(local[wk]||{})[actId], b=(remote[wk]||{})[actId];
      if(!a){ merged[actId]=b; }
      else if(!b){ merged[actId]=a; }
      else{ 
        merged[actId] = [false,false,false,false,false,false,false];
        for(let i=0; i<7; i++){
          const kTs = `${wk}_${actId}_${i}`;
          const tsA = localTs[kTs] || local._updatedAt || 0;
          const tsB = remoteTs[kTs] || remote._updatedAt || 0;
          merged[actId][i] = (tsA >= tsB) ? a[i] : b[i];
        }
      }
    });
    if(Object.keys(merged).length) out[wk]=merged;
  });
  // _labels / _sectionNames: un valore non-vuoto vince sempre su vuoto/assente (evita
  // che un dispositivo senza etichette sovrascriva quelle impostate sull'altro).
  // Solo quando entrambi hanno un valore non-vuoto vince il "più recente" (LWW normale).
  function mergeLabels(o, n){
    const keys = new Set(Object.keys(o||{}).concat(Object.keys(n||{})));
    const out2 = {};
    keys.forEach(k=>{ const ov=(o||{})[k], nv=(n||{})[k]; if(nv) out2[k]=nv; else if(ov) out2[k]=ov; });
    return out2;
  }
  out._labels       = mergeLabels(olderGlobal._labels,       newerGlobal._labels);
  out._sectionNames = mergeLabels(olderGlobal._sectionNames, newerGlobal._sectionNames);

  // _customActivities: union degli array (l'id più recente vince) MA un id con tombstone
  // viene SEMPRE escluso. Così un dispositivo fermo a una versione vecchia (o con dati
  // sporchi) non può "resuscitare" un fantasma già eliminato ricaricandolo nel cloud.
  const allSecIds = new Set(Object.keys(olderGlobal._customActivities||{}).concat(Object.keys(newerGlobal._customActivities||{})));
  const mergedCustom = {};
  allSecIds.forEach(sid=>{
    const oActs = (olderGlobal._customActivities||{})[sid]||[];
    const nActs = (newerGlobal._customActivities||{})[sid]||[];
    const byId = {};
    oActs.forEach(a=>{ if(a && a.id && !mergedDeleted[a.id]) byId[a.id]=a; });
    nActs.forEach(a=>{ if(a && a.id && !mergedDeleted[a.id]) byId[a.id]=a; }); // newer sovrascrive
    mergedCustom[sid] = Object.values(byId);
  });
  out._customActivities = mergedCustom;
  // _hiddenActivities: per-chiave vince l'azione più recente (|ts| maggiore).
  // Valori legacy `true` valgono ts=1 — sempre sovrascritti da timestamp reali.
  // Così "mostra" su un dispositivo batte "nascondi" su un altro se avvenuto dopo.
  const hOld = olderGlobal._hiddenActivities||{};
  const hNew = newerGlobal._hiddenActivities||{};
  const hMerged = {};
  new Set([...Object.keys(hOld),...Object.keys(hNew)]).forEach(id=>{
    const vo=hOld[id], vn=hNew[id];
    const to=vo===undefined?-1:Math.abs(vo===true?1:vo);
    const tn=vn===undefined?-1:Math.abs(vn===true?1:vn);
    hMerged[id] = tn>=to ? vn : vo;
  });
  out._hiddenActivities = hMerged;
  // _activityTypes: override tipo per attività (newer wins per chiave)
  out._activityTypes = Object.assign({}, olderGlobal._activityTypes||{}, newerGlobal._activityTypes||{});
  out._order  = newerGlobal._order || olderGlobal._order || {};
  out._updatedAt = Math.max(local._updatedAt||0, remote._updatedAt||0);
  return out;
}
function safeRender(){ const a=document.activeElement; if(a && (a.tagName==="INPUT"||a.tagName==="TEXTAREA")) return; render(); }
function hasRealData(o){ return Object.keys(o||{}).some(k=>!k.startsWith("_") && o[k] && Object.values(o[k]).some(arr=>Array.isArray(arr)&&arr.some(Boolean))); }
async function doPush(){
  if(!pantryId) return;
  setSync("saving");
  try{
    const remote = await pullRemote();              // leggi-unisci-scrivi: non sovrascrivo il cloud
    if(remote==="ERR"){ setSync("error"); return; } // lettura fallita: NON scrivere (sovrascriverebbe il cloud senza unire)
    if(remote){
      const before = JSON.stringify(data);
      data = mergeData(data, remote);
      repairData();   // mantieni puliti anche i dati riletti prima di riscrivere
      if(JSON.stringify(data)!==before){ saveLocal(); safeRender(); }
    }
    const r = await fetch(pantryUrl(), {method:"POST", headers:{"Content-Type":"application/json"}, keepalive:true, body:JSON.stringify(data)});
    setSync(r.ok ? "ok" : "error");
  }catch(e){ setSync("error"); }
}
function schedulePush(){
  if(!pantryId){ saveLocal(); return; }
  saveLocal(); setSync("saving");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(doPush, 500);
}
async function reconcile(){
  if(!pantryId){ setSync("off"); return; }
  setSync("syncing");
  try {
    const remote = await pullRemote();
    initialLoading = false;
    if(remote==="ERR"){ setSync("error"); render(); return; }
    const before = JSON.stringify(data);
    data = mergeData(data, remote);
    if(!data._labels)           data._labels={};
    if(!data._sectionNames)     data._sectionNames={};
    if(!data._customActivities) data._customActivities={};
    if(!data._hiddenActivities) data._hiddenActivities={};
    if(!data._deletedActivities) data._deletedActivities={};
    repairData();   // togli fantasmi/doppioni anche da ciò che arriva dal cloud
    // Ricarica i DEFAULT_LABEL con le attività custom sincronizzate
    for(const sec of SECTIONS){
      const customs=(data._customActivities&&data._customActivities[sec.id])||[];
      customs.forEach(a=>{ if(!DEFAULT_LABEL[a.id]) DEFAULT_LABEL[a.id]=a.name; });
    }
    if(JSON.stringify(data)!==before){ saveLocal(); }
    render();
    if(JSON.stringify(data)!==JSON.stringify(stripMeta(remote))) doPush();  // allinea il cloud al merge
    else setSync("ok");
  } catch(e) {
    initialLoading = false;
    setSync("error");
    render();
  }
}

/* ===================== Helper date ===================== */
function pad(n){ return String(n).length<2 ? "0"+n : ""+n; }
function fmtKey(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function getMonday(input){ const x=new Date(input); const wd=(x.getDay()+6)%7; x.setDate(x.getDate()-wd); x.setHours(0,0,0,0); return x; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function weekDates(monday){ const a=[]; for(let i=0;i<7;i++) a.push(addDays(monday,i)); return a; }

let viewMonday = getMonday(new Date());
let view = "today";

/* ===================== Colore rosso -> verde ===================== */
function gradColor(r){ r=Math.max(0,Math.min(1,r||0)); return "hsl("+Math.round(r*125)+",70%,45%)"; }

/* ===================== Accesso ai dati ===================== */
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function actLabel(id){
  if(data._labels && data._labels[id]) return data._labels[id];
  if(DEFAULT_LABEL[id]) return DEFAULT_LABEL[id];
  // Fallback: nome proprio dell'attività custom. Copre il PRIMO render all'avvio,
  // prima che reconcile() popoli DEFAULT_LABEL — altrimenti in "Oggi" si vedeva
  // l'id grezzo "cust_…" al posto del nome (es. Qi gong / Tai chi). Memorizza in
  // DEFAULT_LABEL così le chiamate successive sono immediate.
  if(data._customActivities){
    for(const sid in data._customActivities){
      const list = data._customActivities[sid] || [];
      for(let i=0;i<list.length;i++){
        const a = list[i];
        if(a && a.id===id && a.name){ DEFAULT_LABEL[id]=a.name; return a.name; }
      }
    }
  }
  return id;
}

/* Restituisce {name, emoji} per una sezione (custom o default) */
function sectionLabel(sec){
  const ov = data._sectionNames && data._sectionNames[sec.id];
  return { name: (ov && ov.name) || sec.name, emoji: (ov && ov.emoji) || sec.emoji };
}

/* Tutte le attività di una sezione: built-in + custom */
function allActivities(sec){
  const customs = (data._customActivities && data._customActivities[sec.id]) || [];
  return sec.activities.concat(customs);
}

/* Applica override tipo attività (data._activityTypes) a un'attività */
function resolveActType(act){
  const ov=(data._activityTypes||{})[act.id];
  if(!ov) return act;
  const b=Object.assign({},act);
  delete b.freq; delete b.day;
  if(ov.type==='freq') b.freq=ov.freq;
  else if(ov.type==='day') b.day=ov.day;
  return b;
}

/* Attività ordinate; includeHidden=true per mostrare anche le nascoste (usato in settings) */
function orderedActivities(sec, includeHidden){
  const ord = (data._order && data._order[sec.id]) || [];
  const all = allActivities(sec);
  const byId = {}; all.forEach(a=>byId[a.id]=a);
  const hidden = data._hiddenActivities || {};
  const deleted = data._deletedActivities || {};
  const out = [];
  // I deleted vengono esclusi SEMPRE (anche da includeHidden)
  ord.forEach(id=>{ if(byId[id] && !deleted[id] && (includeHidden || !hiddenVal(hidden[id]))){ out.push(byId[id]); delete byId[id]; } });
  all.forEach(a=>{ if(byId[a.id] && !deleted[a.id] && (includeHidden || !hiddenVal(hidden[a.id]))) out.push(a); });
  return out.map(a=>resolveActType(a));
}

/* ===================== Pulizia dati attività custom =====================
   Risolve due problemi che la sincronizzazione ripropone:
   1) attività personalizzate senza nome (si vedono come "cust_..." fantasma);
   2) doppioni con lo stesso nome nella stessa sezione (es. due "Qi gong").
   Usa _deletedActivities (tombstone): così l'eliminazione sopravvive al
   merge tra dispositivi e non "risorge". Le spunte dei doppioni vengono
   unite nell'attività mantenuta, quindi non si perde nulla.                 */
function hiddenVal(v){ return v===true || (typeof v==='number' && v>0); }
function effType(a){
  const ov=(data._activityTypes||{})[a.id];
  if(ov) return ov.type;
  return (a.freq !== undefined) ? 'freq' : (a.day !== undefined ? 'day' : 'normal');
}
function serializeActType(a){
  return (a.freq !== undefined) ? 'freq' : (a.day !== undefined ? 'day' : 'normal');
}
function tombstoneActivity(id){
  if(!data._deletedActivities) data._deletedActivities={};
  data._deletedActivities[id]=true;
  if(data._labels) delete data._labels[id];
  if(data._activityTypes) delete data._activityTypes[id];
  if(data._hiddenActivities) delete data._hiddenActivities[id];
  if(data._order) Object.keys(data._order).forEach(sid=>{
    data._order[sid]=(data._order[sid]||[]).filter(x=>x!==id);
  });
  Object.keys(data).forEach(wk=>{ if(!wk.startsWith("_") && data[wk]) delete data[wk][id]; });
}
function mergeChecks(fromId, toId){
  Object.keys(data).forEach(wk=>{
    if(wk.startsWith("_")) return;
    const w=data[wk]; if(!w||!w[fromId]) return;
    if(!w[toId]) w[toId]=w[fromId].slice();
    else for(let i=0;i<7;i++) w[toId][i]=!!(w[toId][i]||w[fromId][i]);
    delete w[fromId];
  });
}
function repairData(){
  if(!data._customActivities) return false;
  const tomb=data._deletedActivities||{};
  let changed=false;
  Object.keys(data._customActivities).forEach(sid=>{
    const list=data._customActivities[sid]||[];
    const groups={}; const kept=[];
    list.forEach(a=>{
      if(!a || !a.id){ changed=true; return; }     // voce corrotta: scartala (e persisti)
      if(tomb[a.id]){ changed=true; return; }       // già eliminata: rimuovila dall'array e persisti
      const label=(data._labels&&data._labels[a.id])?String(data._labels[a.id]).trim():"";
      const nm=(typeof a.name==="string")?a.name.trim():"";
      const display=label||nm;
      // Fantasma se: nessun nome, OPPURE il "nome" è in realtà l'id grezzo
      // (es. "cust_1782021091180" — niente nome reale, va eliminato).
      const looksLikeRawId = !display || display===a.id || /^cust_\d+$/i.test(display);
      if(looksLikeRawId){ tombstoneActivity(a.id); changed=true; return; }
      const k=display.toLowerCase();
      (groups[k]=groups[k]||[]).push(a);
    });
    Object.keys(groups).forEach(k=>{
      const g=groups[k];
      const keeper=(g.length>1?(g.find(a=>effType(a)==='normal')||g[0]):g[0]);
      g.forEach(a=>{
        if(a===keeper){ kept.push(a); return; }
        mergeChecks(a.id, keeper.id);          // non perdere le spunte del doppione
        tombstoneActivity(a.id);
        changed=true;
      });
    });
    data._customActivities[sid]=kept;
  });
  if(changed) data._updatedAt=Date.now();
  return changed;
}

function getCell(key, actId, day){ const w=data[key]; if(!w) return false; const a=w[actId]; return !!(a && a[day]); }
function setCell(key, actId, day, val){
  if(!data[key]) data[key]={};
  if(!data[key][actId]) data[key][actId]=[false,false,false,false,false,false,false];
  data[key][actId][day]=val;
  data._updatedAt = Date.now();
  if(!data._ts) data._ts = {};
  data._ts[`${key}_${actId}_${day}`] = Math.max(Date.now(), (data._ts[`${key}_${actId}_${day}`] || 0) + 1);
  schedulePush();
}

/* Quali indici-giorno sono "attivi" per questa attività in questa settimana */
function activeDays(act, monday){
  if(act.day!==undefined) return [act.day];        // un giorno fisso a settimana
  return [0,1,2,3,4,5,6];                          // freq (flessibile) o normale
}
function actStats(monday, act){
  const key=fmtKey(monday); const days=activeDays(act,monday);
  let done=0; for(const i of days) if(getCell(key,act.id,i)) done++;
  
  const total = act.day !== undefined ? 1 : (act.freq || 7);
  const cappedDone = Math.min(done, total); // non superare il 100% se si fa un extra
  
  return {done: cappedDone, total, ratio: total? cappedDone/total : 0};
}
function sectionStats(monday, section){
  let done=0,total=0;
  for(const a of orderedActivities(section)){ const s=actStats(monday,a); done+=s.done; total+=s.total; }
  return {done,total,ratio: total?done/total:0};
}
function weekRatio(monday){
  let done=0,total=0;
  for(const sec of SECTIONS){ const s=sectionStats(monday,sec); done+=s.done; total+=s.total; }
  return total?done/total:0;
}
/* Totale per un singolo giorno (escludo le attività settimanali e i giorni non-applicabili) */
function dayStats(monday, i){
  const key=fmtKey(monday); const date=weekDates(monday)[i];
  let done=0,total=0;
  const hidden = data._hiddenActivities || {};
  const deleted = data._deletedActivities || {};
  for(const sec of SECTIONS) for(const a of allActivities(sec)){
    if(hiddenVal(hidden[a.id]) || deleted[a.id]) continue;
    const ra=resolveActType(a);
    if(ra.day!==undefined && ra.day!==i) continue;
    // Le flessibili (N volte/sett) non hanno un giorno "dovuto": contano nel giorno
    // solo se spuntate quel giorno (l'obiettivo settimanale resta in actStats).
    if(ra.freq && ra.freq < 7 && !getCell(key,a.id,i)) continue;
    total++; if(getCell(key,a.id,i)) done++;
  }
  return {done,total,ratio: total?done/total:0};
}
function pctTxt(p){ return Math.round(p*100)+"%"; }

/* ===================== Header ===================== */
function renderHeader(){
  const sun = addDays(viewMonday,6);
  const sameMonth = viewMonday.getMonth()===sun.getMonth();
  const label = sameMonth
    ? viewMonday.getDate()+" – "+sun.getDate()+" "+MONTHS[sun.getMonth()]
    : viewMonday.getDate()+" "+MONTHS[viewMonday.getMonth()]+" – "+sun.getDate()+" "+MONTHS[sun.getMonth()];
  document.getElementById("weeklabel").innerHTML = label + "<small>"+viewMonday.getFullYear()+"</small>";

  if(view==="week"){
    const r = weekRatio(viewMonday);
    document.getElementById("overall").innerHTML = 'Sett. <b style="color:'+gradColor(r)+'">'+pctTxt(r)+'</b>';
  } else document.getElementById("overall").innerHTML = "";

  const isThisWeek = fmtKey(viewMonday)===fmtKey(getMonday(new Date()));
  document.getElementById("todayBtn").classList.toggle("hidden", isThisWeek);
  document.getElementById("navbar").classList.toggle("hidden", view!=="week");

  // Limita navigazione indietro
  const canPrev = fmtKey(viewMonday) > MIN_WEEK;
  const prevBtn = document.getElementById("prev");
  if(prevBtn){
    prevBtn.disabled = !canPrev;
    prevBtn.style.opacity = canPrev ? "1" : "0.3";
    prevBtn.style.cursor = canPrev ? "pointer" : "default";
  }

  paintSync();
}

/* ===================== Vista Oggi ===================== */
const WEEKDAYS_LONG = ["lunedì","martedì","mercoledì","giovedì","venerdì","sabato","domenica"];
const MONTHS_LONG = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
function todayIndex(d){ return (d.getDay()+6)%7; }   // 0=Lun .. 6=Dom
function appliesToday(act, ti, dateNum, monday){
  if(act.day!==undefined){
    if(ti < act.day) return false;                     // non è ancora il suo giorno
    if(ti === act.day) return true;                    // oggi è il suo giorno
    return !getCell(fmtKey(monday), act.id, act.day);  // giorni dopo: resta visibile solo se arretrata
  }
  const freq = act.freq || 7;
  if(freq === 7) return true;
  
  // Calcola quante volte è stata spuntata in questa settimana
  const key = fmtKey(monday);
  let doneCount = 0;
  for(let i=0; i<7; i++){
    if(getCell(key, act.id, i)) doneCount++;
  }
  
  // Se l'obiettivo settimanale è già stato raggiunto, nascondila
  // TRANNE SE l'abbiamo spuntata proprio oggi (in tal caso deve restare visibile come "fatta")
  if(doneCount >= freq){
    return getCell(key, act.id, ti);
  }
  
  return true; 
}
/* ===================== Serie (streak), feedback e onboarding ===================== */
const STREAK_GOAL = 0.6;   // un giorno conta per la serie se completi ≥ 60% delle attività in programma
function currentStreak(){
  let count=0, isToday=true, d=new Date(); d.setHours(0,0,0,0);
  while(fmtKey(d) >= MIN_WEEK){
    const ds = dayStats(getMonday(d), todayIndex(d));
    if(ds.total === 0){ d=addDays(d,-1); isToday=false; continue; }   // niente in programma: giorno neutro
    if(ds.ratio >= STREAK_GOAL) count++;
    else if(!isToday) break;                                          // oggi è ancora in corso: non rompe la serie
    d=addDays(d,-1); isToday=false;
  }
  return count;
}
function recentActiveDays(maxDays){
  // giorni recenti (escluso oggi) in cui hai completato almeno un'attività
  const out=[]; let d=addDays(new Date(),-1); d.setHours(0,0,0,0);
  while(fmtKey(d) >= MIN_WEEK && out.length<maxDays){
    if(dayStats(getMonday(d), todayIndex(d)).done>0) out.push(new Date(d));
    d=addDays(d,-1);
  }
  return out;
}
function todayCounts(targetDate = todayViewDate){
  const now=targetDate, key=fmtKey(getMonday(now)), ti=todayIndex(now), dateNum=now.getDate();
  let done=0,total=0;
  SECTIONS.forEach(s=> orderedActivities(s).forEach(a=>{
    if(!appliesToday(a,ti,dateNum, getMonday(now))) return;
    const dayIdx = a.day!==undefined?a.day:ti;
    const on = getCell(key, a.id, dayIdx);
    if(on) done++;
    total++;
  }));
  return {done,total};
}
function haptic(p){ try{ if(navigator.vibrate) navigator.vibrate(p); }catch(e){} }
/* Toast con pulsante "Annulla" per undo veloce */
let _undoTimer = null;
function showUndoToast(msg, undoFn){
  clearTimeout(_undoTimer);
  document.querySelectorAll('.toast').forEach(t=>t.remove());
  const t=document.createElement("div"); t.className="toast";
  t.innerHTML=msg;
  if(undoFn){
    const btn=document.createElement("button"); btn.className="undo-btn"; btn.textContent="Annulla";
    btn.onclick=function(e){ e.stopPropagation(); undoFn(); t.classList.remove("show"); setTimeout(()=>t.remove(),300); };
    t.appendChild(btn);
    t.style.pointerEvents="auto";
  }
  document.body.appendChild(t);
  requestAnimationFrame(()=>t.classList.add("show"));
  _undoTimer = setTimeout(()=>{ t.classList.remove("show"); setTimeout(()=>t.remove(),300); }, 3200);
}
function celebrate(msg){
  const t=document.createElement("div"); t.className="toast"; t.textContent=msg;
  document.body.appendChild(t);
  requestAnimationFrame(()=>t.classList.add("show"));
  setTimeout(()=>{ t.classList.remove("show"); setTimeout(()=>t.remove(),300); }, 1900);
  const emo=["🎉","✨","🎊","⭐","💪","🟢"];
  const layer=document.createElement("div"); layer.className="confetti-layer";
  for(let i=0;i<20;i++){
    const sp=document.createElement("span");
    sp.textContent=emo[i%emo.length];
    sp.style.left=(Math.random()*100)+"%";
    sp.style.animationDelay=(Math.random()*0.35)+"s";
    sp.style.fontSize=(14+Math.random()*16)+"px";
    layer.appendChild(sp);
  }
  document.body.appendChild(layer);
  setTimeout(()=>layer.remove(), 2400);
}

function renderToday(){
  const now = todayViewDate; // Usa la data selezionata (di default è oggi)
  const isActualToday = now.toDateString() === new Date().toDateString();
  const monday = getMonday(now);
  const key = fmtKey(monday);
  const ti = todayIndex(now);
  const dateNum = now.getDate();
  const firstTime = !hasRealData(data);

  let totDone=0, totTot=0, totVisible=0, body="";
  const todayActs = [];

  SECTIONS.forEach(s=>{
    const acts = orderedActivities(s);
    totVisible += acts.length;
    const todays = acts.filter(a=>appliesToday(a, ti, dateNum, monday));
    if(todays.length===0) return;

    let secDone=0, rows="";
    // Le attività fatte scivolano in fondo alla sezione (l'ordine interno resta stabile)
    const isOn = a => getCell(key, a.id, a.day!==undefined ? a.day : ti);
    const orderedToday = todays.filter(a=>!isOn(a)).concat(todays.filter(isOn));
    orderedToday.forEach(a=>{
      const dayIdx = a.day!==undefined ? a.day : ti;
      const on = getCell(key, a.id, dayIdx);
      if(on) secDone++;
      todayActs.push({a, sec:s, dayIdx, on});
      let tag = '';
      if(a.freq && a.freq < 7) tag = '<span class="tag">'+a.freq+'×/sett</span>';
      else if(a.day!==undefined) tag = '<span class="tag">'+["Lun","Mar","Mer","Gio","Ven","Sab","Dom"][a.day]+'</span>';
      const lbl = esc(actLabel(a.id));
      rows += '<div class="todayrow'+(on?' done':'')+'" role="checkbox" aria-checked="'+(on?'true':'false')+'" '+
              'aria-label="'+lbl+'" data-act="'+a.id+'" data-day="'+dayIdx+'">'+
              '<span class="trlabel"><a class="trlabelname" href="'+exHref(a.id, s.id)+'" title="Esercizi · '+lbl+'">'+lbl+'</a>'+tag+'</span>'+
              '<span class="trcheck">✓</span></div>';
    });
    const secTot = todays.length, ratio = secTot? secDone/secTot : 0;
    totDone += secDone; totTot += secTot;
    const sl = sectionLabel(s);
    const folded = !!todayFold[s.id];
    body += '<section class="tsec'+(folded?' folded':'')+'">'+
            '<div class="tsec-head" data-fold="'+s.id+'" role="button" aria-expanded="'+(folded?'false':'true')+'"><div class="tsh-row">'+
              '<span class="tsec-emoji">'+sl.emoji+'</span>'+
              '<span class="tsec-name">'+esc(sl.name)+'</span>'+
              '<span class="tsec-count">'+secDone+' / '+secTot+'</span>'+
              '<span class="tsec-chev">'+(folded?'▸':'▾')+'</span></div>'+
              '<div class="tsec-bar"><i style="width:'+(ratio*100)+'%;background:'+gradColor(ratio)+'"></i></div>'+
            '</div>'+ (folded?'':rows) +'</section>';
  });

  const ratio = totTot? totDone/totTot : 0;
  const dateStr = WEEKDAYS_LONG[ti]+" "+dateNum+" "+MONTHS_LONG[now.getMonth()];

  // Serie / streak
  const streak = currentStreak();
  let streakChip='';
  if(streak>0) streakChip = '<div class="th-streak">🔥 '+streak+' giorn'+(streak===1?'o':'i')+' di fila</div>';
  else if(!firstTime) streakChip = '<div class="th-streak th-streak-0">🔥 Riparti oggi</div>';

  const hero = '<div class="todayhero"><div class="th-top">'+
      '<div><div class="th-title">'+(isActualToday?'Oggi':'Giorno')+'</div><div class="th-date">'+dateStr+'</div>'+streakChip+'</div>'+
      '<div><div class="th-pct" style="color:'+gradColor(ratio)+'">'+pctTxt(ratio)+'</div>'+
      '<div class="th-frac">'+totDone+' / '+totTot+' fatte</div></div></div>'+
      '<div class="th-bar"><i style="width:'+(ratio*100)+'%;background:'+gradColor(ratio)+'"></i></div></div>';

  // Benvenuto al primo avvio
  let welcome='';
  if(firstTime){
    welcome = '<div class="welcome-card"><div class="wc-emoji">👋</div>'+
      '<div><b>Benvenuto in ATTIVITA!</b><br>'+
      'Tocca un’attività per segnarla come fatta. Percentuali, serie e grafici si costruiscono da soli mentre vai avanti.</div></div>';
  }

  if(totTot===0){
    document.getElementById("todayView").innerHTML = welcome + hero +
      '<div class="today-empty">🌙 Niente in programma oggi.<br>Goditi la pausa, oppure aggiungi attività da ⚙️.</div>';
    return;
  }

  // 💡 Recupera oggi: attività di oggi non ancora fatte e trascurate negli ultimi giorni attivi
  let focus='';
  if(!firstTime){
    const activeDays = recentActiveDays(28);
    if(activeDays.length >= 3){
      const cand = todayActs.filter(x=>!x.on && (!x.a.freq || x.a.freq === 7)).map(x=>{
        let d=0,t=0;
        activeDays.forEach(date=>{
          const ti2=todayIndex(date), dn=date.getDate();
          if(x.a.day!==undefined && x.a.day!==ti2) return;
          t++; if(getCell(fmtKey(getMonday(date)), x.a.id, ti2)) d++;
        });
        return Object.assign({}, x, {ratio: t?d/t:0, t});
      }).filter(x=>x.t>=3 && x.ratio<0.5);
      cand.sort((p,q)=>p.ratio-q.ratio);
      const top=cand.slice(0,3);
      if(top.length){
        focus='<div class="th-focus"><div class="thf-title">💡 Recupera oggi</div><div class="thf-chips">';
        top.forEach(x=>{
          const lbl=esc(actLabel(x.a.id)), col=gradColor(x.ratio);
          focus+='<button class="focuschip" data-act="'+x.a.id+'" data-day="'+x.dayIdx+'">'+
                 sectionLabel(x.sec).emoji+' '+lbl+
                 ' <span class="thf-pct" style="color:'+col+'">'+pctTxt(x.ratio)+'</span></button>';
        });
        focus+='</div></div>';
      }
    }
  }

  let note;
  if(totDone===totTot){
    note = '<div class="today-note">Tutto fatto per oggi 🎉</div>';
  } else {
    const hidden = Math.max(0, totVisible - totTot);
    if(hidden>0){
      // Conta quante delle attività nascoste oggi sono a frequenza flessibile (obiettivo raggiunto)
      const freqHidden = SECTIONS.reduce((cnt, s) => {
        return cnt + orderedActivities(s).filter(a => a.freq && a.freq < 7 && !appliesToday(a, ti, dateNum, monday)).length;
      }, 0);
      const parts = [];
      if(freqHidden>0) parts.push(freqHidden+' con obiettivo sett. raggiunto');
      const otherHidden = hidden - freqHidden;
      if(otherHidden>0) parts.push(otherHidden+' con giorno fisso');
      note = '<div class="today-note">'+hidden+' attività non in programma oggi'+(parts.length ? ' ('+parts.join(', ')+')' : '')+'.</div>';
    } else {
      note = '';
    }
  }
  document.getElementById("todayView").innerHTML = welcome + hero + focus + body + note;
}

/* ===================== Vista settimana ===================== */
function renderWeek(){
  const key = fmtKey(viewMonday);
  const todayKey = fmtKey(new Date());
  const dates = weekDates(viewMonday).map(d=>({d, today: fmtKey(d)===todayKey}));

  let html = "";
  SECTIONS.forEach(s=>{
    const st = sectionStats(viewMonday, s);
    const col = gradColor(st.ratio);
    const sl = sectionLabel(s);
    html += '<section class="section">';
    html += '<div class="sec-head"><span class="sec-emoji">'+sl.emoji+'</span>'+
            '<span class="sec-name">'+esc(sl.name)+'</span>'+
            '<span class="sec-pct" style="color:'+col+'">'+pctTxt(st.ratio)+'</span></div>';
    html += '<div class="bar"><i style="width:'+(st.ratio*100)+'%;background:'+col+'"></i></div>';
    html += '<table><thead><tr><th class="lbl">Attività</th>';
    dates.forEach((dd,i)=>{ html += '<th class="'+(dd.today?'todaycol':'')+'">'+DAYS_SHORT[i]+'<span class="dnum">'+dd.d.getDate()+'</span></th>'; });
    html += '<th>%</th></tr></thead><tbody>';

    orderedActivities(s).forEach(a=>{
      const rs = actStats(viewMonday, a);
      let tag = (a.freq && a.freq < 7) ? '<span class="tag">'+a.freq+'×/sett</span>'
              : (a.day!==undefined ? '<span class="tag">1×/sett · '+["Lun","Mar","Mer","Gio","Ven","Sab","Dom"][a.day]+'</span>' : '');
      html += '<tr><td class="lbl"><a class="exlink" href="'+exHref(a.id, s.id)+'" title="Esercizi · '+esc(actLabel(a.id))+'">'+esc(actLabel(a.id))+tag+'</a></td>';

      const actSet = activeDays(a, viewMonday);
      const DAYS_LONG = ["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
      for(let i=0;i<7;i++){
        if(actSet.indexOf(i)<0){ html += '<td class="'+(dates[i].today?'todaycol':'')+'"><span class="celldis" aria-hidden="true">·</span></td>'; continue; }
        const on = getCell(key,a.id,i);
        const cellLbl = esc(actLabel(a.id))+', '+DAYS_LONG[i]+' '+dates[i].d.getDate();
        html += '<td class="'+(dates[i].today?'todaycol':'')+'"><button class="cell'+(on?' on':'')+'" '+
                'role="checkbox" aria-checked="'+(on?'true':'false')+'" aria-label="'+cellLbl+'" '+
                'data-act="'+a.id+'" data-day="'+i+'">✓</button></td>';
      }
      html += '<td class="rowpct" style="color:'+gradColor(rs.ratio)+'">'+pctTxt(rs.ratio)+'</td></tr>';
    });
    html += '</tbody></table></section>';
  });
  document.getElementById("weekView").innerHTML = html;

  let dc = '<div class="daycard"><h3>Totale giornaliero</h3><div class="daygrid">';
  for(let i=0;i<7;i++){
    const ds = dayStats(viewMonday,i);
    dc += '<div class="d'+(dates[i].today?' is-today':'')+'"><div class="lab">'+DAYS_SHORT[i]+'</div>'+
          '<div class="ring" style="color:'+gradColor(ds.ratio)+'">'+pctTxt(ds.ratio)+'</div></div>';
  }
  dc += '</div></div>';
  document.getElementById("weekView").insertAdjacentHTML("afterbegin", dc);
}

/* ===================== Storico ===================== */
let historyOffset = 0;  // 0 = settimane recenti; -1 = 1 settimana indietro, ecc.
function lastMondaysOffset(n, offset){
  // offset = 0: finestra che termina questa settimana; offset = -1: termina 1 sett. fa
  const base = addDays(getMonday(new Date()), (offset)*7);
  const arr = [];
  for(let i=n-1;i>=0;i--) arr.push(addDays(base,-7*i));
  return arr;
}

function renderHistory(){
  const isAtNow = historyOffset === 0;
  const weeks6 = lastMondaysOffset(6, historyOffset).filter(m => fmtKey(m) >= MIN_WEEK);
  
  if (weeks6.length === 0) {
    document.getElementById("historyView").innerHTML = '<div class="hcard"><div class="empty">📊 Ancora nessuno storico.<br>Spunta le attività di oggi: i grafici si costruiscono da soli.</div></div>';
    return;
  }

  const lastW  = weeks6[weeks6.length-1];
  const firstW = weeks6[0];
  const rangeLabel = firstW.getDate()+'/'+(firstW.getMonth()+1)+' – '+lastW.getDate()+'/'+(lastW.getMonth()+1);

  // Barra di navigazione storico
  const canPrevHist = fmtKey(firstW) > MIN_WEEK;
  let nav = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
  nav += '<button class="arrow" id="histPrev" '+(canPrevHist?'':'disabled style="opacity:.3;cursor:default;"')+' aria-label="Settimane precedenti" style="flex:0 0 auto">‹</button>';
  nav += '<div style="flex:1;text-align:center;font-weight:700;font-size:14px;">'+rangeLabel+'<br><small style="font-weight:500;color:var(--muted);font-size:11px;">'+firstW.getFullYear()+'</small></div>';
  nav += '<button class="arrow" id="histNext" aria-label="Settimane successive" '+(isAtNow?'disabled style="opacity:.3;cursor:default;"':'')+' style="flex:0 0 auto">›</button>';
  if(!isAtNow) nav += '<button class="today-btn" id="histToday" style="font-size:11px;height:36px;padding:0 10px;">Oggi</button>';
  nav += '</div>';

  let chart = '<div class="hcard"><h3>📊 Ultime 6 settimane</h3>'+nav+'<div class="chart">';
  weeks6.forEach(m=>{
    const p=weekRatio(m), h=Math.max(3,Math.round(p*100));
    chart += '<div class="col"><div class="colbar" style="height:'+h+'%;background:'+gradColor(p)+'"><span class="colpct">'+Math.round(p*100)+'</span></div><div class="collabel">'+m.getDate()+'/'+(m.getMonth()+1)+'</div></div>';
  });
  chart += '</div></div>';

  const weeks8 = lastMondaysOffset(8, historyOffset).filter(m => fmtKey(m) >= MIN_WEEK);
  const hasAny = hasRealData(data);
  let heat = '<div class="hcard"><h3>🗓️ Heatmap (completamento settimanale)</h3>';
  if(!hasAny || weeks8.length === 0){
    heat += '<div class="empty">Ancora nessun dato.<br>Inizia a segnare le attività nella vista “Settimana”.</div>';
  } else {
    heat += '<div class="hm-wrap"><table class="hm"><thead><tr><th class="lbl"></th>';
    weeks8.forEach(m=>{ heat += '<th>'+m.getDate()+'/'+(m.getMonth()+1)+'</th>'; });
    heat += '</tr></thead><tbody>';
    SECTIONS.forEach(s=>{
      const sl2 = sectionLabel(s);
      heat += '<tr class="sub"><td class="lbl">'+sl2.emoji+' '+esc(sl2.name)+'</td><td colspan="'+weeks8.length+'"></td></tr>';
      orderedActivities(s).forEach(a=>{
        heat += '<tr><td class="lbl">'+esc(actLabel(a.id))+'</td>';
        weeks8.forEach(m=>{ const st=actStats(m,a); const bg = st.done<=0 ? "var(--line)" : gradColor(st.ratio);
          heat += '<td><div class="swatch" style="background:'+bg+'">'+(st.done>0?st.done:"")+'</div></td>'; });
        heat += '</tr>';
      });
    });
    heat += '</tbody></table></div></div>';
  }

  let worst = '<div class="hcard"><h3>🎯 Focus (Ultime '+weeks8.length+' settiman'+(weeks8.length===1?'a':'e')+')</h3><p class="sub" style="margin-top:-8px;margin-bottom:8px">Le tue attività ordinate per percentuale di completamento, dalla meno eseguita alla più costante.</p>';
  if(!hasAny || weeks8.length === 0){
    worst += '<div class="empty">Ancora nessun dato.</div></div>';
  } else {
    const allActsStats = [];
    SECTIONS.forEach(s => {
      orderedActivities(s).forEach(a => {
        let done = 0, total = 0;
        weeks8.forEach(m => {
          const st = actStats(m, a);
          done += st.done; total += st.total;
        });
        if(total > 0) {
          allActsStats.push({ id: a.id, name: actLabel(a.id), secEmoji: sectionLabel(s).emoji, ratio: done/total, done, total });
        }
      });
    });
    allActsStats.sort((x, y) => x.ratio - y.ratio);
    
    worst += '<div class="act-grid">';
    allActsStats.forEach(st => {
      const col = gradColor(st.ratio);
      const pct = Math.round(st.ratio * 100);
      worst += '<div class="act-card">'+
               '<div class="act-card-pie" style="background:conic-gradient('+col+' '+pct+'%, var(--line) 0);">'+
                 '<div class="act-card-pie-inner" style="color:'+col+'">'+pct+'%</div>'+
               '</div>'+
               '<div class="act-card-name">'+st.secEmoji+' '+esc(st.name)+'</div>'+
               '<div class="act-card-frac">'+st.done+' / '+st.total+'</div>'+
               '</div>';
    });
    worst += '</div></div>';
  }

  /* ===== Donut: dove serve più attenzione (ripartizione per area) ===== */
  let donut = '<div class="hcard"><h3>🧭 Dove serve più attenzione</h3>';
  if(!hasAny || weeks8.length === 0){
    donut += '<div class="empty">📊 Spunta qualche attività e qui vedrai dove concentrarti.</div>';
  } else {
    const secStats = SECTIONS.map(s=>{
      let done=0,total=0;
      orderedActivities(s).forEach(a=>{ weeks8.forEach(m=>{ const st=actStats(m,a); done+=st.done; total+=st.total; }); });
      const sl=sectionLabel(s);
      return { name:sl.name, emoji:sl.emoji, done, total,
               ratio: total?done/total:0, deficit: total?(1-done/total):0, color:SECTION_HEX[s.id]||"#64748b" };
    }).filter(x=>x.total>0);
    const totalDeficit = secStats.reduce((a,b)=>a+b.deficit,0);
    const oDone = secStats.reduce((a,b)=>a+b.done,0);
    const oTot  = secStats.reduce((a,b)=>a+b.total,0);
    const oRatio = oTot?oDone/oTot:0;
    if(secStats.length===0){
      donut += '<div class="empty">📊 Spunta qualche attività e qui vedrai dove concentrarti.</div>';
    } else if(totalDeficit <= 0.0001){
      donut += '<div class="donut-done"><span class="dd-emoji">🎉</span><div>Tutto completato!<br><small>Nessuna area richiede attenzione in questo periodo.</small></div></div>';
    } else {
      const ordered = secStats.slice().sort((a,b)=>b.deficit-a.deficit);
      let acc=0; const stops=[];
      ordered.forEach(s=>{ const share=s.deficit/totalDeficit;
        stops.push(s.color+' '+(acc*100).toFixed(2)+'% '+((acc+share)*100).toFixed(2)+'%'); acc+=share; });
      donut += '<p class="sub">Più grande è la fetta, più quell’area è rimasta indietro. Al centro, il completamento medio del periodo.</p>';
      donut += '<div class="donut-wrap"><div class="donut" style="background:conic-gradient('+stops.join(',')+');">'+
               '<div class="donut-hole"><b style="color:'+gradColor(oRatio)+'">'+pctTxt(oRatio)+'</b><span>medio</span></div></div>';
      donut += '<div class="donut-legend">';
      ordered.forEach(s=>{
        donut += '<div class="dleg-row"><span class="dleg-dot" style="background:'+s.color+'"></span>'+
                 '<span class="dleg-name">'+s.emoji+' '+esc(s.name)+'</span>'+
                 '<span class="dleg-pct" style="color:'+gradColor(s.ratio)+'">'+pctTxt(s.ratio)+'</span></div>';
      });
      donut += '</div></div>';
    }
  }
  donut += '</div>';

  document.getElementById("historyView").innerHTML = donut + chart + heat + worst;

  // Event listener frecce storico
  const prevBtnHist = document.getElementById("histPrev");
  if(prevBtnHist) {
    prevBtnHist.onclick = function(){
      if(canPrevHist){
        historyOffset--;
        renderHistory();
      }
    };
  }
  const nextBtn = document.getElementById("histNext");
  if(nextBtn) {
    nextBtn.onclick = function(){
      if(historyOffset<0){
        historyOffset++;
        renderHistory();
      }
    };
  }
  const todayBtn2 = document.getElementById("histToday");
  if(todayBtn2) {
    todayBtn2.onclick = function(){
      historyOffset=0;
      renderHistory();
    };
  }
}

/* ===================== Impostazioni ===================== */
let settingsOpenSections = new Set();
function toggleAccSection(key){
  if(settingsOpenSections.has(key)) settingsOpenSections.delete(key);
  else settingsOpenSections.add(key);
  const el = document.querySelector('.acc-item[data-acckey="'+key+'"]');
  if(el) el.classList.toggle('open');
}
function renderSettings(){
  let h = "";
  h += '<div class="accordion">';

  // Sezione 1: Sincronizzazione
  h += '<div class="acc-item'+(settingsOpenSections.has('sync')?' open':'')+'" data-acckey="sync"><button class="acc-header" onclick="toggleAccSection(\'sync\')">☁️ Sincronizzazione Cloud</button><div class="acc-content">';
  if(!pantryId){
    h += '<p class="sub" style="margin-top:12px">Per condividere gli stessi dati tra Mac e iPhone, crea un codice gratuito (serve solo un\'email):</p>';
    h += '<ol class="ol">'+
         '<li>Apri <a class="link" href="https://getpantry.cloud" target="_blank" rel="noopener">getpantry.cloud</a></li>'+
         '<li>Inserisci la tua email e premi <b>Get a Pantry</b></li>'+
         '<li>Copia il <b>Pantry ID</b> e incollalo qui sotto</li>'+
         '<li>Ripeti l\'incolla dello <b>stesso codice</b> su ogni dispositivo</li></ol>';
  } else {
    h += '<p class="sub" style="margin-top:12px">Sincronizzazione attiva. Usa lo <b>stesso codice</b> su tutti i dispositivi.</p>';
  }
  h += '<div class="field"><label>Pantry ID</label><input type="text" id="pantryInput" placeholder="incolla qui il codice…" value="'+esc(pantryId)+'" autocapitalize="off" autocorrect="off" spellcheck="false"></div>';
  h += '<div class="row-btns"><button class="btn primary" id="saveSync">Salva e verifica</button>';
  if(pantryId) h += '<button class="btn ghost" id="discSync">Disconnetti</button>';
  h += '</div><div id="syncMsg"></div></div></div>'; // end acc-content, acc-item

  // Sezione 2: Gestisci attività
  h += '<div class="acc-item'+(settingsOpenSections.has('activities')?' open':'')+'" data-acckey="activities"><button class="acc-header" onclick="toggleAccSection(\'activities\')">🏷️ Gestisci Sezioni e Attività</button><div class="acc-content">';
  h += '<p class="sub" style="margin-top:12px">Rinomina sezioni ed emoji, riordina con ▲▼. Tocca ✏️ per cambiare il tipo di attività (giorni dispari, giorno fisso…) o nasconderla.</p>';
  SECTIONS.forEach(s=>{
    const sl = sectionLabel(s);
    const allActs = orderedActivities(s, true); // include hidden
    const hidden = data._hiddenActivities || {};
    const customs = (data._customActivities && data._customActivities[s.id]) || [];
    const customIds = new Set(customs.map(a=>a.id));
    h += '<div class="rename-sec-wrap" data-secid="'+s.id+'">';
    // Header sezione editabile
    h += '<div class="rename-sec-header">';
    h += '<input type="text" class="sec-emoji-inp" data-semoji="'+s.id+'" value="'+esc(sl.emoji)+'" maxlength="4" placeholder="📝" style="width:42px;text-align:center;font-size:18px;">';
    h += '<input type="text" class="sec-name-inp" data-sname="'+s.id+'" value="'+esc(sl.name)+'" placeholder="'+esc(s.name)+'" style="flex:1;">';
    h += '</div>';
    // Lista attività
    h += '<div class="rename-list">';
    allActs.forEach((a,idx)=>{
      const isHidden = hiddenVal(hidden[a.id]);
      const isCustom = customIds.has(a.id);
      const curType = a.freq && a.freq < 7 ? 'freq' : (a.day!==undefined?'day':'normal');
      const curFreq = a.freq && a.freq < 7 ? a.freq : 3;
      const curDay  = a.day!==undefined?a.day:0;
      const dayNames=['Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato','Domenica'];
      h += '<div class="rename-wrap">';
      h += '<div class="rename-row'+(isHidden?' hidden-act':'')+'">'+
           '<input type="text" data-rid="'+a.id+'" value="'+esc(actLabel(a.id))+'" placeholder="'+esc(DEFAULT_LABEL[a.id]||a.name)+'"'+(isHidden?' style="opacity:.4;"':'')+'>'+
           '<button class="movebtn" data-msec="'+s.id+'" data-mact="'+a.id+'" data-mdir="-1"'+((idx>0)?'':' disabled')+'>▲</button>'+
           '<button class="movebtn" data-msec="'+s.id+'" data-mact="'+a.id+'" data-mdir="1"'+((idx<allActs.length-1)?'':' disabled')+'>▼</button>';
      h += '<button class="movebtn" data-editact="'+a.id+'" title="Modifica tipo / visibilità" style="color:#2563eb;">✏️</button>';
      if(isCustom){
        h += '<button class="movebtn" data-delact="'+a.id+'" data-delsec="'+s.id+'" title="Elimina attività" style="color:#ef4444;">🗑</button>';
      } else {
        h += '<button class="movebtn" data-delbuiltin="'+a.id+'" title="Elimina attività" style="color:#ef4444;">🗑</button>';
      }
      h += '</div>';
      h += '<div class="act-type-row hidden" data-typerow="'+a.id+'">'+
           '<span class="act-type-label">Tipo:</span>'+
           '<select class="act-type-select" data-typact="'+a.id+'">'+
           '<option value="normal"'+(curType==='normal'?' selected':'')+'>Tutti i giorni</option>'+
           '<option value="freq"'+(curType==='freq'?' selected':'')+'>Flessibile (N volte/sett)</option>'+
           '<option value="day"'+(curType==='day'?' selected':'')+'>Giorno fisso</option>'+
           '</select>'+
           '<select class="act-freq-select'+(curType!=='freq'?' hidden':'')+'" data-typfreq="'+a.id+'">'+
           [1,2,3,4,5,6].map(n=>'<option value="'+n+'"'+(curFreq===n?' selected':'')+'>'+(n===1?'1 volta':n+' volte')+'/settimana</option>').join('')+
           '</select>'+
           '<select class="act-day-select'+(curType!=='day'?' hidden':'')+'" data-typday="'+a.id+'">'+
           dayNames.map((d,i)=>'<option value="'+i+'"'+(curDay===i?' selected':'')+'>'+d+'</option>').join('')+
           '</select>'+
           '<button class="movebtn" data-hideact="'+a.id+'" title="'+(isHidden?'Mostra':'Nascondi')+'" style="'+(isHidden?'color:#22c55e':'color:#f59e0b')+'">'+(isHidden?'👁':'🙅')+'</button>'+
           '</div>';
      h += '</div>';
    });
    h += '</div>';
    // Form aggiungi attività
    h += '<div class="add-act-wrap" id="addWrap_'+s.id+'">';
    h += '<button class="btn ghost" data-addact="'+s.id+'" style="width:100%;margin-top:6px;font-size:12px;">️ Aggiungi attività</button>';
    h += '<div class="add-act-form hidden" id="addForm_'+s.id+'">';
    h += '<input type="text" id="addName_'+s.id+'" placeholder="Nome attività…" style="margin-bottom:6px;">';
    h += '<select id="addType_'+s.id+'" style="width:100%;height:38px;border:1px solid var(--line);border-radius:9px;padding:0 10px;font-size:14px;background:var(--card);color:var(--ink);margin-bottom:6px;">'+
         '<option value="normal">Tutti i giorni</option>'+
         '<option value="freq">Flessibile (N volte/sett)</option>'+
         '<option value="day">Giorno fisso della settimana</option>'+
         '</select>';
    h += '<select id="addFreq_'+s.id+'" class="hidden" style="width:100%;height:38px;border:1px solid var(--line);border-radius:9px;padding:0 10px;font-size:14px;background:var(--card);color:var(--ink);margin-bottom:6px;">'+
         [1,2,3,4,5,6].map(n=>'<option value="'+n+'"'+(n===3?' selected':'')+'>'+(n===1?'1 volta':n+' volte')+'/settimana</option>').join('')+
         '</select>';
    h += '<select id="addDay_'+s.id+'" class="hidden" style="width:100%;height:38px;border:1px solid var(--line);border-radius:9px;padding:0 10px;font-size:14px;background:var(--card);color:var(--ink);margin-bottom:6px;">'+
         '<option value="0">Lunedì</option><option value="1">Martedì</option><option value="2">Mercoledì</option>'+
         '<option value="3">Giovedì</option><option value="4">Venerdì</option><option value="5">Sabato</option><option value="6">Domenica</option>'+
         '</select>';
    h += '<div class="row-btns"><button class="btn primary" data-addconfirm="'+s.id+'">Aggiungi</button><button class="btn ghost" data-addcancel="'+s.id+'">Annulla</button></div>';
    h += '</div></div>';
    h += '</div>'; // fine rename-sec-wrap
  });
  h += '<div class="row-btns" style="margin-top:12px"><button class="btn ghost" id="resetNames">Ripristina predefiniti</button></div><div id="nameMsg"></div></div></div>'; // end acc-content, acc-item

  // Sezione 3: Backup
  h += '<div class="acc-item'+(settingsOpenSections.has('backup')?' open':'')+'" data-acckey="backup"><button class="acc-header" onclick="toggleAccSection(\'backup\')">💾 Backup Dati</button><div class="acc-content">';
  h += '<p class="sub" style="margin-top:12px">Scarica una copia o ripristina i dati da un file.</p>'+
       '<div class="row-btns"><button class="btn ghost" id="exportBtn">⬆️ Esporta</button>'+
       '<button class="btn ghost" id="importBtn">⬇️ Importa</button></div>'+
       '<div class="row-btns" style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--line);">'+
       '<button class="btn ghost" id="resetHistoryBtn" style="color:#ef4444;border-color:rgba(239,68,68,0.35);width:100%;">🧹 Riparti da oggi (azzera vecchio storico)</button></div>'+
       '</div></div>'; // end acc-content, acc-item

  h += '</div>'; // chiusura .accordion

  document.getElementById("settingsView").innerHTML = h;
  document.getElementById("saveSync").onclick = onSaveSync;
  if(pantryId) document.getElementById("discSync").onclick = onDiscSync;
  document.getElementById("resetNames").onclick = onResetNames;
  document.getElementById("resetHistoryBtn").onclick = onResetHistoryFromToday;
  // Auto-save nomi con debounce: ogni modifica salva automaticamente dopo 800ms
  let _nameTimer = null;
  function autoSaveNames(){
    clearTimeout(_nameTimer);
    _nameTimer = setTimeout(function(){ collectNames(); data._updatedAt=Date.now(); schedulePush(); msg("nameMsg","✅ Salvato automaticamente.","ok"); setTimeout(()=>{ const el=document.getElementById("nameMsg"); if(el) el.innerHTML=""; }, 2000); }, 800);
  }
  document.querySelectorAll('#settingsView input[data-rid], #settingsView input[data-sname], #settingsView input[data-semoji]').forEach(inp=>{
    inp.addEventListener('input', autoSaveNames);
  });
  document.getElementById("exportBtn").onclick = exportData;
  document.getElementById("importBtn").onclick = ()=>document.getElementById("importFile").click();
  // Delegazione eventi per la sezione gestisci attività
  // Il cambio tipo attività è gestito dai .onchange espliciti più in basso
  document.querySelectorAll("[data-addact]").forEach(btn=>{
    btn.onclick = function(){
      const sid = this.dataset.addact;
      document.getElementById("addForm_"+sid).classList.remove("hidden");
      this.classList.add("hidden");
    };
  });
  document.querySelectorAll("[data-addcancel]").forEach(btn=>{
    btn.onclick = function(){
      const sid = this.dataset.addcancel;
      document.getElementById("addForm_"+sid).classList.add("hidden");
      document.querySelector("[data-addact='"+sid+"']").classList.remove("hidden");
    };
  });
  document.querySelectorAll("[data-addconfirm]").forEach(btn=>{
    btn.onclick = function(){ addCustomActivity(this.dataset.addconfirm); };
  });
  document.querySelectorAll("[data-delact]").forEach(btn=>{
    btn.onclick = function(){ deleteCustomActivity(this.dataset.delsec, this.dataset.delact); };
  });
  document.querySelectorAll("[data-hideact]").forEach(btn=>{
    btn.onclick = function(){ collectNames(); toggleHideActivity(this.dataset.hideact); };
  });
  document.querySelectorAll("[data-delbuiltin]").forEach(btn=>{
    btn.onclick = function(){ collectNames(); deleteBuiltinActivity(this.dataset.delbuiltin); };
  });
  // Tipo attività (form aggiungi nuova)
  document.getElementById("settingsView").querySelectorAll("[id^='addType_']").forEach(sel=>{
    sel.onchange = function(){
      const sid = this.id.replace("addType_","");
      document.getElementById("addDay_"+sid).classList.toggle("hidden", this.value!=="day");
      document.getElementById("addFreq_"+sid).classList.toggle("hidden", this.value!=="freq");
    };
  });
  // Apri/chiudi barra di modifica per attività esistente
  document.getElementById("settingsView").querySelectorAll("[data-editact]").forEach(btn=>{
    btn.onclick = function(){
      const row = document.querySelector('.act-type-row[data-typerow="'+this.dataset.editact+'"]');
      if(row) row.classList.toggle("hidden");
    };
  });
  // Tipo attività — modifica attività esistente
  document.getElementById("settingsView").querySelectorAll(".act-type-select").forEach(sel=>{
    sel.onchange = function(){
      const actId = this.dataset.typact;
      const type  = this.value;
      const dayEl = document.querySelector('.act-day-select[data-typday="'+actId+'"]');
      const freqEl = document.querySelector('.act-freq-select[data-typfreq="'+actId+'"]');
      if(dayEl) dayEl.classList.toggle("hidden", type!=="day");
      if(freqEl) freqEl.classList.toggle("hidden", type!=="freq");
      setActivityType(actId, type, dayEl ? parseInt(dayEl.value,10) : 0, freqEl ? parseInt(freqEl.value,10) : 3);
    };
  });
  document.getElementById("settingsView").querySelectorAll(".act-freq-select").forEach(sel=>{
    sel.onchange = function(){
      const actId  = this.dataset.typfreq;
      setActivityType(actId, "freq", 0, parseInt(this.value,10));
    };
  });
  document.getElementById("settingsView").querySelectorAll(".act-day-select").forEach(sel=>{
    sel.onchange = function(){
      const actId  = this.dataset.typday;
      setActivityType(actId, "day", parseInt(this.value,10), 0);
    };
  });
}
function msg(id, text, kind){ document.getElementById(id).innerHTML = '<div class="status-msg '+kind+'">'+text+'</div>'; }

async function onSaveSync(){
  const v = document.getElementById("pantryInput").value.trim();
  if(!v){ msg("syncMsg","Incolla prima il codice Pantry.","err"); return; }
  pantryId = v; try{ localStorage.setItem(PANTRY_KEY, v); }catch(e){}
  msg("syncMsg","Verifica in corso…","info"); setSync("saving");
  const remote = await pullRemote();
  if(remote==="ERR"){ msg("syncMsg","❌ Codice non valido o niente connessione. Controlla e riprova.","err"); setSync("error"); return; }
  data = mergeData(data, remote);
  if(!data._labels)           data._labels={};
  if(!data._sectionNames)     data._sectionNames={};
  if(!data._customActivities) data._customActivities={};
  if(!data._hiddenActivities) data._hiddenActivities={};
  if(!data._deletedActivities) data._deletedActivities={};
  saveLocal(); render(); doPush();
  msg("syncMsg","✅ Collegato! Dati uniti e sincronizzati con il cloud.","ok");
  setSync("ok");
}
function onDiscSync(){
  if(!confirm("Disconnettere la sincronizzazione su questo dispositivo? I dati locali restano.")) return;
  pantryId=""; try{ localStorage.removeItem(PANTRY_KEY); }catch(e){}
  setSync("off"); renderSettings();
}
function collectNames(){
  document.querySelectorAll("#settingsView input[data-rid]").forEach(inp=>{
    const id=inp.getAttribute("data-rid"); const val=inp.value.trim();
    const defLabel = DEFAULT_LABEL[id] || (()=>{ for(const s of SECTIONS){ const c=(data._customActivities&&data._customActivities[s.id])||[]; const f=c.find(a=>a.id===id); if(f) return f.name; } return id; })();
    if(val && val!==defLabel) data._labels[id]=val;
    else if(val===defLabel) delete data._labels[id];
    // campo vuoto: non toccare l'etichetta salvata (l'auto-save scatta anche a metà digitazione)
  });
  // Salva nomi e emoji delle sezioni
  document.querySelectorAll("#settingsView input[data-sname]").forEach(inp=>{
    const sid=inp.getAttribute("data-sname"); const val=inp.value.trim();
    const sec=SECTIONS.find(s=>s.id===sid); if(!sec) return;
    if(!data._sectionNames) data._sectionNames={};
    if(!data._sectionNames[sid]) data._sectionNames[sid]={};
    if(val && val!==sec.name) data._sectionNames[sid].name=val; else delete data._sectionNames[sid].name;
  });
  document.querySelectorAll("#settingsView input[data-semoji]").forEach(inp=>{
    const sid=inp.getAttribute("data-semoji"); const val=inp.value.trim();
    const sec=SECTIONS.find(s=>s.id===sid); if(!sec) return;
    if(!data._sectionNames) data._sectionNames={};
    if(!data._sectionNames[sid]) data._sectionNames[sid]={};
    if(val && val!==sec.emoji) data._sectionNames[sid].emoji=val; else delete data._sectionNames[sid].emoji;
  });
}
// onSaveNames non più necessario: i nomi si salvano automaticamente con debounce
function addCustomActivity(sid){
  const nameEl = document.getElementById("addName_"+sid);
  const typeEl = document.getElementById("addType_"+sid);
  const freqEl = document.getElementById("addFreq_"+sid);
  const dayEl  = document.getElementById("addDay_"+sid);
  const name = nameEl ? nameEl.value.trim() : "";
  if(!name){ alert("Inserisci un nome per l'attività."); return; }
  const type = typeEl ? typeEl.value : "normal";
  const actDef = { id: "cust_"+Date.now(), name };
  if(type==="freq") actDef.freq = parseInt(freqEl.value,10);
  else if(type==="day") actDef.day=parseInt(dayEl.value,10);
  if(!data._customActivities) data._customActivities={};
  if(!data._customActivities[sid]) data._customActivities[sid]=[];
  data._customActivities[sid].push(actDef);
  DEFAULT_LABEL[actDef.id]=actDef.name;
  data._updatedAt=Date.now(); schedulePush(); renderSettings();
  msg("nameMsg","✅ Attività \u201c"+name+"\u201d aggiunta.","ok");
}
function deleteCustomActivity(sid, actId){
  if(!confirm('Eliminare questa attività? Le spunte passate restano salvate.')) return;
  if(!data._customActivities||!data._customActivities[sid]) return;
  data._customActivities[sid]=data._customActivities[sid].filter(a=>a.id!==actId);
  if(!data._deletedActivities) data._deletedActivities={};
  data._deletedActivities[actId]=true;        // tombstone: non risorge alla prossima sync
  delete (data._labels||{})[actId];
  if(data._activityTypes) delete data._activityTypes[actId];
  if(data._hiddenActivities) delete data._hiddenActivities[actId];
  data._updatedAt=Date.now(); schedulePush(); renderSettings();
}
function toggleHideActivity(actId){
  if(!data._hiddenActivities) data._hiddenActivities={};
  const v = data._hiddenActivities[actId];
  const wasHidden = hiddenVal(v);
  // Il nuovo ts deve essere strettamente > del ts precedente (|v|), così batte
  // sempre il valore opposto nel merge anche in caso di clock skew tra dispositivi.
  const prevAbsTs = typeof v === 'number' ? Math.abs(v) : (v === true ? 1 : 0);
  const newTs = Math.max(Date.now(), prevAbsTs + 1);
  data._hiddenActivities[actId] = wasHidden ? -newTs : +newTs;
  data._updatedAt=Date.now(); schedulePush(); renderSettings();
}
function deleteBuiltinActivity(actId){
  if(!confirm('Eliminare definitivamente questa attività? Non comparirà più nella lista.\n(Le spunte passate restano salvate nei dati.)')) return;
  if(!data._deletedActivities) data._deletedActivities={};
  data._deletedActivities[actId]=true;
  // togli anche da hidden se era nascosta
  if(data._hiddenActivities) delete data._hiddenActivities[actId];
  data._updatedAt=Date.now(); schedulePush(); renderSettings();
}
function setActivityType(actId, type, day, freq){
  if(!data._activityTypes) data._activityTypes={};
  if(type==='day') data._activityTypes[actId]={type,day:day||0};
  else if(type==='freq') data._activityTypes[actId]={type,freq:freq||3};
  else             data._activityTypes[actId]={type};
  data._updatedAt=Date.now(); schedulePush();
}
function moveActivity(sectionId, actId, dir){
  collectNames();
  const sec = SECTIONS.find(s=>s.id===sectionId); if(!sec) return;
  const full = orderedActivities(sec, true).map(a=>a.id);
  const idx = full.indexOf(actId), j = idx+dir;
  if(idx<0 || j<0 || j>=full.length) return;
  const t=full[idx]; full[idx]=full[j]; full[j]=t;
  data._order = data._order || {}; data._order[sectionId] = full;
  data._updatedAt = Date.now(); schedulePush();
  const scrollY = window.scrollY;
  renderSettings();
  window.scrollTo(0, scrollY);
}
function onResetNames(){
  if(!confirm("Ripristinare tutti i nomi predefiniti? (nomi sezioni, attività built-in; le attività custom restano)")) return;
  data._labels={}; data._sectionNames={}; data._updatedAt=Date.now(); schedulePush(); renderSettings();
  msg("nameMsg","Nomi ripristinati.","info");
}
function onResetHistoryFromToday(){
  if(!confirm("Cancellare tutto lo storico delle settimane passate e azzerare i giorni precedenti a oggi?\n\nLe impostazioni, le tue attività personalizzate e le spunte di oggi verranno mantenute.")) return;
  const now = new Date();
  const curMon = getMonday(now);
  const curMonKey = fmtKey(curMon);
  const curDay = todayIndex(now);

  Object.keys(data).forEach(k => {
    if (!k.startsWith("_") && k < curMonKey) {
      delete data[k];
    }
  });

  if (data._ts) {
    Object.keys(data._ts).forEach(k => {
      const wk = k.slice(0, 10);
      if (wk < curMonKey) delete data._ts[k];
    });
  }

  if (data[curMonKey]) {
    Object.keys(data[curMonKey]).forEach(actId => {
      const arr = data[curMonKey][actId];
      if (Array.isArray(arr)) {
        for (let i = 0; i < 7; i++) {
          if (i !== curDay && arr[i]) {
            arr[i] = false;
            if (data._ts) delete data._ts[`${curMonKey}_${actId}_${i}`];
          }
        }
      }
    });
  }

  data._updatedAt = Date.now();
  saveLocal();
  schedulePush();
  render();
  msg("nameMsg", "✅ Storico passato azzerato. Ripartiti da oggi!", "ok");
  showUndoToast("✅ Ripartiti da oggi!");
}

/* ===================== Esporta / Importa ===================== */
function exportData(){
  const blob = new Blob([JSON.stringify(data,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download="cdf-tracker-backup-"+fmtKey(new Date())+".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.getElementById("importFile").addEventListener("change", function(e){
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=function(ev){
    try{
      const incoming=JSON.parse(ev.target.result);
      if(typeof incoming!=="object"||incoming===null) throw new Error();
      if(!confirm("Unire questo backup con i dati attuali?\nLe spunte di entrambi verranno mantenute (nessun dato recente viene perso).")) return;
      data = mergeData(data, incoming);
      if(!data._labels) data._labels={};
      data._updatedAt = Date.now();
      saveLocal(); schedulePush(); render();
      alert("Backup unito ai dati attuali.");
    }catch(err){ alert("File non valido."); }
  };
  reader.readAsText(file); e.target.value="";
});

function renderLoadingSkeleton(){
  return `
    <div style="padding: 4px;">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>
  `;
}

/* ===================== Render principale ===================== */
function render(){
  renderHeader();
  document.getElementById("todayView").classList.toggle("hidden", view!=="today");
  document.getElementById("weekView").classList.toggle("hidden", view!=="week");
  document.getElementById("historyView").classList.toggle("hidden", view!=="history");
  document.getElementById("settingsView").classList.toggle("hidden", view!=="settings");
  document.getElementById("footHint").innerHTML = (view==="settings") ? "" :
    "I dati sono salvati su questo dispositivo" + (pantryId? " e sincronizzati nel cloud." : ". Attiva la sincronizzazione in ⚙️ per condividerli tra Mac e iPhone.");
  if(initialLoading){
    const activeEl = document.getElementById(view + "View");
    if(activeEl) activeEl.innerHTML = renderLoadingSkeleton();
    return;
  }
  if(view==="today") renderToday();
  else if(view==="week") renderWeek();
  else if(view==="history") renderHistory();
  else renderSettings();
}

/* ===================== Eventi ===================== */
document.getElementById("weekView").addEventListener("click", function(e){
  const btn=e.target.closest(".cell"); if(!btn || !btn.dataset.act) return;
  const key=fmtKey(viewMonday), actId=btn.dataset.act, day=parseInt(btn.dataset.day,10);
  setCell(key, actId, day, !getCell(key,actId,day));
  render();
});
document.getElementById("todayView").addEventListener("click", function(e){
  if(e.target.closest("a")) return;                  // lascia funzionare eventuali link
  const fh=e.target.closest(".tsec-head");
  if(fh && fh.dataset.fold){                         // apri/chiudi la sezione
    todayFold[fh.dataset.fold] = !todayFold[fh.dataset.fold];
    saveFold(); renderToday(); return;
  }
  const row=e.target.closest(".focuschip") || e.target.closest(".todayrow");
  if(!row || !row.dataset.act) return;
  const key=fmtKey(getMonday(todayViewDate)), actId=row.dataset.act, day=parseInt(row.dataset.day,10);
  const was=getCell(key,actId,day);
  const before=todayCounts(todayViewDate);
  setCell(key, actId, day, !was);
  render();
  if(!was){                                          // attività appena completata → feedback
    haptic(12);
    const chk=document.querySelector('.todayrow[data-act="'+CSS.escape(actId)+'"][data-day="'+day+'"] .trcheck');
    if(chk) chk.classList.add("pop");
    // Undo toast: consente di annullare la spunta entro 3 secondi
    showUndoToast('✓ '+esc(actLabel(actId)), function(){
      setCell(key, actId, day, false);
      render();
    });
    const after=todayCounts(todayViewDate);
    if(before.total>0 && before.done<before.total && after.done===after.total){
      haptic([18,40,18]);
      celebrate("Giornata piena! 🎉");
    }
  }
});
document.getElementById("settingsView").addEventListener("click", function(e){
  const b=e.target.closest(".movebtn"); if(!b || b.disabled) return;
  moveActivity(b.dataset.msec, b.dataset.mact, parseInt(b.dataset.mdir,10));
});
document.getElementById("prev").onclick=()=>{
  if (fmtKey(viewMonday) <= MIN_WEEK) return;
  viewMonday=addDays(viewMonday,-7);
  render();
};
document.getElementById("next").onclick=()=>{ viewMonday=addDays(viewMonday,7); render(); };
document.getElementById("todayBtn").onclick=()=>{ viewMonday=getMonday(new Date()); render(); };
document.getElementById("syncBadge").onclick=()=>{ view="settings"; setTabs(); render(); };
document.getElementById("tabToday").onclick=()=>{ view="today"; todayViewDate = new Date(); setTabs(); render(); };
document.getElementById("tabWeek").onclick=()=>{ view="week"; setTabs(); render(); };
document.getElementById("tabHistory").onclick=()=>{ view="history"; setTabs(); render(); };
document.getElementById("tabSettings").onclick=()=>{ view="settings"; setTabs(); render(); };
document.getElementById("themeToggle").onclick=function(){
  let saved = null;
  try{ saved = localStorage.getItem(THEME_KEY); }catch(e){}
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const currentlyDark = saved === "dark" || (saved !== "light" && prefersDark);
  try{ localStorage.setItem(THEME_KEY, currentlyDark ? "light" : "dark"); }catch(e){}
  applyTheme();
};
function setTabs(){
  ["tabToday","tabWeek","tabHistory","tabSettings"].forEach(function(id){
    const isActive = (id==="tabToday" && view==="today") || (id==="tabWeek" && view==="week") || (id==="tabHistory" && view==="history") || (id==="tabSettings" && view==="settings");
    document.getElementById(id).classList.toggle("active", isActive);
    document.getElementById(id).setAttribute("aria-selected", isActive ? "true" : "false");
  });
}
document.addEventListener("visibilitychange", ()=>{ 
  if(document.visibilityState==="visible" && pantryId){
    reconcile(); 
  } else if(document.visibilityState==="hidden" && pantryId){
    if (pushTimer) { clearTimeout(pushTimer); doPush(); }
  }
});

/* ===================== Auto-aggiornamento ===================== */
/* All'apertura controlla se sul sito c'è una versione più recente e, in tal caso,
   ricarica automaticamente (con cache-buster) così Mac e iPhone restano aggiornati. */
async function checkUpdate(){
  try{
    // APP_VERSION vive in app.js (non più in index.html): va letta da qui.
    const txt = await fetch("app.js?_cb=" + Date.now(), {cache:"no-store"}).then(r=>r.text());
    const m = txt.match(/APP_VERSION\s*=\s*"([^"]+)"/);
    if(m && m[1] && m[1] !== APP_VERSION && m[1] !== "__BUILD_TS__" && !sessionStorage.getItem("cdfReloaded")){
      sessionStorage.setItem("cdfReloaded","1");
      location.replace(location.pathname + "?v=" + encodeURIComponent(m[1]));
    }
  }catch(e){}
}

/* ===================== Avvio ===================== */
if(repairData()) saveLocal();   // pulizia fantasmi/doppioni custom all'apertura
// Popola subito DEFAULT_LABEL con i nomi delle custom GIÀ salvate, così il primo
// render di "Oggi" mostra i nomi e non gli id "cust_…" (reconcile lo rifà dopo dalla sync).
for(const sec of SECTIONS){
  const cs=(data._customActivities&&data._customActivities[sec.id])||[];
  cs.forEach(a=>{ if(a && a.id && a.name && !DEFAULT_LABEL[a.id]) DEFAULT_LABEL[a.id]=a.name; });
}
render();
if(pantryId) reconcile();
checkUpdate();
/* Registrazione Service Worker (solo su HTTPS — GitHub Pages) */
if("serviceWorker" in navigator && location.protocol === "https:"){
  navigator.serviceWorker.register("sw.js").catch(function(){});
}

// Swipe support for Today View
let touchStartX = 0;
let touchEndX = 0;
const todayContainer = document.getElementById("todayView");
if(todayContainer) {
  todayContainer.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, {passive: true});
  todayContainer.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    if (touchEndX < touchStartX - 60) {
      // Swipe left -> Next day
      todayViewDate = new Date(todayViewDate.getTime() + 86400000);
      renderToday();
    }
    if (touchEndX > touchStartX + 60) {
      // Swipe right -> Prev day
      todayViewDate = new Date(todayViewDate.getTime() - 86400000);
      renderToday();
    }
  }, {passive: true});
}
