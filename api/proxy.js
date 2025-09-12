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

  const isRaw = url.includes('###RAWHTML###');
  url = decodeURIComponent(url.replace('###RAWHTML###', ''));

  const agent = new https.Agent({ rejectUnauthorized: false });
  const proxyBase = '/api/proxy?url=';

  let response;
  try {
    response = await axios.get(url, {
      httpsAgent: agent,
      responseType: 'text',
      timeout: 30000,
      headers: {
        'User-Agent': req.headers['user-agent'] || '',
        'Accept': '*/*',
      },
      maxRedirects: 0,
      validateStatus: (status) => true,
    });
  } catch (e) {
    return res.status(500).send('Fetch error: ' + e.message);
  }

  const headers = { ...response.headers };
  delete headers['content-security-policy'];
  delete headers['content-security-policy-report-only'];
  delete headers['x-frame-options'];

  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  if (headers['location']) {
    try {
      const absolute = new URL(headers['location'], url).toString();
      res.setHeader('location', proxyBase + encodeURIComponent(absolute));
    } catch (e) {}
  }

  let data = response.data;
  const baseUrl = new URL(url);

  // Rewrite all standard tags
  data = data.replace(
    /(src|href|srcset|poster|action|formaction)=["']([^"']+)["']/gi,
    (match, attr, link) => {
      if (!link || link.startsWith('data:') || link.startsWith('mailto:') || link.startsWith('javascript:') || link.includes(proxyBase)) return match;
      const absolute = new URL(link, baseUrl).toString();
      return `${attr}="${proxyBase}${encodeURIComponent(absolute)}"`;
    }
  );

  data = data.replace(/<form[^>]*action=["']([^"']+)["']/gi, (match, link) => {
    if (!link || link.startsWith('javascript:') || link.startsWith('mailto:') || link.includes(proxyBase)) return match;
    const absolute = new URL(link, baseUrl).toString();
    return match.replace(link, `${proxyBase}${encodeURIComponent(absolute)}`);
  });

  // Rewrite inline CSS urls
  data = data.replace(/url\(["']?(?!data:|http|\/\/)([^"')]+)["']?\)/gi, (match, relativePath) => {
    const absolute = new URL(relativePath, baseUrl).toString();
    return `url('${proxyBase}${encodeURIComponent(absolute)}')`;
  });

  // Rewrite <link rel="stylesheet">
  data = data.replace(
    /<link\s+([^>]*?)href=["']([^"']+)["']([^>]*)>/gi,
    (match, pre, href, post) => {
      if (!href || href.startsWith('data:') || href.startsWith('javascript:')) return match;
      const absolute = new URL(href, baseUrl).toString();
      return `<link ${pre} href="${proxyBase}${encodeURIComponent(absolute)}"${post}>`;
    }
  );

  // Rewrite @import inside <style>
  data = data.replace(/@import\s+["']([^"']+)["']/gi, (match, href) => {
    if (!href || href.startsWith('data:') || href.startsWith('http') || href.startsWith('//')) return match;
    const absolute = new URL(href, baseUrl).toString();
    return `@import "${proxyBase}${encodeURIComponent(absolute)}"`;
  });

  if (injectJS) data = data.replace(/<\/head>/i, `<script>${injectJS}</script></head>`);

  if (isRaw) {
    return res.status(response.status).send(data);
  }

  const blobWrapper = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Proxied Page</title>
</head>
<body style="margin:0;padding:0;overflow:hidden;">
<script>
  const html = \`${data.replace(/`/g,'\\`')}\`;
  const blob = new Blob([html], {type:'text/html'});
  const iframe = document.createElement('iframe');
  iframe.src = URL.createObjectURL(blob);
  iframe.style.width='100%';
  iframe.style.height='100vh';
  iframe.style.border='none';
  document.body.appendChild(iframe);
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }
</script>
</body>
</html>`;

  return res.status(response.status).send(blobWrapper);
}
