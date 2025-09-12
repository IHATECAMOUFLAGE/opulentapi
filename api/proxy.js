import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

let injectJS = '';
try {
  injectJS = fs.readFileSync(path.join(process.cwd(), 'lib/rewriter/inject.js'), 'utf8');
} catch (e) {}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent, Referer');
    return res.status(204).end();
  }

  let { url } = req.query;
  if (!url) return res.status(400).send('Missing `url` query parameter.');
  url = decodeURIComponent(url);

  const agent = new https.Agent({ rejectUnauthorized: false });

  let isBinary = /\.(png|jpe?g|gif|webp|bmp|svg|woff2?|ttf|eot|otf|ico)$/i.test(url);
  let isJs = /\.js$/i.test(url);
  let isJson = /\.json$/i.test(url);

  let response;
  try {
    response = await axios.get(url, {
      httpsAgent: agent,
      responseType: isBinary ? 'arraybuffer' : 'text',
      timeout: 30000,
      headers: {
        'User-Agent': req.headers['user-agent'] || '',
        'Accept': '*/*',
      },
    });
  } catch (e) {
    return res.status(500).send('Fetch error: ' + e.message);
  }

  const contentType = response.headers['content-type'] || 'application/octet-stream';
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', contentType);

  const headers = { ...response.headers };
  delete headers['content-security-policy'];
  delete headers['content-security-policy-report-only'];
  delete headers['x-frame-options'];
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  if (isBinary) {
    return res.status(response.status).send(Buffer.from(response.data));
  }

  if (isJson) {
    return res.status(response.status).json(response.data);
  }

  let data = response.data;
  const proxyBase = '/api/proxy?url=';

  if (!isJs && contentType.includes('text/html')) {
    const baseUrl = new URL(url);

    data = data.replace(
      /(src|href|srcset|poster|action|formaction)=["']([^"']+)["']/gi,
      (match, attr, link) => {
        if (
          !link ||
          link.startsWith('data:') ||
          link.startsWith('mailto:') ||
          link.startsWith('javascript:') ||
          link.includes(proxyBase)
        )
          return match;
        const absolute = new URL(link, baseUrl).toString();
        return `${attr}="${proxyBase}${encodeURIComponent(absolute)}"`;
      }
    );

    data = data.replace(/<form[^>]*action=["']([^"']+)["']/gi, (match, link) => {
      if (
        !link ||
        link.startsWith('javascript:') ||
        link.startsWith('mailto:') ||
        link.includes(proxyBase)
      )
        return match;
      const absolute = new URL(link, baseUrl).toString();
      return match.replace(link, `${proxyBase}${encodeURIComponent(absolute)}`);
    });

    data = data.replace(
      /url\(["']?(?!data:|http|\/\/)([^"')]+)["']?\)/gi,
      (match, relativePath) => {
        const absolute = new URL(relativePath, baseUrl).toString();
        return `url('${proxyBase}${encodeURIComponent(absolute)}')`;
      }
    );

    data = data.replace(
      /<\/head>/i,
      `<script>${injectJS}</script><script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}</script></head>`
    );
  }

  return res.status(response.status).send(data);
}
