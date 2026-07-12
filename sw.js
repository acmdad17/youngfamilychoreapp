// ── FIREBASE MESSAGING (background push) ──
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyBmvRv99OG5qK9P2MVCoBUTILvRX8v56P0",
  authDomain:        "young-family-770d5.firebaseapp.com",
  databaseURL:       "https://young-family-770d5-default-rtdb.firebaseio.com",
  projectId:         "young-family-770d5",
  storageBucket:     "young-family-770d5.firebasestorage.app",
  messagingSenderId: "224373739078",
  appId:             "1:224373739078:web:49d5a5391fe42b41770447",
});

const messaging = firebase.messaging();

// Called when a push arrives while the app is backgrounded or closed.
messaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  return self.registration.showNotification(d.title || '🏠 Young Family', {
    body: d.body || '',
    icon: 'https://acmdad17.github.io/youngfamilychoreapp/icon-192.png',
    badge:'https://acmdad17.github.io/youngfamilychoreapp/icon-192.png',
    vibrate: [300,100,300,100,300],
    tag: d.type || 'alert',
    renotify: true,
    requireInteraction: true,
    data: d,
  });
});

// Tap notification → focus/open the app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const appUrl = 'https://acmdad17.github.io/youngfamilychoreapp/';
      const existing = list.find(c => c.url.startsWith(appUrl));
      if (existing) return existing.focus();
      return clients.openWindow(appUrl);
    })
  );
});

// ── CACHE ──
const CACHE  = 'young-fam-v7';
const STATIC = [
  '/youngfamilychoreapp/manifest.json',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Nunito:wght@300;400;600;700;800&display=swap',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(STATIC.map(url => c.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))) // v6 purges v5
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (e.request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/') {
    e.respondWith(fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request)));
    return;
  }

  const networkFirst = [
    'firebaseio.com', 'firebasestorage.app', 'googleapis.com',
    'open-meteo.com', 'nabu.casa', 'gstatic.com',
  ].some(h => url.hostname.includes(h));

  if (networkFirst) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (e.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          c