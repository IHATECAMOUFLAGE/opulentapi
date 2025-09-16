import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

let injectJS = '';
try {
  injectJS = fs.readFileSync(path.join(process.cwd(), 'lib/rewriter/inject.js'), 'utf8');
} catch {}

function rewriteHTML(html, baseUrl, hostDomain) {
  html = html.replace(/(src|srcset|poster)=["']([^"']+)["']/gi, (m, attr, url) => {
    if (!url || url.startsWith('data:') || url.startsWith('/api/proxy') || url.startsWith('javascript:')) return m;
    try {
      const absolute = new URL(url, baseUrl).toString();
      if (new URL(absolute).hostname === hostDomain) return `${attr}="${absolute}"`;
      return `${attr}="/api/proxy?url=${encodeURIComponent(absolute)}"`;
    } catch { return m; }
  });

  html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (m, url) => {
    if (!url || url.startsWith('data:') || url.startsWith('/api/proxy') || url.startsWith('javascript:')) return m;
    try {
      const absolute = new URL(url, baseUrl).toString();
      if (new URL(absolute).hostname === hostDomain) return `url('${absolute}')`;
      return `url('/api/proxy?url=${encodeURIComponent(absolute)}')`;
    } catch { return m; }
  });

  html = html.replace(/(--background-image\s*:\s*url\(["']?)([^"')]+)(["']?\))/gi, (m, prefix, url, suffix) => {
    if (!url || url.startsWith('data:') || url.startsWith('/api/proxy') || url.startsWith('javascript:')) return m;
    try {
      const absolute = new URL(url, baseUrl).toString();
      if (new URL(absolute).hostname === hostDomain) return `${prefix}${absolute}${suffix}`;
      return `${prefix}/api/proxy?url=${encodeURIComponent(absolute)}${suffix}`;
    } catch { return m; }
  });

  html = html.replace(/<\/body>/i, `
    <script>
      function proxifyAllLinksFormsAndWindows(hostDomain){
        document.querySelectorAll('a').forEach(a=>{
          a.addEventListener('click', e=>{
            const href=a.href;
            if(href && !href.startsWith('/api/proxy') && !href.startsWith('javascript:') && !href.startsWith('data:')){
              const urlObj=new URL(href,a.baseURI);
              if(urlObj.hostname!==hostDomain){
                e.preventDefault();
                window.location.href='/api/proxy?url='+encodeURIComponent(href);
              }
            }
          });
        });

        document.querySelectorAll('form').forEach(f=>{
          f.addEventListener('submit', e=>{
            e.preventDefault();
            let url=f.action||window.location.href;
            const urlObj=new URL(url,f.baseURI);
            if(urlObj.hostname===hostDomain){
              f.submit();
              return;
            }
            const params=new URLSearchParams(new FormData(f)).toString();
            if(url.includes('?')) url+='&'+params; else url+='?'+params;
            window.location.href='/api/proxy?url='+encodeURIComponent(url);
          });
        });

        const overrideLocation = (obj, prop) => {
          const original = obj[prop];
          Object.defineProperty(obj, prop, {
            set:function(v){
              try{
                const u=new URL(v);
                if(u.hostname!==hostDomain){
                  original='/api/proxy?url='+encodeURIComponent(v);
                }
              }catch{}
              original=v;
            },
            get:function(){return original;},
            configurable:true
          });
        };
        overrideLocation(window,'location');
        overrideLocation(window.top,'location');
        const origOpen=window.open;
        window.open=function(url,...rest){
          try{
            const u=new URL(url);
            if(u.hostname!==hostDomain) url='/api/proxy?url='+encodeURIComponent(url);
          }catch{}
          return origOpen.call(window,url,...rest);
        };
      }
      proxifyAllLinksFormsAndWindows(window.location.hostname);
    </script>
  </body>`);

  return html;
}

export default async function handler(req,res){
  if(req.method==='OPTIONS'){
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type,User-Agent,Referer");
    return res.status(204).end();
  }

  let targetUrl=req.query.raw||req.query.url;
  if(!targetUrl) return res.status(400).send("Missing `url` or `raw` query parameter.");
  const isRaw=!!req.query.raw;

  try{targetUrl=decodeURIComponent(targetUrl);}catch{return res.status(400).send("Invalid URL encoding.");}

  try{
    const agent=new https.Agent({rejectUnauthorized:false});
    const isImage=/\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff)$/i.test(targetUrl);
    const isBinary=/\.(woff2?|ttf|eot|otf)$/i.test(targetUrl);
    const isJs=/\.js$/i.test(targetUrl);
    const isJson=/\.json$/i.test(targetUrl);

    const response=await axios.get(targetUrl,{
      httpsAgent:agent,
      responseType:isImage||isBinary?'arraybuffer':'text',
      timeout:20000,
      headers:{'User-Agent':req.headers['user-agent']||'','Accept':'*/*'}
    });

    const contentType=response.headers['content-type']||'application/octet-stream';
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Content-Type",contentType);

    const headers={...response.headers};
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];
    delete headers['x-frame-options'];
    for(const [key,value] of Object.entries(headers)) res.setHeader(key,value);

    if(isImage||isBinary){
      const buffer=Buffer.from(response.data);
      res.setHeader('Content-Length',buffer.length);
      return res.status(response.status).send(buffer);
    }

    if(isJson) return res.status(response.status).json(response.data);

    let data=response.data;

    if(isRaw){
      const escaped=data.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      return res.status(response.status).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Raw HTML</title><style>body{background:#111;color:#0f0;font-family:monospace;padding:20px;white-space:pre-wrap;}</style></head><body><pre>${escaped}</pre></body></html>`);
    }

    if(!isJs&&contentType.includes('text/html')){
      const baseUrl=new URL(targetUrl);
      data=rewriteHTML(data,baseUrl,req.headers.host);
      if(injectJS) data=data.replace(/<\/head>/i,`<script>${injectJS}</script></head>`);
    }

    return res.status(response.status).send(data);

  }catch(e){
    return res.status(500).send("Fetch error: "+e.message);
  }
}
