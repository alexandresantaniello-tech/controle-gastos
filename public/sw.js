const VERSION = '20261110-2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // O Sifia nao usa cache offline pelo Service Worker. Para navegacoes e
  // arquivos do app, sempre pede a versao atual ao servidor, evitando que
  // Chrome/PWA fique preso a HTML/JS antigo depois de um deploy.
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});
