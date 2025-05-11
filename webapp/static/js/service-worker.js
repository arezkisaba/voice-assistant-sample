// Service Worker pour Assistant Vocal Français PWA
const CACHE_NAME = 'assistant-vocal-cache-v1';
const urlsToCache = [
  '/',
  '/static/css/styles.css',
  '/static/js/app.js',
  '/static/img/favicon.ico',
  '/static/manifest.json',
  'https://cdn.socket.io/4.4.1/socket.io.min.js'
];

// Installation du service worker et mise en cache des ressources essentielles
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache ouvert');
        return cache.addAll(urlsToCache);
      })
  );
});

// Intercepter les requêtes réseau et servir depuis le cache si disponible
self.addEventListener('fetch', event => {
  // Ne pas intercepter les requêtes socket.io
  if (event.request.url.includes('socket.io')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Le cache a trouvé une correspondance
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
      .catch(() => {
        // Fallback pour certaines ressources si offline
        if (event.request.url.indexOf('/static/') !== -1) {
          return caches.match('/');
        }
      })
  );
});

// Nettoyage des anciens caches lors de l'activation d'un nouveau service worker
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});