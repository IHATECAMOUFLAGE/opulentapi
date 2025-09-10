async function rewriteCSS(css, proxyHost, originalUrl){
  return css.replace(/url\(([^)]+)\)/gi, (match, url)=>{
    url = url.replace(/['"]/g,'').trim();
    if(!url || url.startsWith('data:')) return match;
    const fullUrl = url.startsWith('//') ? 'https:' + url : url.startsWith('http') ? url : new URL(url, originalUrl).href;
    return `url(${proxyHost}/api/proxy?url=${encodeURIComponent(fullUrl)})`;
  }).replace(/@import\s+['"]([^'"]+)['"]/gi,(match, url)=>{
    if(!url || url.startsWith('data:')) return match;
    const fullUrl = url.startsWith('//') ? 'https:' + url : url.startsWith('http') ? url : new URL(url, originalUrl).href;
    return `@import "${proxyHost}/api/proxy?url=${encodeURIComponent(fullUrl)}"`;
  });
}

module.exports = { rewriteCSS };
