(function(){
  'use strict';
  // Browser chrome follows the visible surface without changing saved themes.
  function syncBrowserColors(){
    const signedIn=document.body.classList.contains('rf-authenticated');
    const surface=document.getElementById(signedIn?'rf-app':'authGate');
    if(!surface)return;
    const styles=getComputedStyle(surface);
    document.documentElement.style.colorScheme=styles.colorScheme;
    const background=styles.getPropertyValue(signedIn?'--ui-bg':'--an-bg').trim();
    if(background)document.querySelector('meta[name="theme-color"]')?.setAttribute('content',background);
  }
  const colors=new MutationObserver(syncBrowserColors);
  colors.observe(document.body,{attributes:true,attributeFilter:['class']});
  const workspace=document.getElementById('rf-app');
  if(workspace)colors.observe(workspace,{attributes:true,attributeFilter:['data-theme']});
  syncBrowserColors();
  const tabs=Array.from(document.querySelectorAll('[data-demo]'));
  function select(tab){
    tabs.forEach(item=>{const active=item===tab;item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;document.getElementById(item.getAttribute('aria-controls')).hidden=!active;});
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>select(tab));
    tab.addEventListener('keydown',event=>{
      let next;if(['ArrowRight','ArrowDown'].includes(event.key))next=(index+1)%tabs.length;
      else if(['ArrowLeft','ArrowUp'].includes(event.key))next=(index-1+tabs.length)%tabs.length;
      else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;
      event.preventDefault();select(tabs[next]);tabs[next].focus();
    });
  });
  document.querySelectorAll('[data-explore-preview]').forEach(link=>{
    link.addEventListener('click',event=>{
      const active=tabs.find(tab=>tab.getAttribute('aria-selected')==='true');
      const preview=document.getElementById('product-preview');
      if(!active||!preview)return;
      event.preventDefault();
      preview.scrollIntoView({block:'start',behavior:'instant'});
      active.focus({preventScroll:true});
    });
  });
})();
