/*
 * WECAMETOOPARTY service worker - registered by components/ServiceWorker.tsx
 * in production builds only.
 *
 * Two jobs, both same-origin only:
 *   /_next/static/*  cache-first. Every file there is content-hashed, so a
 *                    cached copy can never be stale; repeat visits skip the
 *                    network for all JS, CSS and fonts.
 *   page loads       network-first, falling back to the last copy if the
 *                    network is gone or takes longer than NAV_TIMEOUT_MS -
 *                    a fresh deploy always wins when there is signal.
 *
 * Everything else - Supabase, Posh flyers, Instagram, POSTs - is not touched
 * at all. Bump VERSION to throw every cache away.
 */

const VERSION = "wctp-v1";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const STATIC_LIMIT = 250;
const PAGES_LIMIT = 40;
const NAV_TIMEOUT_MS = 3500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.add("/"))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event, request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, request));
  }
});

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  // Insertion order, so the front of the list is the oldest.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((k) => cache.delete(k)));
}

async function cacheFirst(event, request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;

  const res = await fetch(request);
  if (res.ok) {
    event.waitUntil(cache.put(request, res.clone()).then(() => trim(STATIC, STATIC_LIMIT)));
  }
  return res;
}

/** The page's path without its query - a magic-link ?code= is the same page. */
function pageKey(request) {
  const url = new URL(request.url);
  return `${url.origin}${url.pathname}`;
}

async function networkFirst(event, request) {
  const cache = await caches.open(PAGES);
  const key = pageKey(request);

  const network = fetch(request).then((res) => {
    // An opaque redirect (/tickets -> /tickets/) is handed straight back for
    // the browser to follow; only a real page is worth keeping.
    if (res.ok && res.type === "basic") {
      event.waitUntil(cache.put(key, res.clone()).then(() => trim(PAGES, PAGES_LIMIT)));
    }
    return res;
  });
  // The race below can settle on the cached copy first; the network promise
  // still has to finish (to refresh the cache) without an unhandled rejection.
  event.waitUntil(network.catch(() => {}));

  const cached = await cache.match(key);
  if (!cached) {
    try {
      return await network;
    } catch {
      return (await cache.match("/")) ?? offline();
    }
  }

  const slow = new Promise((resolve) => setTimeout(() => resolve(cached), NAV_TIMEOUT_MS));
  try {
    return await Promise.race([network, slow]);
  } catch {
    return cached;
  }
}

function offline() {
  return new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · WECAMETOOPARTY</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#050505;color:#c9cdd4;font:16px system-ui;text-align:center;padding:24px"><div><p style="font:900 32px/1 system-ui;color:#f2f4f7;letter-spacing:.02em">You&rsquo;re offline</p><p>Reconnect and this page will load.</p><p><a href="/" style="color:#f2f4f7">Try again</a></p></div>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
