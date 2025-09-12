import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

let injectJS='';
try{injectJS=fs.readFileSync(path.join(process.cwd(),'lib/rewriter/inject.js'),'utf8');}catch(e){}

async function fetchFaviconAndTitle(url){
try{
const res=await axios.get(url,{httpsAgent:new https.Agent({rejectUnauthorized:false}),timeout:10000,headers:{'User-Agent':'Mozilla/5.0'}});
const html=res.data;
const titleMatch=html.match(/<title>(.*?)<\/title>/i);
const iconMatch=html.match(/<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["']/i);
return{title:titleMatch?titleMatch[1]:url,favicon:iconMatch?new URL(iconMatch[1],url).toString():url+'/favicon.ico'};
}catch(e){return{title:url,favicon:url+'/favicon.ico'};}
}

function rewriteHTML(html,baseUrl){
html=html.replace(/(src|href|srcset|poster|action|formaction)=["']([^"']+)["']/gi,(m,attr,link)=>{if(!link||link.startsWith('data:')||link.startsWith('mailto:')||link.startsWith('javascript:'))return m;const absolute=new URL(link,baseUrl).toString();return`${attr}="/api/proxy?url=${encodeURIComponent(absolute)}"`;});
html=html.replace(/url\(["']?(?!data:|http|\/\/)([^"')]+)["']?\)/gi,(m,relativePath)=>{const absolute=new URL(relativePath,baseUrl).toString();return`url('/api/proxy?url=${encodeURIComponent(absolute)}')`;});
return html;
}

export default async function handler(req,res){
if(req.method==='OPTIONS'){
res.setHeader("Access-Control-Allow-Origin","*");
res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers","Content-Type, User-Agent, Referer");
return res.status(204).end();
}

let targetUrl=req.query.raw||req.query.url;
if(!targetUrl)return res.status(400).send("Missing `url` or `raw` query parameter.");
targetUrl=decodeURIComponent(targetUrl);
const isRaw=!!req.query.raw;
const agent=new https.Agent({rejectUnauthorized:false});
let isBinary=/\.(png|jpe?g|gif|webp|bmp|svg|woff2?|ttf|eot|otf|ico)$/i.test(targetUrl);
let isJs=/\.js$/i.test(targetUrl);
let isJson=/\.json$/i.test(targetUrl);
let response;
try{
response=await axios.get(targetUrl,{httpsAgent:agent,responseType:isBinary?'arraybuffer':'text',timeout:30000,headers:{'User-Agent':req.headers['user-agent']||'','Accept':'*/*'}});
}catch(e){return res.status(500).send("Fetch error: "+e.message);}
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
return res.status(response.status).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Raw HTML</title><style>body{background:#111;color:#0f0;font-family:monospace;padding:20px;white-space:pre-wrap;}</style></head><body><pre>${escaped}</pre></body></html>`);
}
if(!isJs&&contentType.includes('text/html')){
const baseUrl=new URL(targetUrl);
data=rewriteHTML(data,baseUrl);
if(injectJS)data=data.replace(/<\/head>/i,`<script>${injectJS}</script></head>`);
const wrappedHTML=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Proxy</title><style>
body{margin:0;padding:0;overflow:hidden;font-family:sans-serif;background:#111;color:#fff;}
#menuButton{position:fixed;top:10px;right:10px;padding:6px 12px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;z-index:999;transition:0.2s;}
#menuButton:hover{background:#444;}
#menuDropdown{position:fixed;top:40px;right:10px;background:#222;border:1px solid #444;border-radius:6px;display:none;flex-direction:column;z-index:999;min-width:180px;}
.menuItem{padding:6px 10px;cursor:pointer;color:#fff;transition:0.2s;}
.menuItem:hover{background:#333;}
#windowsContainer{position:absolute;top:0;left:0;right:0;bottom:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:4px;pointer-events:none;}
.windowWrapper{position:relative;border:2px solid #333;border-radius:6px;overflow:hidden;pointer-events:auto;}
.windowHeader{display:flex;align-items:center;padding:2px 6px;background:#222;color:#fff;cursor:default;}
.favicon{width:16px;height:16px;margin-right:6px;}
.windowLabel{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.windowFrame{width:100%;height:calc(100% - 24px);border:none;}
iframe#mainProxy{position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;border:none;}
#chromeMenu{position:fixed;top:0;left:0;width:5px;height:100%;z-index:998;background:transparent;}
#appList{position:fixed;top:0;left:0;width:200px;height:100%;background:#222;display:none;flex-direction:column;overflow-y:auto;z-index:999;}
.appItem{padding:6px 10px;color:#fff;cursor:pointer;border-bottom:1px solid #333;}
.appItem:hover{background:#333;}
</style></head><body>
<div id="chromeMenu"></div><div id="appList"></div>
<button id="menuButton">☰ Menu</button>
<div id="menuDropdown"><div class="menuItem" id="addSideWindow">Add Side Window</div><div class="menuItem"><label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="editToggle"> Enable Editing</label></div></div>
<iframe id="mainProxy" src="/api/proxy?url=${encodeURIComponent(baseUrl.toString())}"></iframe>
<div id="windowsContainer"></div>
<script>
const menuButton=document.getElementById('menuButton');
const menuDropdown=document.getElementById('menuDropdown');
menuButton.onclick=(e)=>{e.stopPropagation();menuDropdown.style.display=menuDropdown.style.display==='flex'?'none':'flex';menuDropdown.style.flexDirection='column';};
document.addEventListener('click',(e)=>{if(!menuDropdown.contains(e.target)&&e.target!==menuButton)menuDropdown.style.display='none';});
const maxWindows=4;
let windows=[];
function addSideWindow(url){
if(windows.length>=maxWindows)return;
const container=document.getElementById('windowsContainer');
const wrapper=document.createElement('div');wrapper.className='windowWrapper';
const header=document.createElement('div');header.className='windowHeader';
const favicon=document.createElement('img');favicon.className='favicon';
const label=document.createElement('span');label.className='windowLabel';label.textContent=url;
const minimizeBtn=document.createElement('button');minimizeBtn.textContent='—';minimizeBtn.style.marginLeft='6px';
header.appendChild(favicon);header.appendChild(label);header.appendChild(minimizeBtn);
const iframe=document.createElement('iframe');iframe.className='windowFrame';iframe.src='/api/proxy?url='+encodeURIComponent(url);
wrapper.appendChild(header);wrapper.appendChild(iframe);
container.appendChild(wrapper);
windows.push({wrapper,label,iframe,favicon,url,minimized:false});
minimizeBtn.onclick=()=>{wrapper.style.display='none';windows.find(w=>w.wrapper===wrapper).minimized=true;updateAppList();};
updateWindowInfo(wrapper,url,favicon,label);
updateAppList();
}
async function updateWindowInfo(wrapper,url,favicon,label){
try{const res=await fetch('/api/proxy?url='+encodeURIComponent(url));const text=await res.text();const titleMatch=text.match(/<title>(.*?)<\/title>/i);const iconMatch=text.match(/<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["']/i);label.textContent=titleMatch?titleMatch[1]:url;favicon.src='/api/proxy?url='+encodeURIComponent(iconMatch?new URL(iconMatch[1],url).toString():url+'/favicon.ico');}catch(e){label.textContent=url;favicon.src='/api/proxy?url='+encodeURIComponent(url+'/favicon.ico');}}
function updateAppList(){const appList=document.getElementById('appList');appList.innerHTML='';windows.forEach(w=>{const item=document.createElement('div');item.className='appItem';item.textContent=w.label.textContent;item.onclick=()=>{w.wrapper.style.display='block';w.minimized=false;};appList.appendChild(item);});}
const chromeMenu=document.getElementById('chromeMenu');
const appList=document.getElementById('appList');
chromeMenu.addEventListener('mouseenter',()=>{appList.style.display='flex';});
chromeMenu.addEventListener('mouseleave',()=>{appList.style.display='none';});
document.getElementById('addSideWindow').onclick=()=>{const url=prompt('Enter URL for side window:');if(url)addSideWindow(url);};
const editToggle=document.getElementById('editToggle');
editToggle.onchange=()=>{const editable=editToggle.checked;windows.forEach(w=>{setEditable(w.iframe.contentDocument?.body,editable);});setEditable(document.getElementById('mainProxy').contentDocument?.body,editable);};
function setEditable(el,enabled){if(!el)return;if(el.id==='menuDropdown'||el.id==='menuButton'||el.classList.contains('windowHeader'))return;el.contentEditable=enabled;for(const child of el.children)setEditable(child,enabled);}
</script></body></html>`;
return res.status(response.status).send(wrappedHTML);
}
return res.status(response.status).send(data);
}
