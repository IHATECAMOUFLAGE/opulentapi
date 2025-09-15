import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

let injectJS = '';
try {
  injectJS = fs.readFileSync(path.join(process.cwd(), 'lib/rewriter/inject.js'), 'utf8');
} catch (e) {}

function decodeBrave(url) {
  if (!url.startsWith("https://imgs.search.brave.com/")) return url;
  try {
    const parts = url.split("/");
    const b64 = parts[parts.length - 1];
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    if (decoded.startsWith("http")) return decoded;
  } catch {}
  return url;
}

function isImage(url) {
  return /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff)$/i.test(url);
}

function rewriteContent(content, baseUrl) {
  content = content.replace(/(src|srcset|data-src|poster|href|action|formaction)=["']([^"']+)["']/gi, (m, attr, link) => {
    if (!link || link.startsWith('data:') || link.startsWith('mailto:') || link.startsWith('javascript:')) return m;
    let absolute = new URL(link, baseUrl).toString();
    absolute = decodeBrave(absolute);
    return `${attr}="/api/proxy?url=${encodeURIComponent(absolute)}"`;
  });

  content = content.replace(/url\(["']?([^"')]+)["']?\)/gi, (m, url) => {
    if (url.startsWith('data:')) return m;
    let absolute = new URL(url, baseUrl).toString();
    absolute = decodeBrave(absolute);
    return `url('/api/proxy?url=${encodeURIComponent(absolute)}')`;
  });

  content = content.replace(/(["'])(\/?[^"']+\.(?:png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff))\1/gi, (full, q, link) => {
    let absolute = new URL(link, baseUrl).toString();
    absolute = decodeBrave(absolute);
    return `"${'/api/proxy?url=' + encodeURIComponent(absolute)}"`;
  });

  content = content.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (m, js) => {
    const rewritten = js.replace(/(["'])(\/?[^"']+\.(?:png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff))\1/gi, (full, q, link) => {
      let absolute = new URL(link, baseUrl).toString();
      absolute = decodeBrave(absolute);
      return `"${'/api/proxy?url=' + encodeURIComponent(absolute)}"`;
    });
    return m.replace(js, rewritten);
  });

  content = content.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, css) => {
    const rewritten = css.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
      if (url.startsWith('data:')) return match;
      let absolute = new URL(url, baseUrl).toString();
      absolute = decodeBrave(absolute);
      return `url('/api/proxy?url=${encodeURIComponent(absolute)}')`;
    });
    return m.replace(css, rewritten);
  });

  return content;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, User-Agent, Referer");
    return res.status(204).end();
  }

  let targetUrl = req.query.raw || req.query.url;
  if (!targetUrl) return res.status(400).send("Missing `url` or `raw` query parameter.");

  const isRaw = !!req.query.raw;

  try {
    targetUrl = decodeURIComponent(targetUrl);
  } catch {
    return res.status(400).send("Invalid URL encoding.");
  }

  let response;
  try {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const isBinary = /\.(png|jpe?g|gif|webp|bmp|svg|woff2?|ttf|eot|otf|ico|avif|tiff)$/i.test(targetUrl);
    const isJs = /\.js$/i.test(targetUrl);
    const isJson = /\.json$/i.test(targetUrl);
    const isCss = /\.css$/i.test(targetUrl);

    response = await axios.get(targetUrl, {
      httpsAgent: agent,
      responseType: isBinary ? 'arraybuffer' : 'text',
      timeout: 20000,
      headers: { 'User-Agent': req.headers['user-agent'] || '', 'Accept': '*/*' }
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", contentType);
    const headers = { ...response.headers };
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];
    delete headers['x-frame-options'];
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);

    let data = response.data;

    if (isRaw) {
      const escaped = data
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      return res.status(response.status).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Raw HTML</title><style>body{background:#111;color:#0f0;font-family:monospace;padding:20px;white-space:pre-wrap;}</style></head><body><pre>${escaped}</pre></body></html>`);
    }

    if (isBinary) return res.status(response.status).send(Buffer.from(response.data));
    if (isJson) return res.status(response.status).json(response.data);

    if ((isCss || contentType.includes('text/css')) && !isBinary) {
      const baseUrl = new URL(targetUrl);
      data = rewriteContent(data, baseUrl);
    }

    if (!isJs && contentType.includes('text/html')) {
      const baseUrl = new URL(targetUrl);
      data = rewriteContent(data, baseUrl);
      data = data.replace(/<\/body>/i, `
        <script>
          window.addEventListener('DOMContentLoaded', function() {
            function rewriteDynamicImages() {
              const imgs = document.querySelectorAll('img');
              imgs.forEach(img => {
                if(img.src && !img.src.includes('/api/proxy?url=')) {
                  try { img.src = '/api/proxy?url=' + encodeURIComponent(new URL(img.src, window.location.href).toString()); } catch{}
                }
              });
              const elements = document.querySelectorAll('*');
              elements.forEach(el => {
                const style = getComputedStyle(el);
                if(!style) return;
                const bg = style.backgroundImage;
                if(bg && bg.startsWith('url(') && !bg.includes('/api/proxy?url=')) {
                  const url = bg.slice(4,-1).replace(/["']/g,'');
                  try { el.style.backgroundImage = 'url(/api/proxy?url=' + encodeURIComponent(new URL(url, window.location.href).toString()) + ')'; } catch{}
                }
              });
            }
            rewriteDynamicImages();
            const observer = new MutationObserver(rewriteDynamicImages);
            observer.observe(document.body, { childList:true, subtree:true, attributes:true });
          });
        </script>
      </body>`);
      if (injectJS) data = data.replace(/<\/head>/i, `<script>${injectJS}</script></head>`);
    }

    return res.status(response.status).send(data);

  } catch (e) {
    return res.status(500).send("Fetch error: " + e.message);
  }
}
