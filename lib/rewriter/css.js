async function rewriteCSS(css, proxyHost, originalUrl){
  return css.replace(/url\(([^)]+)\)/gi, (match, url)=>{
    url = url.replace(/['"]/g,'');
    if(url.startsWith("http") || url.startsWith("//")){
      const fullUrl = url.startsWith("//") ? "https:" + url : url;
      return `url(${proxyHost}/api/proxy?url=${encodeURIComponent(fullUrl)})`;
    }
    return match;
  });
}

module.exports = { rewriteCSS };
