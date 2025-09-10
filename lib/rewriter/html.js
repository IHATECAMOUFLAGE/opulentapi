function rewriteHTML(html, proxyHost, originalUrl){
  return html.replace(/<(img|script|iframe|link|video|source|audio|picture)[^>]+>/gi, tag=>{
    return tag.replace(/(src|href|poster|data-src|srcset)=["']([^"']+)["']/gi, (m, attr, url)=>{
      if(!url || url.startsWith('data:') || url.startsWith('javascript:')) return m;
      const fullUrl = url.startsWith('//') ? 'https:' + url : url.startsWith('http') ? url : new URL(url, originalUrl).href;
      return `${attr}="${proxyHost}/api/proxy?url=${encodeURIComponent(fullUrl)}"`;
    });
  });
}

module.exports = { rewriteHTML };
