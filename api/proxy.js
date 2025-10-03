import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

let injectJS = '';
try {
  injectJS = fs.readFileSync(path.join(process.cwd(), 'lib/rewriter/inject.js'), 'utf8');
} catch (e) {}

function rewriteHTML(html, baseUrl) {
  html = html.replace(/(src|srcset|poster)=["']([^"']+)["']/gi, (m, attr, url) => {
    if (!url || url.startsWith('data:') || url.startsWith('/api/proxy') || url.startsWith('javascript:')) return m;
    try {
      const absolute = new URL(url, baseUrl).toString();
      return `${attr}="/api/proxy?url=${encodeURIComponent(absolute)}"`;
    } catch { return m; }
  });

  html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (m, url) => {
    if (!url || url.startsWith('data:') || url.startsWith('/api/proxy') || url.startsWith('javascript:')) return m;
    try {
      const absolute = new URL(url, baseUrl).toString();
      return `url('/api/proxy?url=${encodeURIComponent(absolute)}')`;
    } catch { return m; }
  });

  html = html.replace(/(--background-image\s*:\s*url\(["']?)([^"')]+)(["']?\))/gi, (m, prefix, url, suffix) => {
    if (!url || url.startsWith('data:') || url.startsWith('/api/proxy') || url.startsWith('javascript:')) return m;
    try {
      const absolute = new URL(url, baseUrl).toString();
      return `${prefix}/api/proxy?url=${encodeURIComponent(absolute)}${suffix}`;
    } catch { return m; }
  });

  const hostname = baseUrl.hostname.toLowerCase();
  if (hostname.includes('google.com')) {
    html = html.replace(/<form[^>]*role="search"[^>]*>([\s\S]*?)<\/form>/gi, (match, inner) => {
      inner = inner.replace(/<textarea[^>]*id="APjFqb"[^>]*>.*?<\/textarea>/i, `
        <input id="customSearch" type="text" placeholder="Search Google"
          style="width:100%; height:100%; background:transparent; border:none; outline:none; color:black; font-family:Roboto,Arial,sans-serif; font-size:16px; padding:0; margin:0;">
      `);
      return `<div style="width:100%; height:100%; position:relative;">${inner}</div>`;
    });

    html = html.replace(/<\/body>/i, `
      <script>
        window.addEventListener('DOMContentLoaded', function() {
          const input = document.querySelector('#customSearch');
          if(input){
            input.addEventListener('keydown', function(e){
              if(e.key==='Enter'){
                e.preventDefault();
                const q=input.value;
                if(q) alert('Proxy may redirect multiple times while loading.');
                window.location.href='/api/proxy?url='+encodeURIComponent('https://www.google.com/search?q='+q);
              }
            });
          }
        });
      </script>
    </body>`);
  }

  return html;
}

async function fetchWithAxios(targetUrl, req, res, baseUrl, options = {}) {
  const agent = new https.Agent({rejectUnauthorized:false});
  const isImage = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff)$/i.test(targetUrl);
  const isBinary = /\.(woff2?|ttf|eot|otf)$/i.test(targetUrl);
  const isJs = /\.js$/i.test(targetUrl);
  const isJson = /\.json$/i.test(targetUrl);

  const headers = {
    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Accept': isImage ? '*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
    'Referer': baseUrl.origin,
    'Origin': baseUrl.origin,
    'Connection': 'keep-alive',
    ...options.extraHeaders
  };

  const response = await axios.get(targetUrl, {
    httpsAgent: agent,
    responseType: isImage || isBinary ? 'arraybuffer' : 'text',
    timeout: 20000,
    headers
  });

  const contentType = response.headers['content-type'] || 'application/octet-stream';
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Content-Type", contentType);

  const responseHeaders = {...response.headers};
  delete responseHeaders['content-security-policy'];
  delete responseHeaders['content-security-policy-report-only'];
  delete responseHeaders['x-frame-options'];
  for(const [key,value] of Object.entries(responseHeaders)) try { res.setHeader(key,value); } catch(e) {}

  if(isImage || isBinary){
    const buffer = Buffer.from(response.data);
    res.setHeader('Content-Length', buffer.length);
    return res.status(response.status).send(buffer);
  }

  if(isJson) return res.status(response.status).json(response.data);

  let data = response.data;

  if(options.raw){
    const escaped = data.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    return res.status(response.status).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Raw HTML</title><style>body{background:#111;color:#0f0;font-family:monospace;padding:20px;white-space:pre-wrap;}</style></head><body><pre>${escaped}</pre></body></html>`);
  }

  if(!isJs && contentType.includes('text/html')){
    data = rewriteHTML(data, baseUrl);
    if(injectJS) data = data.replace(/<\/head>/i, `<script>${injectJS}</script></head>`);
  }

  return res.status(response.status).send(data);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, User-Agent, Referer");
    return res.status(204).end();
  }

  let targetUrl = req.query.raw || req.query.url;
  const pupUrl = req.query.pup || req.query.pupurl || req.query.pupUrl;
  const isRaw = !!req.query.raw;
  const usePuppeteer = !!pupUrl;

  try { targetUrl = decodeURIComponent(targetUrl || ''); } catch { }
  try { if (pupUrl) targetUrl = decodeURIComponent(pupUrl); } catch { }

  if(!targetUrl) return res.status(400).send("Missing `url`, `raw`, or `pup` query parameter.");

  let baseUrl;
  try { baseUrl = new URL(targetUrl); } catch { return res.status(400).send("Invalid URL."); }

  if (usePuppeteer) {
    let puppeteer;
    try {
      puppeteer = await import('puppeteer');
    } catch (err) {
      try {
        return await fetchWithAxios(targetUrl, req, res, baseUrl, { raw: isRaw, extraHeaders: {} });
      } catch (fallbackErr) {
        return res.status(500).send("Puppeteer not available and fallback failed: " + String(fallbackErr.message || fallbackErr));
      }
    }

    const isImage = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff)$/i.test(targetUrl);
    const isBinary = /\.(woff2?|ttf|eot|otf)$/i.test(targetUrl);
    if (isImage || isBinary) {
      return fetchWithAxios(targetUrl, req, res, baseUrl, { raw: isRaw });
    }

    let browser;
    try {
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true,
      });

      const page = await browser.newPage();

      const ua = req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
      await page.setUserAgent(ua);
      await page.setExtraHTTPHeaders({
        'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
        'Referer': baseUrl.origin
      });

      const resp = await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      if (!resp) {
        await browser.close();
        return fetchWithAxios(targetUrl, req, res, baseUrl, { raw: isRaw });
      }

      const status = resp.status();
      const respHeaders = resp.headers() || {};
      let contentType = respHeaders['content-type'] || 'text/html';
      let html = await page.content();

      await browser.close();

      res.setHeader("Access-Control-Allow-Origin","*");
      res.setHeader("Content-Type", contentType);

      const safeHeaders = {...respHeaders};
      delete safeHeaders['content-security-policy'];
      delete safeHeaders['content-security-policy-report-only'];
      delete safeHeaders['x-frame-options'];
      for(const [k,v] of Object.entries(safeHeaders)) try { res.setHeader(k, v); } catch(e) {}

      if (contentType.includes('text/html')) {
        html = rewriteHTML(html, baseUrl);
        if (injectJS) html = html.replace(/<\/head>/i, `<script>${injectJS}</script></head>`);
      }

      if (isRaw) {
        const escaped = html.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        return res.status(status).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Raw HTML</title><style>body{background:#111;color:#0f0;font-family:monospace;padding:20px;white-space:pre-wrap;}</style></head><body><pre>${escaped}</pre></body></html>`);
      }

      return res.status(status).send(html);

    } catch (e) {
      try { if (browser) await browser.close(); } catch(_) {}
      try {
        return await fetchWithAxios(targetUrl, req, res, baseUrl, { raw: isRaw });
      } catch (fallbackErr) {
        return res.status(500).send("Puppeteer fetch failed and fallback failed: " + String(fallbackErr.message || fallbackErr));
      }
    }
  }

  try {
    return await fetchWithAxios(targetUrl, req, res, baseUrl, { raw: isRaw });
  } catch (e) {
    return res.status(500).send("Fetch error: " + String(e.message || e));
  }
}
