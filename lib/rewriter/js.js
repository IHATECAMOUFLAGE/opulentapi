function rewriteJS(js, proxyOrigin, targetOrigin) {
  return js
    .replace(/\bfetch\s*\(([^)]+)\)/g, `fetch(${proxyOrigin}+"/api/proxy?url="+$1)`)
    .replace(/\bnew WebSocket\s*\(([^)]+)\)/g, `new WebSocket(${proxyOrigin}+"/api/proxy?url="+$1)`)
    .replace(/window\.location/g, `"${proxyOrigin}"`)
    .replace(/document\.write\s*\(([^)]+)\)/g, `document.write($1)`);
}

module.exports = { rewriteJS };
