const CACHE = 'life-os-v0.3.1';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./scheduler.js','./manifest.webmanifest','./apple-touch-icon.png','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(r => r || fetch(event.request).then(resp => {
    const copy = resp.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); return resp;
  }).catch(() => caches.match('./index.html'))));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window', includeUncontrolled:true}).then(list => {
    if (list.length) return list[0].focus();
    return clients.openWindow('./index.html');
  }));
});
