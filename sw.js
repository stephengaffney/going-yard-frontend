// Bumped from gyard-v1 — new cache + new fetch strategy below.
const CACHE = 'gyard-v2';
const ASSETS = ['/', '/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // Only manage our own app shell (index.html, manifest, icons, this file).
  // Everything cross-origin — Supabase, MLB CDN headshots, Google Fonts,
  // the React/Supabase CDN scripts — goes straight to the network as normal,
  // so we're not caching or intercepting traffic that isn't ours to manage.
  const reqUrl = new URL(e.request.url);
  if (reqUrl.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);

      const networkFetch = fetch(e.request)
        .then(response => {
          if (response && response.ok) cache.put(e.request, response.clone());
          return response;
        })
        .catch(() => cached);

      if (cached) {
        // Stale-while-revalidate: answer instantly from the local cache
        // (no network round trip, no Vercel egress for this load at all),
        // then let the network request above refresh the cache in the
        // background so the *next* open picks up any new deploy.
        e.waitUntil(networkFetch);
        return cached;
      }

      // Nothing cached yet (first-ever visit, or a brand new asset) — there's
      // nothing to serve instantly, so wait for the network this one time.
      return networkFetch;
    })
  );
});

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Going Yard', {
      body:    data.body || '',
      icon:    '/icon-192.png',
      badge:   '/icon-192.png',
      data:    data.data || {},
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();

  const data    = e.notification.data || {};
  const eventId = data.hr_event_id;
  const videoId = data.video_id;

  // Build both a fallback URL (for opening a brand new window) and a
  // deepLink payload (for messaging an already-open window in place).
  let url = '/';
  const deepLink = {};

  if (videoId) {
    // Any notification carrying a video_id → open Chugs tab scrolled to that video
    // Covers: type='video' (upload), type='comment' on video, type='like' on video
    url = `/?tab=videos&video=${videoId}`;
    deepLink.videoId = videoId;
  } else if (eventId) {
    // Everything else with an hr_event_id → open Feed scrolled to that card
    url = `/?event=${eventId}`;
    deepLink.eventId = eventId;
  }

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // If the app is already open, message it the new deep link instead of
      // navigating — a full navigate() re-fetches index.html from the network
      // every time, which is exactly the repeated-download cost we're trying
      // to cut. The already-running app just updates its own state instead.
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'DEEP_LINK', deepLink });
          return client.focus();
        }
      }
      // No window open at all — this is the one case that genuinely needs
      // a fresh load, so open one normally.
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
