self.addEventListener('install', event=>{
  self.skipWaiting();
});

self.addEventListener('activate', event=>{
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event=>{
  const req = event.request;
  const url = new URL(req.url);
  const base = self.location.origin;

  if(req.method==='POST' || req.method==='GET'){
    event.respondWith((async ()=>{
      try{
        const cloned = req.clone();
        const headers = new Headers(cloned.headers);
        headers.set('X-Proxy-Sw','true');
        const modifiedReq = new Request(cloned,{headers});
        const resp = await fetch(modifiedReq);
        if(resp.ok){
          let contentType = resp.headers.get('content-type')||'';
          if(contentType.includes('text/html') || contentType.includes('application/javascript') || contentType.includes('text/css')){
            let text = await resp.text();
            text = text.replace(/(window\.location(?:\.href)?\s*=\s*['"`])(.*?)['"`]/gi,(m,prefix,target)=>{
              try{
                let t=new URL(target,url).toString();
                if(!t.startsWith(base+'/api/proxy.js?url=')) t=base+'/api/proxy.js?url='+encodeURIComponent(t);
                return prefix+t+'"';
              }catch{return m;}
            });
            text = text.replace(/window\.open\s*\(\s*['"`](.*?)['"`]/gi,(m,target)=>{
              try{
                let t=new URL(target,url).toString();
                if(!t.startsWith(base+'/api/proxy.js?url=')) t=base+'/api/proxy.js?url='+encodeURIComponent(t);
                return `window.open('${t}')`;
              }catch{return m;}
            });
            text = text.replace(/<a\s+[^>]*href=["'](.*?)["']/gi,(m,target)=>{
              try{
                let t=new URL(target,url).toString();
                if(!t.startsWith(base+'/api/proxy.js?url=')) t=base+'/api/proxy.js?url='+encodeURIComponent(t);
                return m.replace(target,t);
              }catch{return m;}
            });
            text = text.replace(/<form\s+[^>]*action=["'](.*?)["']/gi,(m,target)=>{
              try{
                let t=new URL(target,url).toString();
                if(!t.startsWith(base+'/api/proxy.js?url=')) t=base+'/api/proxy.js?url='+encodeURIComponent(t);
                return m.replace(target,t);
              }catch{return m;}
            });
            return new Response(text,{headers:resp.headers,status:resp.status,statusText:resp.statusText});
          }
          return resp;
        }
        return resp;
      }catch(e){
        return new Response('ServiceWorker fetch error: '+e.message,{status:500});
      }
    })());
  }
});
