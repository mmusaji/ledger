// Caches only the app's own files so it opens quickly. Never touches anything outside the app's own files.
const CACHE = 'ledger-v14';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'parser.js', 'readers.js', 'rules.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Files shared to the app (Share menu): park them for a moment, then open the app, which reads and deletes them.
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const fd = await e.request.formData();
        const c = await caches.open('ledger-inbox');
        for (const k of await c.keys()) await c.delete(k);
        let i = 0;
        for (const f of fd.getAll('pdfs')) {
          if (!(f instanceof File)) continue;
          await c.put('./inbox/' + (i++), new Response(f, { headers: { 'x-name': encodeURIComponent(f.name) } }));
        }
      } catch (err) { /* fall through to opening the app */ }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // anything outside the app is never touched
  // cache: 'no-cache' makes the browser check GitHub for a newer file every time instead of reusing an old copy.
  // If GitHub is unreachable OR answers with an error (site removed, 404, 5xx), open the saved copy instead.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(async r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }
    return (await caches.match(e.request)) || r;
  }).catch(async () => (await caches.match(e.request)) || Response.error()));
});
