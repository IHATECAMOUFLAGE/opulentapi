(function(){
  var erudaLoaded=false;
  function loadEruda(){
    if(!erudaLoaded){
      var s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/eruda';
      s.onload=function(){eruda.init()};
      document.head.appendChild(s);
      erudaLoaded=true;
    } else if(window.eruda){
      eruda.show();
    }
  }

  function rewriteForms(){
    const forms=document.querySelectorAll('form');
    forms.forEach(form=>{
      try{
        const original=form.getAttribute('action')||'';
        const base=window.location.origin;
        let target=original;
        if(original.startsWith('/')) target=window.location.origin+original;
        else if(!original.match(/^https?:\/\//i)) target=window.location.origin+'/'+original;
        const proxied=base+'/api/proxy.js?url='+encodeURIComponent(target);
        form.setAttribute('action',proxied);
      }catch{}
    });
  }

  rewriteForms();
  const observer=new MutationObserver(()=>rewriteForms());
  observer.observe(document.documentElement||document.body,{childList:true,subtree:true});

  function createMenu(){
    const body=document.body||document.documentElement;
    if(!body)return setTimeout(createMenu,100);
    if(document.getElementById('proxyMenuButton'))return;

    const btn=document.createElement('button');
    btn.id='proxyMenuButton';
    btn.textContent='☰ Menu';
    btn.style.cssText='position:fixed;top:10px;right:10px;background:#111;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;z-index:9999;transition:0.2s';
    btn.onmouseover=()=>btn.style.background='#222';
    btn.onmouseout=()=>btn.style.background='#111';

    const dropdown=document.createElement('div');
    dropdown.id='proxyMenuDropdown';
    dropdown.style.cssText='position:fixed;top:40px;right:10px;background:#111;border:1px solid #333;border-radius:6px;display:none;flex-direction:column;z-index:9999;min-width:180px';

    const editLabel=document.createElement('label');
    editLabel.style.cssText='display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;color:#fff';
    editLabel.textContent='Enable Editing';
    const editCheckbox=document.createElement('input');
    editCheckbox.type='checkbox';
    editLabel.prepend(editCheckbox);
    editCheckbox.onchange=()=>document.body.contentEditable=editCheckbox.checked;

    const erudaLabel=document.createElement('label');
    erudaLabel.style.cssText='display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;color:#fff';
    erudaLabel.textContent='Toggle Eruda';
    const erudaCheckbox=document.createElement('input');
    erudaCheckbox.type='checkbox';
    erudaLabel.prepend(erudaCheckbox);
    erudaCheckbox.onchange=()=>{
      if(erudaCheckbox.checked) loadEruda();
      else if(window.eruda){window.eruda.hide();window.eruda=null;document.querySelectorAll('script[src*="eruda"]').forEach(s=>s.remove());}
    };

    const openLabel=document.createElement('label');
    openLabel.style.cssText='display:flex;flex-direction:column;padding:6px 10px;color:#fff;cursor:pointer';
    openLabel.textContent='Open Proxied URL:';
    const urlInput=document.createElement('input');
    urlInput.type='text';
    urlInput.style.cssText='margin-top:4px;padding:4px;border-radius:4px;border:none;outline:none;background:#222;color:#fff';
    urlInput.placeholder='https://example.com';
    const goBtn=document.createElement('button');
    goBtn.textContent='Go';
    goBtn.style.cssText='margin-top:4px;background:#333;color:#fff;border:none;border-radius:4px;padding:4px;cursor:pointer';
    goBtn.onclick=()=>{if(urlInput.value) window.location='/api/proxy.js?url='+encodeURIComponent(urlInput.value)};
    openLabel.appendChild(urlInput);
    openLabel.appendChild(goBtn);

    dropdown.appendChild(editLabel);
    dropdown.appendChild(erudaLabel);
    dropdown.appendChild(openLabel);
    body.appendChild(btn);
    body.appendChild(dropdown);

    btn.onclick=(e)=>{e.stopPropagation();dropdown.style.display=dropdown.style.display==='flex'?'none':'flex';dropdown.style.flexDirection='column';};
    document.addEventListener('click',(e)=>{if(!dropdown.contains(e.target)&&e.target!==btn) dropdown.style.display='none';});
  }

  document.addEventListener('DOMContentLoaded',createMenu);
  setTimeout(createMenu,500);
})();
