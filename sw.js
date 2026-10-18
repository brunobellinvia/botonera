/* Botonera — service worker
   Guarda la app completa en el iPad la primera vez que se abre con conexión.
   Después abre siempre desde el caché, con o sin internet.
   Cada vez que cambies un archivo del repo, subí el número de VERSION. */
var VERSION = "1.8.1";
var CACHE = "botonera-" + VERSION;
var FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./fonts/barlow-condensed-latin-500-normal.woff2",
  "./fonts/barlow-condensed-latin-600-normal.woff2",
  "./fonts/barlow-condensed-latin-700-normal.woff2",
  "./fonts/ibm-plex-mono-latin-400-normal.woff2",
  "./fonts/ibm-plex-mono-latin-500-normal.woff2",
  "./icons/apple-touch-icon-152.png",
  "./icons/apple-touch-icon-167.png",
  "./icons/apple-touch-icon-180.png",
  "./icons/favicon-64.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/splash-1536x2048.png",
  "./icons/splash-2048x1536.png"
];

self.addEventListener("install", function(e){
  /* cache:"reload" saltea el caché HTTP de GitHub Pages (10 min), así la versión nueva no guarda archivos viejos */
  e.waitUntil(caches.open(CACHE).then(function(c){
    return c.addAll(FILES.map(function(u){ return new Request(u, {cache:"reload"}); }));
  }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k.indexOf("botonera-") === 0 && k !== CACHE) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* La app pide aplicar la actualización solo cuando tocás el botón; nunca recarga sola en medio de un show */
self.addEventListener("message", function(e){
  if(e.data === "skipWaiting") self.skipWaiting();
  if(e.data === "version" && e.source) e.source.postMessage({version:VERSION});
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  if(new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, {ignoreSearch:true}).then(function(hit){
      if(hit) return hit;
      return fetch(req).then(function(res){
        if(res && res.ok && res.type === "basic"){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copy); });
        }
        return res;
      }).catch(function(){
        if(req.mode === "navigate") return caches.match("./index.html");
      });
    })
  );
});
