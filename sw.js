/* سين جيم — Service Worker
   الملفات الأساسية: Network-First (التحديث يصل فوراً، والكاش بديل عند انقطاع الإنترنت)
   الشعارات: Cache-First بعد أول طلب. */

const VERSION = "seenjeem-v42";
const CORE = [
  "./",
  "./index.html",
  "./styles.css?v=42",
  "./app.js?v=42",
  "./questions.js?v=42",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all(
        CORE.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => null))
      ))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => {})
  );
});

function isLogo(url) {
  return url.pathname.indexOf("/assets/logos/") !== -1;
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const fresh = await fetch(request, { cache: "no-store" });
    if (fresh && (fresh.ok || fresh.type === "opaque")) {
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === "navigate") {
      const page = await cache.match("./index.html", { ignoreSearch: true });
      if (page) return page;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;

  if (isLogo(url)) { event.respondWith(cacheFirst(request)); return; }
  event.respondWith(networkFirst(request));
});
