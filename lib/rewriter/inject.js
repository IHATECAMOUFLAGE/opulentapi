(function(){
  var s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/eruda';
  s.onload=function(){eruda.init()};
  document.head.appendChild(s);
  var observer=new MutationObserver(mutations=>{
    mutations.forEach(m=>{
      m.addedNodes.forEach(n=>{
        if(n.nodeType===1){
          ['src','href','poster','data-src','data-href','srcset'].forEach(a=>{
            if(n.hasAttribute && n.hasAttribute(a)) n.setAttribute(a,n.getAttribute(a));
          });
        }
      });
    });
  });
  observer.observe(document.documentElement||document.body||document,{childList:true,subtree:true});
})();
