self.addEventListener('install',e=>{self.skipWaiting()});
self.addEventListener('activate',e=>{self.clients.claim()});

self.addEventListener('fetch',e=>{
  const url = new URL(e.request.url);
  if(url.origin === location.origin) return;
  if(url.pathname.startsWith('/api/proxy')) return;
  const proxied = '/api/proxy?url=' + encodeURIComponent(url.href);
  e.respondWith(fetch(proxied));
});
