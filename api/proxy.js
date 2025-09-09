const fetch = require("node-fetch");
const { rewriteHTML } = require("../lib/rewriter/html");
const { rewriteCSS } = require("../lib/rewriter/css");
const { rewriteJS } = require("../lib/rewriter/js");

const injectJSCode = `(function(){
var erudaScript=document.createElement('script');
erudaScript.src='https://cdn.jsdelivr.net/npm/eruda';
erudaScript.onload=function(){eruda.init();};
document.head.appendChild(erudaScript);
function rewriteURL(url){if(!url||url.startsWith('data:')||url.startsWith('javascript:'))return url;return window.location.origin+'/api/proxy?url='+encodeURIComponent(url);}
var originalFetch=window.fetch;
window.fetch=function(input,init){if(typeof input==='string')input=rewriteURL(input);return originalFetch(input,init);};
var originalXHR=window.XMLHttpRequest;
function XHRProxy(){var xhr=new originalXHR();var open=xhr.open;xhr.open=function(method,url,async,user,pass){arguments[1]=rewriteURL(url);return open.apply(xhr,arguments);};return xhr;}
window.XMLHttpRequest=XHRProxy;
var OriginalWebSocket=window.WebSocket;
window.WebSocket=function(url,protocols){return new OriginalWebSocket(rewriteURL(url),protocols);};
var OriginalEventSource=window.EventSource;
window.EventSource=function(url,options){return new OriginalEventSource(rewriteURL(url),options);};
var OriginalWorker=window.Worker;
window.Worker=function(scriptURL,options){return new OriginalWorker(rewriteURL(scriptURL),options);};
var OriginalSharedWorker=window.SharedWorker;
window.SharedWorker=function(scriptURL,options){return new OriginalSharedWorker(rewriteURL(scriptURL),options);};
var originalImportScripts=self.importScripts;
self.importScripts=function(...urls){urls=urls.map(rewriteURL);return originalImportScripts.apply(self,urls);};
var originalEval=window.eval;
window.eval=function(code){return originalEval(code);};
var OriginalFunction=window.Function;
window.Function=function(...args){var last=args.pop();args.push(last);return OriginalFunction.apply(this,args);};
function patchElement(element){var origInnerHTML=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');Object.defineProperty(element,'innerHTML',{set:function(value){var rewritten=value.replace(/(src|href|poster|data-src|srcset)=["']([^"']+)["']/gi,function(m,attr,val){return attr+'="'+rewriteURL(val)+'"';});origInnerHTML.set.call(this,rewritten);},get:function(){return origInnerHTML.get.call(this);}});}
document.querySelectorAll('*').forEach(patchElement);
var observer=new MutationObserver(mutations=>{mutations.forEach(m=>{if(m.addedNodes)m.addedNodes.forEach(n=>{if(n.nodeType===1)patchElement(n);});});});
observer.observe(document.documentElement,{childList:true,subtree:true});
})();`;

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
        "User-Agent": req.headers["user-agent"],
        "Cookie": cookies.join("; ")
      }
    });

    const contentType = response.headers.get("content-type") || "";
    res.setHeader("Content-Type", contentType);

    if (contentType.includes("text/html")) {
      let html = await response.text();

      const setCookie = response.headers.raw()['set-cookie'];
      if (setCookie) {
        const inject = `<script>localStorage.setItem("opulent_cookies", ${JSON.stringify(setCookie)});</script>`;
        html = inject + html;
      }

      html = `<script>${injectJSCode}</script>` + html;
      html = rewriteHTML(html, "https://" + req.headers.host, url);
      res.end(html);
    } else if (contentType.includes("text/css")) {
      const css = await response.text();
      res.end(await rewriteCSS(css, "https://" + req.headers.host, url));
    } else if (contentType.includes("javascript") || contentType.includes("text/javascript")) {
      const js = await response.text();
      res.end(rewriteJS(js, "https://" + req.headers.host, url));
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.end(buffer);
    }
  } catch (err) {
    res.status(500).end("Proxy error: " + err.message);
  }
};
