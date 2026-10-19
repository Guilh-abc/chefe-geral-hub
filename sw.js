// Cache: só a casca na instalação. Módulos entram no cache depois da primeira vez que você abre.
const V = "cg-v5";
const CASCA = ["./", "./index.html", "./core/app.css", "./core/shell.js", "./core/ui.js", "./core/config.js", "./core/db.js",
  "./core/pipeline.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(V).then(c => c.addAll(CASCA)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // webhook, Telegram, Obsidian e Ollama sempre ao vivo
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match("./index.html"))));
});
