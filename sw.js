// Caches only the app's own files so it opens quickly. Never caches anything from Google.
const CACHE = 'ledger-v6';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'parser.js', 'readers.js', 'rules.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // Google traffic is never touched
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
