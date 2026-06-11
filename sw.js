/**
 * sw.js - Service Worker do painel EGov-PL.
 *
 * Estratégias:
 *  - Navegações (HTML) ........ network-first, fallback para o shell em cache
 *  - /api/* ................... só rede (dados vivos); fallback JSON offline
 *  - eventos-data.json ........ network-first com fallback ao cache (dados
 *                               "stale" ainda são úteis offline)
 *  - estáticos same-origin .... stale-while-revalidate (css/js/img/fontes)
 *  - CDNs (jsdelivr etc.) ..... stale-while-revalidate em cache separado
 *
 * Versione o VERSION a cada mudança relevante de shell para invalidar caches.
 */

const VERSION = "egov-pwa-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
const CDN_CACHE = `${VERSION}-cdn`;
const DATA_CACHE = `${VERSION}-data`;

const PRECACHE = [
  "/dashboard.html",
  "/index.html",
  "/manifest.webmanifest",
  "/assets/css/main.css",
  "/assets/css/base/_variables.css",
  "/assets/img/favicon/favicon-32.png",
  "/assets/img/favicon/android-chrome-192.png",
  "/assets/img/favicon/android-chrome-512.png",
  "/assets/img/favicon/maskable-192.png",
  "/assets/img/favicon/maskable-512.png",
  "/assets/img/logo-light.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Navegações: network-first → cache do shell → dashboard como último recurso
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          const path = url.pathname.replace(/\/$/, "");
          const shell = path === "" || path === "/index" || path === "/index.html"
            ? "/index.html" : "/dashboard.html";
          return caches.match(shell);
        })
    );
    return;
  }

  // APIs: só rede (dados vivos). Offline → JSON de erro padronizado.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ ok: false, offline: true, error: "Sem conexão." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // Dados estáticos do painel: network-first com fallback ao cache.
  if (url.origin === self.location.origin && url.pathname === "/eventos-data.json") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Estáticos same-origin e CDNs: stale-while-revalidate.
  const isStatic = url.origin === self.location.origin &&
    /\.(css|js|mjs|png|jpg|jpeg|svg|webp|ico|woff2?|json|webmanifest)$/.test(url.pathname);
  const isCdn = /(?:jsdelivr\.net|cloudflare\.com|googleapis\.com|gstatic\.com)$/.test(url.hostname);

  if (isStatic || isCdn) {
    const cacheName = isCdn ? CDN_CACHE : STATIC_CACHE;
    event.respondWith(
      caches.open(cacheName).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => null);
        return cached || network.then((res) => res || new Response("", { status: 504 }));
      })
    );
  }
});
