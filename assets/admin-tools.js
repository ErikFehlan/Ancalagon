(function(global){
 'use strict';
 function create({host,load,download,authorize,getSettings,saveSettings,onDenied,toast,saveFile}){
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
     const settings=getSettings();host.querySelector('#patternFunctionUrl').value=settings.url;host.querySelector('#patternAnonKey').value=settings.anonKey;
    }catch(error){
     if(request!==version)return;
     if(error?.code==='42501'||error?.code==='PGRST301')deny();
     else message('Admin tools could not be loaded. Please try again.',true);
    }finally{if(request===version)loading=null;}
   })();
   return loading;
  }
  async function action(event){
   const button=event.target.closest('button');if(!button||!host.contains(button)||!allowed)return;
   if(button.dataset.adminRetry){void open();return;}
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
