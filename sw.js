// Keeps the app working offline: the app's own files are cached on install,
// and the map, font and database libraries are cached the first time they load.
const VERSION = 'dr-v5';
const SHELL = ['./', 'index.html', 'config.js', 'manifest.json', 'icon-180.png', 'icon-512.png',
  'notes.json', 'talk.json', 'books.json', 'places.json', 'base.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Database traffic goes straight to the network; Firestore keeps its own offline copy.
  if (url.hostname.endsWith('googleapis.com') && !url.hostname.startsWith('fonts.')) return;
  const isLib = /cdnjs\.cloudflare\.com|gstatic\.com|fonts\.googleapis\.com/.test(url.hostname);
  if (url.origin !== location.origin && !isLib) return;
  // Show the cached copy right away, refresh it in the background.
  e.respondWith(caches.open(VERSION).then(async cache => {
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const fresh = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(key, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});

// Daily reminders sent by the scheduled job on GitHub.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Daily Reading', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Daily Reading', {
    body: d.body || '', icon: 'icon-180.png', badge: 'icon-180.png', tag: d.tag || 'daily-reading', data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
