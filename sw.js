/*
 * Travel Board service worker: caches the app files so it opens with no connection.
 * When any app file changes, bump CACHE_VERSION so devices pick up the new files.
 */
var CACHE_VERSION = 'travelboard-v9';
var APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'model.js',
  'docx.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) { return cache.addAll(APP_FILES); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Cache first, then network. Page loads fall back to index.html when offline.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).catch(function () {
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});
