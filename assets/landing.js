(function(){
  'use strict';
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
})();
