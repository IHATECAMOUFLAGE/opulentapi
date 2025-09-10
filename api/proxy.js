import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

let injectJS = '';
try {
  injectJS = fs.readFileSync(path.join(process.cwd(), 'lib/rewriter/inject.js'), 'utf8');
} catch(e){}

const urlDecodeMap = {
  "%20": " ", "%21": "!", "%22": '"', "%23": "#", "%24": "$", "%25": "%",
  "%26": "&", "%27": "'", "%28": "(", "%29": ")", "%2A": "*", "%2B": "+",
  "%2C": ",", "%2D": "-", "%2E": ".", "%2F": "/", "%30": "0", "%31": "1",
  "%32": "2", "%33": "3", "%34": "4", "%35": "5", "%36": "6", "%37": "7",
  "%38": "8", "%39": "9", "%3A": ":", "%3B": ";", "%3C": "<", "%3D": "=",
  "%3E": ">", "%3F": "?", "%40": "@", "%41": "A", "%42": "B", "%43": "C",
  "%44": "D", "%45": "E", "%46": "F", "%47": "G", "%48": "H", "%49": "I",
  "%4A": "J", "%4B": "K", "%4C": "L", "%4D": "M", "%4E": "N", "%4F": "O",
  "%50": "P", "%51": "Q", "%52": "R", "%53": "S", "%54": "T", "%55": "U",
  "%56": "V", "%57": "W", "%58": "X", "%59": "Y", "%5A": "Z", "%5B": "[",
  "%5C": "\\", "%5D": "]", "%5E": "^", "%5F": "_", "%60": "`", "%61": "a",
  "%62": "b", "%63": "c", "%64": "d", "%65": "e", "%66": "f", "%67": "g",
  "%68": "h", "%69": "i", "%6A": "j", "%6B": "k", "%6C": "l", "%6D": "m",
  "%6E": "n", "%6F": "o", "%70": "p", "%71": "q", "%72": "r", "%73": "s",
  "%74": "t", "%75": "u", "%76": "v", "%77": "w", "%78": "x", "%79": "y",
  "%7A": "z", "%7B": "{", "%7C": "|", "%7D": "}", "%7E": "~"
};

function decodeProxyURL(str){
  return str.replace(/%[0-9A-F]{2}/gi, match => urlDecodeMap[match] || match);
}

export default async function handler(req, res){
  if(req.method === 'OPTIONS'){
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, User-Agent, Referer");
    return res.status(204).end();
  }

  let { url } = req.query;
  if(!url) return res.status(400).send("Missing `url` query parameter.");

  try{
    url = decodeURIComponent(url);
    const agent = new https.Agent({ rejectUnauthorized: false });
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(url);
    const isBinary = /\.(woff2?|ttf|eot|otf|ico)$/i.test(url);
    const isJson = /\.json$/i.test(url);
    const isJs = /\.js$/i.test(url);

    const response = await axios.get(url, {
      httpsAgent: agent,
      responseType: isImage || isBinary ? 'arraybuffer' : 'text',
      timeout: 30000,
      headers: {
        'User-Agent': req.headers['user-agent'] || '',
        'Accept': '*/*'
      }
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", contentType);
    const headers = {...response.headers};
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];
    delete headers['x-frame-options'];
    for(const [key, value] of Object.entries(headers)) res.setHeader(key, value);

    if(isImage || isBinary) return res.status(response.status).send(Buffer.from(response.data));
    if(isJson) return res.status(response.status).json(response.data);

    let data = response.data;

    if(!isJs && contentType.includes('text/html')){
      const baseUrl = new URL(url);

      data = data.replace(/(src|href|srcset|poster)=["']([^"']+)["']/gi, (match, attr, link)=>{
        try{
          if(link.startsWith('data:') || link.startsWith('mailto:') || link.startsWith('javascript:')) return match;
          const absolute = new URL(link, baseUrl).toString();
          return `${attr}="/api/proxy?url=${encodeURIComponent(absolute)}"`;
        }catch(e){return match;}
      });

      data = data.replace('loading="lazy"', 'loading="eager"');

      const redirectPatterns = [
        /(?:window\.|top\.|document\.)?location(?:\.href)?\s*=\s*["'`](.*?)["'`]/gi,
        /window\.open\s*\(\s*["'`](.*?)["'`]\s*(,.*?)?\)/gi
      ];

      for(const pattern of redirectPatterns){
        data = data.replace(pattern, (...args)=>{
          let link = args[1], extra = args[2] || '';
          try{
            const target = new URL(link||'.', baseUrl).toString();
            const proxied = `/api/proxy?url=${encodeURIComponent(target)}`;
            return pattern.source.startsWith("window.open") ? `window.open('${proxied}'${extra})` : `window.location='${proxied}'`;
          }catch(e){return args[0];}
        });
      }

      data = data.replace(/<\/body>/i, `<script>${injectJS}</script></body>`);

      data = data.replace(/(--background-image\s*:\s*url\(["']?)([^"')]+)(["']?\))/g, (match,prefix,url,suffix)=>{
        if(url.startsWith('http')) return match;
        const proxied = `/api/proxy?url=${encodeURIComponent(new URL(url, baseUrl).toString())}`;
        return `${prefix}${proxied}${suffix}`;
      });

      data = data.replace(/url\(["']?(?!data:|http|\/\/)([^"')]+)["']?\)/gi, (match, rel)=>{
        const absolute = new URL(rel, baseUrl).toString();
        return `url('/api/proxy?url=${encodeURIComponent(absolute)}')`;
      });

      data = data.replace(/<iframe\s+[^>]*src=["'](.*?)["'][^>]*>/gi,(match,link)=>{
        try{
          const target = new URL(link||'.', baseUrl).toString();
          return match.replace(link, `/api/proxy?url=${encodeURIComponent(target)}`);
        }catch(e){return match;}
      });

      data = data.replace(/href=["'](https?:\/\/[^"']+)["']/gi,(match,link)=>{
        try{
          return `href="/api/proxy?url=${encodeURIComponent(link)}"`;
        }catch(e){return match;}
      });

      data = decodeProxyURL(data);
    }

    return res.status(response.status).send(data);

  }catch(err){
    return res.status(500).send(`<h1>Proxy Error</h1><p>${err.message}</p>`);
  }
}
