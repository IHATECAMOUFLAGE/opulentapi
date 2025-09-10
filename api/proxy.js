const fetch = require("node-fetch");
const { rewriteAll } = require("../lib/rewriter/all");

const injectJS = `(function(){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/eruda';s.onload=function(){eruda.init()};document.head.appendChild(s);function r(u){if(!u||u.startsWith('data:')||u.startsWith('javascript:'))return u;if(u.startsWith('//'))u='https:'+u;try{if(u.startsWith('http'))return location.origin+'/api/proxy?url='+encodeURIComponent(u);return location.origin+'/api/proxy?url='+encodeURIComponent(new URL(u,location.href).href);}catch(e){return u;}}var of=window.fetch;window.fetch=function(input,init){if(typeof input==='string')input=r(input);else if(input&&input.url)input=new Request(r(input.url),input);return of(input,init)};var OX=window.XMLHttpRequest;function X(){var x=new OX();var o=x.open;x.open=function(m,u,a){arguments[1]=r(u);return o.apply(this,arguments)};return x}window.XMLHttpRequest=X;var OW=window.WebSocket;window.WebSocket=function(u,p){return new OW(r(u),p)};var OE=window.EventSource;window.EventSource=function(u,o){return new OE(r(u),o)};var OWk=window.Worker;window.Worker=function(u,o){return new OWk(r(u),o)};var OSW=window.SharedWorker;window.SharedWorker=function(u,o){return new OSW(r(u),o)};var oSet=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){var k=n.toLowerCase();if(['src','href','poster','data-src','data-href','srcset','action','formaction','manifest','icon','longdesc','cite'].indexOf(k)!==-1)arguments[1]=r(v);if(k==='style'&&typeof v==='string')arguments[1]=v.replace(/url\\(([^)]+)\\)/gi,function(_,u2){var uu=u2.replace(/['"]/g,'').trim();return 'url('+r(uu)+')'});return oSet.apply(this,arguments)};var origInner=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');Object.defineProperty(Element.prototype,'innerHTML',{set:function(v){var rew=String(v).replace(/(src|href|poster|data-src|data-href|srcset)=["']([^"']+)["']/gi,function(m,attr,val){return attr+'="'+r(val)+'"'}).replace(/style=("|')(.*?)\\1/gi,function(m,q,sv){return 'style="'+sv.replace(/url\\(([^)]+)\\)/gi,function(_,u3){return 'url('+r(u3.replace(/['"]/g,''))+')'})+'"'});origInner.set.call(this,rew)},get:function(){return origInner.get.call(this)}});var mo=new MutationObserver(function(ms){ms.forEach(m=>{if(m.addedNodes)m.addedNodes.forEach(n=>{if(n.nodeType===1){try{['src','href','poster','data-src','data-href','srcset'].forEach(a=>{if(n.hasAttribute&&n.hasAttribute(a))n.setAttribute(a,r(n.getAttribute(a)))});if(n.hasAttribute&&n.hasAttribute('style'))n.setAttribute('style',n.getAttribute('style').replace(/url\\(([^)]+)\\)/gi,function(_,u4){return 'url('+r(u4.replace(/['"]/g,''))+')'}));}catch(e){}}});}});mo.observe(document.documentElement||document.body||document,{childList:true,subtree:true});})();`;

module.exports = async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing ?url parameter");
  try {
    let cookies = [];
    if (req.headers.cookie) {
      try {
        const match = req.headers.cookie.match(/opulent_cookies=([^;]+)/);
        if (match) cookies = JSON.parse(decodeURIComponent(match[1]));
      } catch {}
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "OpulentAPI",
        "Cookie": cookies.join("; ")
      }
    });

    const contentType = response.headers.get("content-type") || "";
    res.setHeader("Content-Type", contentType);

    if (contentType.includes("text/html")) {
      let html = await response.text();
      const setCookie = response.headers.raw && response.headers.raw()['set-cookie'];
      if (setCookie) {
        const inject = `<script>localStorage.setItem("opulent_cookies", ${JSON.stringify(setCookie)});</script>`;
        html = inject + html;
      }
      html = `<script>${injectJS}</script>` + html;
      html = rewriteAll(html, contentType, "https://" + req.headers.host, url);
      res.end(html);
      return;
    }

    if (contentType.includes("text/css")) {
      const css = await response.text();
      const out = rewriteAll(css, contentType, "https://" + req.headers.host, url);
      res.end(out);
      return;
    }

    if (contentType.includes("javascript") || contentType.includes("ecmascript") || contentType.includes("application/javascript") || contentType.includes("text/javascript")) {
      const js = await response.text();
      const out = rewriteAll(js, contentType, "https://" + req.headers.host, url);
      res.end(out);
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  } catch (err) {
    res.status(500).end("Proxy error: " + err.message);
  }
};
