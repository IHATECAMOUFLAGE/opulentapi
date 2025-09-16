(function(){
  var erudaLoaded=false;
  function loadEruda(){
    if(!erudaLoaded){
      var s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/eruda';
      s.onload=function(){eruda.init()};
      document.head.appendChild(s);
      erudaLoaded=true;
    } else if(window.eruda){eruda.show();}
  }

  function removeEruda(){
    if(window.eruda){window.eruda.destroy(); delete window.eruda;}
    const s=document.querySelectorAll('script[src*="eruda"]');
    s.forEach(el=>el.remove());
    const erudaContainers=document.querySelectorAll('#eruda, .eruda-container');
    erudaContainers.forEach(el=>el.remove());
    erudaLoaded=false;
  }

  if('serviceWorker' in navigator)navigator.serviceWorker.register('/api/sw.js',{scope:'/'});

  let lastRewrite=0;
  const throttle=200;

  function proxyElement(el){
    if(el.dataset.proxied)return;
    if(el.tagName==='A'&&el.href)el.href='/api/proxy?url='+encodeURIComponent(el.href);
    if(el.tagName==='IMG'&&el.src)el.src='/api/proxy?url='+encodeURIComponent(el.src);
    if(el.tagName==='IFRAME'&&el.src)el.src='/api/proxy?url='+encodeURIComponent(el.src);
    if(el.tagName==='FORM'&&el.action)el.action='/api/proxy?url='+encodeURIComponent(el.action);
    if(el.tagName==='LINK'&&el.href)el.href='/api/proxy?url='+encodeURIComponent(el.href);
    if(el.tagName==='SCRIPT'&&el.src)el.src='/api/proxy?url='+encodeURIComponent(el.src);
    if(el.style && el.style.backgroundImage){
      const match=el.style.backgroundImage.match(/url\(["']?(.+?)["']?\)/);
      if(match && match[1] && !match[1].startsWith('/api/proxy'))el.style.backgroundImage='url("/api/proxy?url='+encodeURIComponent(match[1])+'")';
    }
    if(el.getAttribute){
      ['src','href','poster','data-src','data-href','srcset'].forEach(a=>{
        if(el.hasAttribute(a)&&!el.getAttribute(a).startsWith('/api/proxy'))el.setAttribute(a,'/api/proxy?url='+encodeURIComponent(el.getAttribute(a)));
      });
    }
    el.dataset.proxied='1';
  }

  function rewriteAll(){
    const now=Date.now();
    if(now-lastRewrite<throttle)return;
    lastRewrite=now;
    document.querySelectorAll('a,img,iframe,form,link,script,[style]').forEach(proxyElement);
  }

  const observer=new MutationObserver(mutations=>{
    mutations.forEach(m=>{
      m.addedNodes.forEach(n=>{
        if(n.nodeType===1)rewriteAll();
      });
    });
  });
  observer.observe(document.documentElement||document.body||document,{childList:true,subtree:true});

  setInterval(rewriteAll,100);

  function createMenu(){
    const body=(document.body||document.documentElement);
    if(!body)return setTimeout(createMenu,100);
    if(document.getElementById('proxyMenuButton'))return;

    const btn=document.createElement('button');
    btn.id='proxyMenuButton';
    btn.textContent='☰ Menu';
    btn.style.position='fixed';
    btn.style.top='10px';
    btn.style.right='10px';
    btn.style.background='#111';
    btn.style.color='#fff';
    btn.style.border='none';
    btn.style.borderRadius='6px';
    btn.style.padding='6px 12px';
    btn.style.cursor='pointer';
    btn.style.zIndex='9999';
    btn.style.transition='0.2s';
    btn.onmouseover=()=>btn.style.background='#222';
    btn.onmouseout=()=>btn.style.background='#111';

    const dropdown=document.createElement('div');
    dropdown.id='proxyMenuDropdown';
    dropdown.style.position='fixed';
    dropdown.style.top='40px';
    dropdown.style.right='10px';
    dropdown.style.background='#111';
    dropdown.style.border='1px solid #333';
    dropdown.style.borderRadius='6px';
    dropdown.style.display='none';
    dropdown.style.flexDirection='column';
    dropdown.style.zIndex='9999';
    dropdown.style.minWidth='180px';

    const editToggleLabel=document.createElement('label');
    editToggleLabel.style.display='flex';
    editToggleLabel.style.alignItems='center';
    editToggleLabel.style.gap='6px';
    editToggleLabel.style.padding='6px 10px';
    editToggleLabel.style.cursor='pointer';
    editToggleLabel.style.color='#fff';
    editToggleLabel.textContent='Enable Editing';
    const editCheckbox=document.createElement('input');
    editCheckbox.type='checkbox';
    editToggleLabel.prepend(editCheckbox);
    editCheckbox.onchange=()=>{document.body.contentEditable=editCheckbox.checked};

    const erudaToggleLabel=document.createElement('label');
    erudaToggleLabel.style.display='flex';
    erudaToggleLabel.style.alignItems='center';
    erudaToggleLabel.style.gap='6px';
    erudaToggleLabel.style.padding='6px 10px';
    erudaToggleLabel.style.cursor='pointer';
    erudaToggleLabel.style.color='#fff';
    erudaToggleLabel.textContent='Toggle Eruda';
    const erudaCheckbox=document.createElement('input');
    erudaCheckbox.type='checkbox';
    erudaToggleLabel.prepend(erudaCheckbox);
    erudaCheckbox.onchange=()=>{
      if(erudaCheckbox.checked){loadEruda();} 
      else{removeEruda();}
    };

    const openUrlLabel=document.createElement('label');
    openUrlLabel.style.display='flex';
    openUrlLabel.style.flexDirection='column';
    openUrlLabel.style.padding='6px 10px';
    openUrlLabel.style.color='#fff';
    openUrlLabel.style.cursor='pointer';
    openUrlLabel.textContent='Open Proxied URL:';
    const urlInput=document.createElement('input');
    urlInput.type='text';
    urlInput.style.marginTop='4px';
    urlInput.style.padding='4px';
    urlInput.style.borderRadius='4px';
    urlInput.style.border='none';
    urlInput.style.outline='none';
    urlInput.style.background='#222';
    urlInput.style.color='#fff';
    urlInput.placeholder='https://example.com';
    const goBtn=document.createElement('button');
    goBtn.textContent='Go';
    goBtn.style.marginTop='4px';
    goBtn.style.background='#333';
    goBtn.style.color='#fff';
    goBtn.style.border='none';
    goBtn.style.borderRadius='4px';
    goBtn.style.padding='4px';
    goBtn.style.cursor='pointer';
    goBtn.onclick=()=>{if(urlInput.value)window.location='/api/proxy?url='+encodeURIComponent(urlInput.value)};
    openUrlLabel.appendChild(urlInput);
    openUrlLabel.appendChild(goBtn);

    dropdown.appendChild(editToggleLabel);
    dropdown.appendChild(erudaToggleLabel);
    dropdown.appendChild(openUrlLabel);
    body.appendChild(btn);
    body.appendChild(dropdown);

    btn.onclick=(e)=>{e.stopPropagation();dropdown.style.display=dropdown.style.display==='flex'?'none':'flex';dropdown.style.flexDirection='column';};
    document.addEventListener('click',(e)=>{if(!dropdown.contains(e.target)&&e.target!==btn)dropdown.style.display='none';});
  }

  document.addEventListener('DOMContentLoaded',createMenu);
  setTimeout(createMenu,500);
})();
