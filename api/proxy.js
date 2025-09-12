import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

let injectJS = '';
try {
  injectJS = fs.readFileSync(path.join(process.cwd(), 'lib/rewriter/inject.js'), 'utf8');
} catch(e) {}

export default async function handler(req,res){
if(req.method==='OPTIONS'){
res.setHeader("Access-Control-Allow-Origin","*");
res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers","Content-Type, User-Agent, Referer");
return res.status(204).end();
}
let targetUrl=req.query.raw||req.query.url;
if(!targetUrl) return res.status(400).send("Missing `url` or `raw` query parameter.");
targetUrl=decodeURIComponent(targetUrl);
const isRaw=!!req.query.raw;
const agent=new https.Agent({rejectUnauthorized:false});
let isBinary=/\.(png|jpe?g|gif|webp|bmp|svg|woff2?|ttf|eot|otf|ico)$/i.test(targetUrl);
let isJs=/\.js$/i.test(targetUrl);
let isJson=/\.json$/i.test(targetUrl);
let response;
try{
response=await axios.get(targetUrl,{
httpsAgent:agent,
responseType:isBinary?'arraybuffer':'text',
timeout:30000,
headers:{
'User-Agent':req.headers['user-agent']||'',
'Accept':'*/*'
}
});
}catch(e){
return res.status(500).send("Fetch error: "+e.message);
}
const contentType=response.headers['content-type']||'application/octet-stream';
res.setHeader("Access-Control-Allow-Origin","*");
res.setHeader("Content-Type",contentType);
const headers={...response.headers};
delete headers['content-security-policy'];
delete headers['content-security-policy-report-only'];
delete headers['x-frame-options'];
for(const[key,value]of Object.entries(headers))res.setHeader(key,value);
if(isBinary)return res.status(response.status).send(Buffer.from(response.data));
if(isJson)return res.status(response.status).json(response.data);
let data=response.data;
if(isRaw){
const escaped=data.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const htmlCodePage=`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Raw HTML</title>
<style>
body{background:#111;color:#0f0;font-family:monospace;padding:20px;white-space:pre-wrap;}
</style>
</head>
<body><pre>${escaped}</pre></body>
</html>`;
return res.status(response.status).send(htmlCodePage);
}
if(!isJs&&contentType.includes('text/html')){
const baseUrl=new URL(targetUrl);
data=data.replace(/(src|href|srcset|poster|action|formaction)=["']([^"']+)["']/gi,(m,attr,link)=>{
if(!link||link.startsWith('data:')||link.startsWith('mailto:')||link.startsWith('javascript:'))return m;
const absolute=new URL(link,baseUrl).toString();
return`${attr}="/api/proxy?url=${encodeURIComponent(absolute)}"`;
});
data=data.replace(/<form[^>]*action=["']([^"']+)["']/gi,(m,link)=>{
if(!link||link.startsWith('javascript:')||link.startsWith('mailto:'))return m;
const absolute=new URL(link,baseUrl).toString();
return m.replace(link,`/api/proxy?url=${encodeURIComponent(absolute)}`);
});
data=data.replace(/url\(["']?(?!data:|http|\/\/)([^"')]+)["']?\)/gi,(m,relativePath)=>{
const absolute=new URL(relativePath,baseUrl).toString();
return`url('/api/proxy?url=${encodeURIComponent(absolute)}')`;
});
if(injectJS)data=data.replace(/<\/head>/i,`<script>${injectJS}</script></head>`);
const wrappedHTML=`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Proxy Multi-Window</title>
<style>
body{margin:0;background:#111;color:#fff;font-family:sans-serif;overflow:hidden;}
#toolbar{display:flex;padding:10px;background:linear-gradient(90deg,#1a1a1a,#222);gap:10px;align-items:center;}
#urlInput{flex:1;background:#222;border:none;color:#fff;padding:6px 10px;border-radius:6px;outline:none;}
#addWindow{background:#333;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;transition:0.2s;}
#addWindow:hover{background:#444;}
#windowsContainer{position:absolute;top:50px;left:0;right:0;bottom:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:4px;}
.windowWrapper{position:relative;border:2px solid #333;border-radius:6px;overflow:hidden;}
.windowHeader{display:flex;align-items:center;padding:2px 6px;background:#222;color:#fff;cursor:default;}
.favicon{width:16px;height:16px;margin-right:6px;}
.windowLabel{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.windowFrame{width:100%;height:calc(100% - 24px);border:none;}
</style>
</head>
<body>
<div id="toolbar">
<input id="urlInput" type="text" value="${baseUrl.toString()}">
<button id="addWindow">Add Side Window</button>
</div>
<div id="windowsContainer">
<div class="windowWrapper">
<div class="windowHeader">
<img class="favicon" src="/api/proxy?url=${encodeURIComponent(baseUrl.origin)}/favicon.ico">
<span class="windowLabel">${baseUrl.hostname}</span>
</div>
<iframe class="windowFrame" src="/api/proxy?url=${encodeURIComponent(baseUrl.toString())}"></iframe>
</div>
</div>
<script>
const maxWindows=4;
function addWindow(url){
const container=document.getElementById('windowsContainer');
if(container.children.length>=maxWindows)return;
const wrapper=document.createElement('div');wrapper.className='windowWrapper';
const header=document.createElement('div');header.className='windowHeader';
const favicon=document.createElement('img');favicon.className='favicon';
try{favicon.src='/api/proxy?url='+encodeURIComponent(new URL(url).origin)+'/favicon.ico';}catch{}
const label=document.createElement('span');label.className='windowLabel';label.textContent=url;
header.appendChild(favicon);header.appendChild(label);
const iframe=document.createElement('iframe');iframe.className='windowFrame';
iframe.src='/api/proxy?url='+encodeURIComponent(url);
wrapper.appendChild(header);wrapper.appendChild(iframe);
container.appendChild(wrapper);
}
document.getElementById('addWindow').onclick=()=>{const url=document.getElementById('urlInput').value;addWindow(url);};
window.open=(url,name,opts)=>{addWindow(url);return null;};
</script>
</body>
</html>`;
return res.status(response.status).send(wrappedHTML);
}
return res.status(response.status).send(data);
}
