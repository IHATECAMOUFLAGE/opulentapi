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
        url = decodeURIComponent(url);
        console.log(`Proxying: ${url}`);

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

        if (isImage || isBinary) {
            return res.status(response.status).send(Buffer.from(response.data));
        }

        if (isJson) {
            return res.status(response.status).json(response.data);
        }

        let data = response.data;

        if (!isJs && contentType.includes('text/html')) {
            const baseUrl = new URL(url);

            data = data.replace(/(src|href|srcset|poster)=["']([^"']+)["']/gi, (match, attr, link) => {
                try {
                    if (link.startsWith('data:') || link.startsWith('mailto:') || link.startsWith('javascript:')) {
                        return match;
                    }
                    const absoluteUrl = new URL(link, baseUrl).toString();
                    const proxied = `/API/index.js?url=${encodeURIComponent(absoluteUrl)}`;
                    return `${attr}="${proxied}"`;
                } catch (e) {
                    return match;
                }
            });

            data = data.replace('loading="lazy"', 'loading="eager"');

            const redirectPatterns = [
                /(?:window\.|top\.|document\.)?location(?:\.href)?\s*=\s*["'`](.*?)["'`]/gi,
                /window\.open\s*\(\s*["'`](.*?)["'`]\s*(,.*?)?\)/gi,
            ];

            for (const pattern of redirectPatterns) {
                data = data.replace(pattern, (...args) => {
                    let link = args[1];
                    let extra = args[2] || '';
                    try {
                        const target = new URL(link || '.', baseUrl).toString();
                        const proxied = `/API/index.js?url=${encodeURIComponent(target)}`;
                        if (pattern.source.startsWith("window.open")) {
                            return `window.open('${proxied}'${extra})`;
                        } else {
                            return `window.location = '${proxied}'`;
                        }
                    } catch (e) {
                        return args[0];
                    }
                });
            }
            
            data = data.replace(/<\/body>/i, `
                <script src="https://cdn.jsdelivr.net/npm/eruda"></script>
                <script>eruda.init();</script>
            </body>`);

            data = data.replace(/(--background-image\s*:\s*url\(["']?)([^"')]+)(["']?\))/g, (match, prefix, url, suffix) => {
                if (url.startsWith('http')) return match;
                const proxiedUrl = `/API/index.js?url=${encodeURIComponent(url)}`;
                return `${prefix}${proxiedUrl}${suffix}`;
            });

            data = data.replace(/url\(["']?(?!data:|http|\/\/)([^"')]+)["']?\)/gi, (match, relativePath) => {
                const absolute = new URL(relativePath, baseUrl).toString();
                const proxied = `/API/index.js?url=${encodeURIComponent(absolute)}`;
                return `url('${proxied}')`;
            });

            data = data.replace(/<iframe\s+[^>]*src=["'](.*?)["'][^>]*>/gi, (match, link) => {
                try {
                    const target = new URL(link || '.', baseUrl).toString();
                    const proxied = `/API/index.js?url=${encodeURIComponent(target)}`;
                    return match.replace(link, proxied);
                } catch (e) {
                    return match;
                }
            });

            data = data.replace(/href=["'](https?:\/\/[^"']+)["']/gi, (match, link) => {
                try {
                    const proxied = `/API/index.js?url=${encodeURIComponent(link)}`;
                    return `href="${proxied}"`;
                } catch (e) {
                    return match;
                }
            });

            if (url.includes('google.com/search')) {
                const formRegex = /<form\s+class="tsf"[^>]*role="search"[^>]*>[\s\S]*?<\/form>/i;
                
                data = data.replace(formRegex, '');
            
                return res.send(`
                    <body>
                        <script>
                            alert('Google will attempt to load from 3–30 or more times before it succeeds.');
                            window.location.href = '/API/google/index.js?url=' + encodeURIComponent(${JSON.stringify(url)});
                        </script>
                    </body>
                `);
            } else if (url.includes('https://google.com')) {
                const filePath = path.join(process.cwd(), 'static', 'google', 'index.html');
                data = fs.readFileSync(filePath, 'utf8');
                data = data.replace(
                    /<\/body>/i,
                    `
                        <script>
                            document.addEventListener('DOMContentLoaded', function () {
                                const searchInput = document.querySelector('input[name="q"], textarea[name="q"]');
                                if (searchInput) {
                                    searchInput.addEventListener('keypress', function (event) {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            const searchTerm = searchInput.value;
                                            const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(searchTerm);
                                            window.location.href = '/API/index.js?url=' + encodeURIComponent(searchUrl);
                                        }
                                    });
                                }
                            });
                        </script>
                    </body>`
                );
            }
        }

        data = data.replace(/%20/g, ' ')
            .replace(/%21/g, '!')
            .replace(/%22/g, '"')
            .replace(/%23/g, '#')
            .replace(/%24/g, '$')
            .replace(/%25/g, '%')
            .replace(/%26/g, '&')
            .replace(/%27/g, "'")
            .replace(/%28/g, '(')
            .replace(/%29/g, ')')
            .replace(/%2A/g, '*')
            .replace(/%2B/g, '+')
            .replace(/%2C/g, ',')
            .replace(/%2D/g, '-')
            .replace(/%2E/g, '.')
            .replace(/%2F/g, '/')
            .replace(/%30/g, '0')
            .replace(/%31/g, '1')
            .replace(/%32/g, '2')
            .replace(/%33/g, '3')
            .replace(/%34/g, '4')
            .replace(/%35/g, '5')
            .replace(/%36/g, '6')
            .replace(/%37/g, '7')
            .replace(/%38/g, '8')
            .replace(/%39/g, '9')
            .replace(/%3A/g, ':')
            .replace(/%3B/g, ';')
            .replace(/%3C/g, '<')
            .replace(/%3D/g, '=')
            .replace(/%3E/g, '>')
            .replace(/%3F/g, '?')
            .replace(/%40/g, '@')
            .replace(/%41/g, 'A')
            .replace(/%42/g, 'B')
            .replace(/%43/g, 'C')
            .replace(/%44/g, 'D')
            .replace(/%45/g, 'E')
            .replace(/%46/g, 'F')
            .replace(/%47/g, 'G')
            .replace(/%48/g, 'H')
            .replace(/%49/g, 'I')
            .replace(/%4A/g, 'J')
            .replace(/%4B/g, 'K')
            .replace(/%4C/g, 'L')
            .replace(/%4D/g, 'M')
            .replace(/%4E/g, 'N')
            .replace(/%4F/g, 'O')
            .replace(/%50/g, 'P')
            .replace(/%51/g, 'Q')
            .replace(/%52/g, 'R')
            .replace(/%53/g, 'S')
            .replace(/%54/g, 'T')
            .replace(/%55/g, 'U')
            .replace(/%56/g, 'V')
            .replace(/%57/g, 'W')
            .replace(/%58/g, 'X')
            .replace(/%59/g, 'Y')
            .replace(/%5A/g, 'Z')
            .replace(/%5B/g, '[')
            .replace(/%5C/g, '\\')
            .replace(/%5D/g, ']')
            .replace(/%5E/g, '^')
            .replace(/%5F/g, '_')
            .replace(/%60/g, '`')
            .replace(/%61/g, 'a')
            .replace(/%62/g, 'b')
            .replace(/%63/g, 'c')
            .replace(/%64/g, 'd')
            .replace(/%65/g, 'e')
            .replace(/%66/g, 'f')
            .replace(/%67/g, 'g')
            .replace(/%68/g, 'h')
            .replace(/%69/g, 'i')
            .replace(/%6A/g, 'j')
            .replace(/%6B/g, 'k')
            .replace(/%6C/g, 'l')
            .replace(/%6D/g, 'm')
            .replace(/%6E/g, 'n')
            .replace(/%6F/g, 'o')
            .replace(/%70/g, 'p')
            .replace(/%71/g, 'q')
            .replace(/%72/g, 'r')
            .replace(/%73/g, 's')
            .replace(/%74/g, 't')
            .replace(/%75/g, 'u')
            .replace(/%76/g, 'v')
            .replace(/%77/g, 'w')
            .replace(/%78/g, 'x')
            .replace(/%79/g, 'y')
            .replace(/%7A/g, 'z')
            .replace(/%7B/g, '{')
            .replace(/%7C/g, '|')
            .replace(/%7D/g, '}')
            .replace(/%7E/g, '~');

        data = data.replace(/content="([^"]+)"/g, (match, jsonContent) => {
            try {
                let jsonData = JSON.parse(decodeURIComponent(jsonContent));
                const updateAssetUrl = (obj) => {
                    for (let key in obj) {
                        const val = obj[key];
                        if (typeof val === 'string' && !val.startsWith('data:') && !val.startsWith('http')) {
                            obj[key] = new URL(val, baseUrl).toString();
                        }
                    }
                };

                if (jsonData.assets) {
                    if (jsonData.assets.video) {
                        for (let size in jsonData.assets.video) {
                            updateAssetUrl(jsonData.assets.video[size]);
                        }
                    }
                    if (jsonData.assets.poster) {
                        updateAssetUrl(jsonData.assets.poster);
                    }
                    if (jsonData.assets.image) {
                        for (let size in jsonData.assets.image) {
                            const img = jsonData.assets.image[size];
                            if (img && img.src && !img.src.startsWith('http')) {
                                jsonData.assets.image[size].src = new URL(img.src, baseUrl).toString();
                            }
                        }
                    }
                }

                return `content="${encodeURIComponent(JSON.stringify(jsonData))}"`;
            } catch (e) {
                console.error("Error processing content:", e);
                return match;
            }
        });

        return res.status(response.status).send(data);

    } catch (err) {
        console.error(`Proxy Error: ${err.message}`);
        return res.status(500).send(`<h1>Proxy Error</h1><p>${err.message}</p>`);
    }
}
