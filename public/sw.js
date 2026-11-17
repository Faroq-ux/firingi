/*
 * FIRINGI service worker (Phase 7 push notifications; Phase 39 installable app + offline).
 *  • Pages: always from the network. With no signal the saved offline app (/offline) opens instead —
 *    other pages are never kept on the phone (they hold live, personal data).
 *  • /_next/static and /icons: kept once fetched (file names change with every release).
 *  • Invoice PDFs the app saved for offline reading: from the network, else the saved copy.
 *  • Push: shows the notification and sets the dot / number on the app icon.
 */
const SHELL = "firingi-shell-v1";
const STATIC = "firingi-static-v1";
const DOCS = "firingi-docs";
const KEEP = [SHELL, STATIC, DOCS];

async function saveShell() {
  const res = await fetch("/offline", { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) return;
  const html = await res.clone().text();
  const shell = await caches.open(SHELL);
  await shell.put("/offline", res);
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))];
  const statics = await caches.open(STATIC);
  await Promise.all([...assets, "/icons/icon-192.png", "/icons/badge-96.png"].map(async (url) => {
    if (await statics.match(url)) return;
    const r = await fetch(url).catch(() => null);
    if (r && r.ok) await statics.put(url, r);
  }));
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(saveShell().catch(() => null));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const OFFLINE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FIRINGI</title>
<body style="font-family:system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#0b1020;color:#fff;text-align:center;padding:24px">
<div><div style="font-size:42px">📶</div><h1 style="font-size:20px">No signal</h1><p style="opacity:.8">Open FIRINGI once with signal to use it offline.</p>
<button onclick="location.reload()" style="padding:10px 18px;border-radius:10px;border:0;background:#3b6cf6;color:#fff;font-size:16px">Try again</button></div></body>`;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const shell = await (await caches.open(SHELL)).match("/offline");
        return shell || new Response(OFFLINE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  // Invoice PDFs are not routed here: the offline app opens the saved copies straight from the cache.
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "refresh-shell") event.waitUntil(saveShell().catch(() => null));
  if (type === "wipe") event.waitUntil(Promise.all([caches.delete(DOCS), caches.delete(SHELL)]));
  if (type === "badge" && self.navigator && "setAppBadge" in self.navigator) {
    const n = Number(event.data.count) || 0;
    event.waitUntil(n > 0 ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge());
  }
});

// Background Sync (Chrome / Android): back online with no FIRINGI page open — wake an open page if any to send the outbox.
self.addEventListener("sync", (event) => {
  if (event.tag !== "firingi-outbox") return;
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => list.forEach((c) => c.postMessage({ type: "flush" }))));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const badge = self.navigator && "setAppBadge" in self.navigator
    ? (typeof data.badge === "number" ? self.navigator.setAppBadge(data.badge) : self.navigator.setAppBadge()).catch(() => null)
    : Promise.resolve();
  event.waitUntil(Promise.all([
    badge,
    self.registration.showNotification(data.title || "FIRINGI", { body: data.body || "", data: { link: data.link || "/" }, badge: "/icons/badge-96.png", icon: "/icons/icon-192.png" }),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
