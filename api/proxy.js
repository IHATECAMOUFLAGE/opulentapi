import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

let injectJS = '';
try {
  injectJS = fs.readFileSync(path.join(process.cwd(), 'lib/rewriter/inject.js'), 'utf8');
} catch {}

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

  html = html.replace(/<a\s+[^>]*href=["']([^"']+)["']/gi, (m, href) => {
    if (!href || href.startsWith('javascript:') || href.startsWith('data:') || href.startsWith('/api/proxy')) return m;
    try {
      const absolute = new URL(href, baseUrl).toString();
      return m.replace(href, `/api/proxy?url=${encodeURIComponent(absolute)}`);
    } catch { return m; }
  });

  html = html.replace(/<form\s+([^>]*action=["'][^"']+["'][^>]*)>/gi, (m) => {
    return m.replace(/action=["']([^"']+)["']/i, (am, action) => {
      if (!action || action.startsWith('javascript:') || action.startsWith('/api/proxy')) return am;
      try {
        const absolute = new URL(action, baseUrl).toString();
        return `action="/api/proxy?url=${encodeURIComponent(absolute)}"`;
      } catch { return am; }
    });
  });

  html = html.replace(/(window|top|document)\.location(\.href)?\s*=\s*['"]([^'"]+)['"]/gi, (m, w, h, url) => {
    try {
      const absolute = new URL(url, baseUrl).toString();
      return `${w}.location.href='/api/proxy?url=${encodeURIComponent(absolute)}'`;
    } catch { return m; }
  });

  html = html.replace(/window\.open\s*\(\s*['"]([^'"]+)['"]/gi, (m, url) => {
    try {
      const absolute = new URL(url, baseUrl).toString();
      return `window.open('/api/proxy?url=${encodeURIComponent(absolute)}'`;
    } catch { return m; }
  });

  return html;
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

  try { targetUrl = decodeURIComponent(targetUrl); } 
  catch { return res.status(400).send("Invalid URL encoding."); }

  try {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const isImage = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff)$/i.test(targetUrl);
    const isBinary = /\.(woff2?|ttf|eot|otf)$/i.test(targetUrl);
    const isJs = /\.js$/i.test(targetUrl);
    const isJson = /\.json$/i.test(targetUrl);

    const response = await axios.get(targetUrl, {
      httpsAgent: agent,
      responseType: isImage || isBinary ? 'arraybuffer' : 'text',
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

    if (isImage || isBinary) {
      const buffer = Buffer.from(response.data);
      res.setHeader('Content-Length', buffer.length);
      return res.status(response.status).send(buffer);
    }

    if (isJson) return res.status(response.status).json(response.data);

    let data = response.data;

    if (isRaw) {
      const escaped = data.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      return res.status(response.status).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Raw HTML</title><style>body{background:#111;color:#0f0;font-family:monospace;padding:20px;white-space:pre-wrap;}</style></head><body><pre>${escaped}</pre></body></html>`);
    }

    if (!isJs && contentType.includes('text/html')) {
      const baseUrl = new URL(targetUrl);
      data = rewriteHTML(data, baseUrl);
      if (injectJS) data = data.replace(/<\/head>/i, `<script>${injectJS}</script></head>`);
    }

    return res.status(response.status).send(data);
  } catch (e) {
    return res.status(500).send("Fetch error: " + e.message);
  }
}
