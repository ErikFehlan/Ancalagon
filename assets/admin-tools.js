(function(global){
 'use strict';
 function create({host,load,download,authorize,getSettings,saveSettings,onDenied,toast,saveFile,supportLoad,supportReview}){
  let allowed=false,version=0,loading=null;
  const files={downloadServer:'server',downloadSchema:'schema',downloadPrompt:'prompt',downloadPackage:'pkg',downloadEnv:'env'};
  function clear(){version++;loading=null;host.replaceChildren();}
  function setAllowed(value){allowed=value===true;if(!allowed)clear();}
  function deny(){setAllowed(false);onDenied();}
  function message(text,retry=false){
   host.replaceChildren();const note=document.createElement('p');note.className='rf-note';note.setAttribute('role','status');note.textContent=text;host.append(note);
   if(retry){const button=document.createElement('button');button.type='button';button.className='rf-btn';button.dataset.adminRetry='true';button.textContent='Retry';host.append(button);}
  }
  async function open(){
   if(!allowed){clear();return;}
   if(loading)return loading;
   const request=++version;message('Loading admin tools…');
   loading=(async()=>{
    try{
     const payload=await load();
     if(!allowed||request!==version)return;
     if(typeof payload?.html!=='string')throw Error('Admin tools are unavailable.');
     // This markup is a deployment-owned resource returned by an admin-checked RPC.
     host.innerHTML=payload.html;
     if(supportLoad){const panel=document.createElement('section');panel.className='rf-card';panel.innerHTML='<h3>Support Inbox</h3><p class="rf-sub">Private problem reports submitted from Settings.</p><button type="button" class="rf-btn" data-support-refresh>Refresh reports</button><div id="adminSupportInbox" aria-live="polite"></div>';host.append(panel);void loadSupport(request);}
     const settings=getSettings();host.querySelector('#patternFunctionUrl').value=settings.url;host.querySelector('#patternAnonKey').value=settings.anonKey;
    }catch(error){
     if(request!==version)return;
     if(error?.code==='42501'||error?.code==='PGRST301')deny();
     else message('Admin tools could not be loaded. Please try again.',true);
    }finally{if(request===version)loading=null;}
   })();
   return loading;
  }
  async function loadSupport(request=version){
   const inbox=host.querySelector('#adminSupportInbox');if(!inbox)return;
   try{const rows=await supportLoad();if(!allowed||request!==version)return;inbox.replaceChildren();
    if(!rows.length){inbox.textContent='No reports yet.';return;}
    for(const row of rows){const item=document.createElement('article');item.className='settings-details';const title=document.createElement('h4'),meta=document.createElement('p'),description=document.createElement('p'),actions=document.createElement('div');title.textContent=row.subject;meta.textContent=row.reply_email+' · '+row.status+' · '+row.id.slice(0,8);description.textContent=row.description;description.style.whiteSpace='pre-wrap';actions.className='rf-actions';
     for(const status of ['open','reviewed','resolved']){const b=document.createElement('button');b.type='button';b.className='rf-btn';b.textContent=status==='open'?'Reopen':'Mark '+status;b.disabled=row.status===status;b.addEventListener('click',async()=>{b.disabled=true;try{await supportReview(row.id,status);if(allowed&&request===version)await loadSupport(request);}catch(error){if(request!==version)return;if(error.code==='42501')deny();else toast('Report could not be updated. Try again.','error');}finally{if(b.isConnected)b.disabled=false;}});actions.append(b);}
     item.append(title,meta,description,actions);inbox.append(item);
    }
   }catch(error){if(request!==version)return;if(error.code==='42501')deny();else inbox.textContent='Reports could not be loaded. Use Refresh reports to retry.';}
  }
  async function action(event){
   const button=event.target.closest('button');if(!button||!host.contains(button)||!allowed)return;
   if(button.dataset.adminRetry){void open();return;}
   if(button.hasAttribute('data-support-refresh')){void loadSupport();return;}
   const file=files[button.id];if(!file&&button.id!=='saveHybridSettings')return;
   const request=version;button.disabled=true;
   try{
    if(file){
     const result=await download(file,host.querySelector('#backendModel').value.trim(),host.querySelector('#backendProject').value.trim());
     if(!allowed||request!==version)return;
     if(typeof result?.content!=='string'||typeof result?.name!=='string')throw Error('Download unavailable.');
     saveFile(result.content,result.name,result.type||'text/plain');
    }else{
     // Recheck the server role for every action, including a session-only override.
     const permitted=await authorize();if(!allowed||request!==version)return;
     if(permitted!==true){deny();return;}
     const settings={url:host.querySelector('#patternFunctionUrl').value.trim(),anonKey:host.querySelector('#patternAnonKey').value.trim()};
     const target=new URL(settings.url),current=new URL(getSettings().url);
     if(target.origin!==current.origin||!target.pathname.startsWith('/functions/v1/')||target.username||target.password)throw Error('Use a function URL in the configured Supabase project.');
     if(!settings.anonKey)throw Error('Enter the public Supabase key.');
     saveSettings(settings);toast('Connection updated for this session.');
    }
   }catch(error){
    if(request!==version)return;
    if(error?.code==='42501'||error?.code==='PGRST301')deny();
    else toast(error?.message||'The admin action could not be completed.','error');
   }finally{if(button.isConnected)button.disabled=false;}
  }
  host.addEventListener('click',action);
  return {open,setAllowed,clear,isAllowed:()=>allowed};
 }
 const api={create};if(typeof module==='object'&&module.exports)module.exports=api;global.AncalagonAdminTools=api;
})(globalThis);
