self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', (event) => {
  // So intercepta GET (navegacao/paginas). POST (upload de comprovante, share-target)
  // passa direto pra rede sem passar pelo service worker, evitando falha ao
  // repassar corpo de upload de arquivo (FormData) em alguns navegadores.
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});
