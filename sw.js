/* ===================== CDF Tracker — Service Worker =====================
   Strategia: network-first con fallback cache.
   - Online: scarica sempre l'ultima versione e aggiorna la cache.
   - Offline: serve dalla cache l'ultima versione scaricata.
   Le chiamate a getpantry.cloud passano direttamente alla rete (no cache).
*/

const CACHE_NAME = "cdf-v1";
const APP_URL = "/cdf-tracker/";  // path su GitHub Pages
const APP_FILE = "/cdf-tracker/index.html";

self.addEventListener("install", function(event) {
  // Pre-caching dell'app shell
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll([APP_URL, APP_FILE]);
    }).catch(function() {
      // Se offline durante l'install, non bloccare: la cache verrà popolata al primo fetch online
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function(event) {
  // Pulizia delle cache di versioni precedenti
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type:"window", includeUncontrolled:true }).then(function(list){
      for(const c of list){ if(c.url.includes("/cdf-tracker/") && "focus" in c) return c.focus(); }
      if(clients.openWindow) return clients.openWindow(APP_URL);
    })
  );
});

self.addEventListener("fetch", function(event) {
  const url = new URL(event.request.url);

  // Lascia passare direttamente: Pantry, richieste non-GET, richieste cross-origin
  if (event.request.method !== "GET") return;
  if (url.hostname === "getpantry.cloud") return;
  if (url.origin !== self.location.origin) return;

  // Strategia network-first: prova la rete, in caso di errore usa la cache
  event.respondWith(
    fetch(event.request).then(function(networkResponse) {
      // Risposta valida dalla rete: aggiorna la cache
      if (networkResponse && networkResponse.ok) {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
      }
      return networkResponse;
    }).catch(function() {
      // Rete non disponibile: fallback alla cache
      return caches.match(event.request).then(function(cached) {
        return cached || new Response("Offline — apri l'app con connessione almeno una volta.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      });
    })
  );
});
