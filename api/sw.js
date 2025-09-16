const CACHE_NAME = 'proxy-sw-cache-v1';
const PROXY_PREFIX = '/api/proxy?url=';

self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if(e.request.method !== 'GET') return;

  if(url.pathname.startsWith(PROXY_PREFIX) || url.origin === location.origin){
    e.respondWith(fetch(e.request).catch(()=>new Response('Network error', {status:408})));
    return;
  }

  const proxiedUrl = PROXY_PREFIX + encodeURIComponent(e.request.url);
  e.respondWith(fetch(proxiedUrl).catch(()=>new Response('Proxy fetch failed', {status:408})));
});

self.addEventListener('message', e => {
  if(e.data && e.data.type==='CLEAR_CACHE'){
    caches.keys().then(keys=>keys.forEach(k=>caches.delete(k)));
  }
});

self.addEventListener('push', e=>{});
