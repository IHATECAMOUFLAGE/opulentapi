import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, User-Agent, Referer");
        return res.status(204).end();
    }

    let { url } = req.query;
    if (!url) return res.status(400).send("Missing `url` query parameter.");

    try {
        url = decodeURIComponent(url.trim().toLowerCase());
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

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
                'Accept': '*/*',
            },
        });

        const contentType = response.headers['content-type'] || 'application/octet-stream';
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", contentType);

        const headers = { ...response.headers };
        delete headers['content-security-policy'];
        delete headers['content-security-policy-report-only'];
        delete headers['x-frame-options'];
        for (const [key, value] of Object.entries(headers)) {
            res.setHeader(key, value);
        }

        if (isImage || isBinary) return res.status(response.status).send(Buffer.from(response.data));
        if (isJson) return res.status(response.status).json(response.data);

        let data = response.data;

        if (!isJs && contentType.includes('text/html')) {
            const baseUrl = new URL(url);

            data = data.replace(/(src|href|srcset|poster)=["']([^"']+)["']/gi, (match, attr, link) => {
                try {
                    if (/^(data:|mailto:|javascript:)/.test(link)) return match;
                    const absolute = new URL(link, baseUrl).toString();
                    return `${attr}="/api/camoapi?url=${encodeURIComponent(absolute)}"`;
                } catch { return match; }
            });

            data = data.replace(/url\(["']?(?!data:|http|\/\/)([^"')]+)["']?\)/gi, (match, relativePath) => {
                try {
                    const absolute = new URL(relativePath, baseUrl).toString();
                    return `url('/api/camoapi?url=${encodeURIComponent(absolute)}')`;
                } catch { return match; }
            });

            data = data.replace(/<iframe\s+[^>]*src=["'](.*?)["'][^>]*>/gi, (match, link) => {
                try {
                    const absolute = new URL(link, baseUrl).toString();
                    return match.replace(link, `/api/camoapi?url=${encodeURIComponent(absolute)}`);
                } catch { return match; }
            });

            data = data.replace(/window\.location\s*=\s*["'](.*?)["']/gi, (match, link) => {
                try {
                    const absolute = new URL(link, baseUrl).toString();
                    return `window.location='/api/camoapi?url=${encodeURIComponent(absolute)}'`;
                } catch { return match; }
            });

            data = data.replace(/window\.open\s*\(\s*["'](.*?)["']\s*(,.*)?\)/gi, (match, link, extra) => {
                try {
                    const absolute = new URL(link, baseUrl).toString();
                    return `window.open('/api/camoapi?url=${encodeURIComponent(absolute)}'${extra || ''})`;
                } catch { return match; }
            });

            data = data.replace(/<\/body>/i, `
                <script src="https://cdn.jsdelivr.net/npm/eruda"></script>
                <script>eruda.init();</script>
            </body>`);

            if (url.includes('google.com/search')) {
                const formRegex = /<form\s+class="tsf"[^>]*role="search"[^>]*>[\s\S]*?<\/form>/i;
                data = data.replace(formRegex, '');
                return res.send(`
                    <body>
                        <script>
                            alert('Google may load multiple times before succeeding.');
                            window.location.href = '/api/camoapi?url=' + encodeURIComponent(${JSON.stringify(url)});
                        </script>
                    </body>
                `);
            }
        }

        return res.status(response.status).send(data);

    } catch (err) {
        return res.status(500).send(`<h1>Proxy Error</h1><p>${err.message}</p>`);
    }
}
