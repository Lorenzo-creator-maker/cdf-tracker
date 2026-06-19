# CDF Tracker — Previsione Studio

## 📋 Stato del progetto

**Ultimo aggiornamento:** 19 giugno 2026

### ✅ Completato
- ✅ **Prototipo standalone** di previsione carico studio (`previsione-studio.html`)
- ✅ Pubblicato su GitHub Pages (online e funzionante)
- ✅ Modello matematico di calcolo sedute/settimana
- ✅ Tipi di percorso configurabili (10 sedute, 5, altro)
- ✅ Linea capacità colleghi con soglia allerta
- ✅ KPI in tempo reale (carico ora/4/8 sett, prime visite/sett per saturare)
- ✅ Grafico SVG interno (nessuna dipendenza, offline-ready)
- ✅ Salvataggio dati in localStorage

### 🚀 Cosa fa adesso
La pagina `/previsione-studio.html` stima il carico di sedute settimanali per le prossime ~14 settimane:
- Input: prime visite/settimana stimate, tipi di percorso (% conversione, n sedute, cadenza)
- Input: stato attuale (pazienti già in cura con sedute residue)
- Input: capacità studio (colleghi × sedute/collega/sett)
- Output: grafico carico previsto, KPI, dettaglio settimana per settimana, alert "rischio scarico"

Tutti i dati restano **sul telefono** (localStorage).

## 🔗 Link utili

- **📱 Pagina online:** https://lorenzo-creator-maker.github.io/cdf-tracker/previsione-studio.html
- **📂 Repository:** https://github.com/lorenzo-creator-maker/cdf-tracker
- **📝 Branch di sviluppo:** `claude/studio-appointment-forecast-ql6jh9`
- **🌳 File:** `/previsione-studio.html` (singolo file HTML con CSS e JS embedded)

## 📊 Architettura dati

```javascript
{
  fvWeek: 8,                    // prime visite/sett stimate
  startOffset: 1,               // sett prima di inizio percorso
  horizon: 14,                  // settimane di previsione
  pathTypes: [                  // tipi di percorso
    {id, name, conv%, sessions, cadence (sed/sett)}
  ],
  current: {                    // pazienti gia in cura (oggi)
    [pathId]: {patients, rem (sedute residue media)}
  },
  capacity: {
    colleagues: 3,
    perColleague: 25            // sed/sett per collega
  },
  alertPct: 65                  // soglia allerta (% capacita)
}
```

Tutti i dati sono in **localStorage** con chiave `cdfPrevisioneStudio_v1`.

## 🎯 Prossimi step (da definire)

### Opzione 1: Integrazione API (sicurezza ⚠️)
- Le chiavi API sono già disponibili (test + produzione)
- **Decisione presa:** Backend proxy sicuro (non esporre chiavi su Pages)
- Serve serverless function che:
  - Estrae da API: prime visite/sett, appuntamenti futuri, disponibilità colleghi
  - Calcola tasso di conversione reale (prime visita → pacchetto)
  - Espone al browser SOLO numeri aggregati
- Opzioni hosting: Cloudflare Workers (gratis), Vercel, Netlify, Supabase

### Opzione 2: Input manuale taratura
- Usare il prototipo come è (input manuale)
- Tarare i valori di default sui dati reali dello studio
- Aggiungere solo nel tempo la parte API

### Opzione 3: Estensioni UI
- Export CSV / PDF del grafico
- Scenari "ottimista / pessimista" (se le FV salgono/scendono)
- Previsione fatturato per settimana
- Cronologia: salvare snapshot delle previsioni passate

## 🔐 Note di sicurezza

- ⚠️ **Chiavi API di produzione cambiate** (erano in chat, potevano essere esposte)
- Usare chiave di TEST per sviluppo
- Non mettere mai chiavi in codice JS che gira su Pages pubblica
- Se API: proxy server-side obbligatorio

## 📝 Come ripartire in una nuova chat

1. Condividi il link del repo: https://github.com/lorenzo-creator-maker/cdf-tracker
2. Descrivi cosa vuoi fare (es. "integro i dati dal gestionale", "aggiungo export PDF", ecc.)
3. Allega questo file (CLAUDE.md) come contesto se non lo legge già automaticamente

## 👤 Contatto / Note

- Studio di fisioterapia/wellness con ~3 colleghi
- Gestionale con API (Postman doc: https://documenter.getpostman.com/view/6598359/2s93eZxBCT)
- App su GitHub Pages (offline-first PWA style)
- Tracker attività giornaliere (CDF): `/index.html`
- Libreria esercizi: `/esercizi/`
