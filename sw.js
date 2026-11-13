/* سين جيم تيمو — Service Worker
   الملفات الأساسية: Network-First (التحديث يصل فوراً، والكاش بديل عند انقطاع الإنترنت)
   الهوية ورسومات الفئات والشعارات والأعلام: Cache-First بعد أول طلب. */

const VERSION = "seenjeem-v90";

/* رسومات الفئات — تُخزّن مسبقاً حتى تظهر شاشة الاختيار كاملة دون إنترنت */
const CAT_IDS = [
  "logos", "flags", "quran", "prophets", "deen", "kuwait", "animals",
  "history", "geo", "football", "general", "science", "literature", "arts",
  "kids_islam", "kids_science", "kids_animals", "kids_cartoons", "kids_riddles", "kids_world",
];

const CORE = [
  "./",
  "./index.html",
  "./styles.css?v=85",
  "./app.js?v=85",
  "./questions.js?v=85",
  "./manifest.json",
  "./assets/icon.svg",
  "./assets/bg-pattern.svg",
  ...CAT_IDS.map((id) => `./assets/cats/${id}.svg`),
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

function isAsset(url) {
  return url.pathname.indexOf("/assets/logos/") !== -1
    || url.pathname.indexOf("/assets/flags/") !== -1
    || url.pathname.indexOf("/assets/cats/") !== -1
    || url.pathname.indexOf("/assets/icon.svg") !== -1;
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

  if (isAsset(url)) { event.respondWith(cacheFirst(request)); return; }
  event.respondWith(networkFirst(request));
});
