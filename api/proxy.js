import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

let injectJS = '';
try {
  injectJS = fs.readFileSync(path.join(process.cwd(), 'lib/rewriter/inject.js'), 'utf8');
} catch (e) {}

function rewriteHTML(html, baseUrl) {
  html = html.replace(/(src|href|srcset|poster|action|formaction)=["']([^"']+)["']/gi, (m, attr, link) => {
    if (!link || link.startsWith('data:') || link.startsWith('mailto:') || link.startsWith('javascript:')) return m;
    const absolute = new URL(link, baseUrl).toString();
    return `${attr}="/api/proxy?url=${encodeURIComponent(absolute)}"`;
  });
  html = html.replace(/url\(["']?(?!data:|http|\/\/)([^"')]+)["']?\)/gi, (m, relativePath) => {
    const absolute = new URL(relativePath, baseUrl).toString();
    return `url('/api/proxy?url=${encodeURIComponent(absolute)}')`;
  });

  const hostname = baseUrl.hostname.toLowerCase();
  if (hostname === 'google.com' || hostname === 'www.google.com') {
    html = html.replace(/<form[^>]*>([\s\S]*?)<\/form>/i, (match, inner) => {
      return `<div onkeydown="if(event.key==='Enter'){event.preventDefault();var q=this.querySelector('input[name=q]').value;window.location='/api/proxy?url=https://www.google.com/search?q='+encodeURIComponent(q);}">${inner}</div>`;
    });
  }
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
  targetUrl = decodeURIComponent(targetUrl);
  const isRaw = !!req.query.raw;
  const agent = new https.Agent({ rejectUnauthorized: false });
  let isBinary = /\.(png|jpe?g|gif|webp|bmp|svg|woff2?|ttf|eot|otf|ico)$/i.test(targetUrl);
  let isJs = /\.js$/i.test(targetUrl);
  let isJson = /\.json$/i.test(targetUrl);
  let response;
  try {
    response = await axios.get(targetUrl, { httpsAgent: agent, responseType: isBinary ? 'arraybuffer' : 'text', timeout: 30000, headers: { 'User-Agent': req.headers['user-agent'] || '', 'Accept': '*/*' } });
  } catch (e) {
    return res.status(500).send("Fetch error: " + e.message);
  }

  const contentType = response.headers['content-type'] || 'application/octet-stream';
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", contentType);
  const headers = { ...response.headers };
  delete headers['content-security-policy'];
  delete headers['content-security-policy-report-only'];
  delete headers['x-frame-options'];
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);

  if (isBinary) return res.status(response.status).send(Buffer.from(response.data));
  if (isJson) return res.status(response.status).json(response.data);

  let data = response.data;

  if (isRaw) {
    const escaped = data.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return res.status(response.status).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Raw HTML</title><style>body{background:#111;color:#0f0;font-family:monospace;padding:20px;white-space:pre-wrap;}</style></head><body><pre>${escaped}</pre></body></html>`);
  }

  if (!isJs && contentType.includes('text/html')) {
    const baseUrl = new URL(targetUrl);
    data = rewriteHTML(data, baseUrl);
    if (injectJS) data = data.replace(/<\/head>/i, `<script>${injectJS}</script></head>`);
  }

  return res.status(response.status).send(data);
}
