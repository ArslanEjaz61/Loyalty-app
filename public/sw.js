/**
 * Service worker — deliberately conservative.
 *
 * Everything under /api is always fetched from the network and never cached:
 * a stale points balance or, worse, a stale QR code would be actively harmful.
 * Only the static build assets are cached, which is what makes the installed
 * app open instantly without risking incorrect data.
 */

const CACHE = "loyalty-v1";
const BASE = "/loyalty";

self.addEventListener("install", (event) => {
  // Take over as soon as the new worker is ready rather than waiting for every
  // tab to close — otherwise a fix can sit undelivered for days.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([`${BASE}/`, `${BASE}/card`]).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve loyalty data from cache.
  if (url.pathname.includes("/api/")) return;

  // Immutable build output: cache first, it can never go stale.
  if (url.pathname.includes("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
            return res;
          })
      )
    );
    return;
  }

  // Pages: network first so updates land immediately, cache only as the
  // offline fallback.
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request))
  );
});
