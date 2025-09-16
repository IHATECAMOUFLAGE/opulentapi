self.addEventListener('fetch', event=>{
  const url = new URL(event.request.url);
  if(url.origin !== self.origin){
    event.respondWith(
      fetch('/api/proxy?url='+encodeURIComponent(event.request.url),{
        method:event.request.method,
        headers:event.request.headers,
        body:event.request.method==='POST'?event.request.clone().body:null,
        credentials:'include'
      })
    );
  }
});
