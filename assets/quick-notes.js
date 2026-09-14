(function(global){
  'use strict';
  function create(api,{delay=1200}={}){
    const entries=new Map();
    function entry(c){if(!entries.has(c.id))entries.set(c.id,{candidate:c,id:api.id(),text:'',savedText:'',status:'idle',timer:null,promise:null,error:''});return entries.get(c.id);}
    const dirty=e=>!!e?.text.trim()&&e.text.trim()!==e.savedText;
    function changed(e){api.changed?.(e.candidate,e);}
    function edit(c,text){const e=entry(c);e.text=text;clearTimeout(e.timer);e.error='';e.status=dirty(e)?'editing':e.savedText?'saved':'idle';changed(e);if(dirty(e))e.timer=setTimeout(()=>void flush(c),delay);}
    async function flush(c){
      const e=entry(c);clearTimeout(e.timer);e.timer=null;
      if(e.promise){await e.promise;return dirty(e)&&e.status!=='error'?flush(c):e.status!=='error';}
      if(!dirty(e))return true;
      if(!api.valid(c)){entries.delete(c.id);return true;}
      const text=e.text.trim(),previous=e.savedText;e.status='saving';e.error='';changed(e);
      e.promise=(async()=>{
        try{await Promise.resolve().then(()=>api.save(c,text,e.id,previous));e.savedText=text;e.status=dirty(e)?'editing':'saved';return true;}
        catch(error){e.status='error';e.error=error.message||'Could not save this note.';return false;}
        finally{e.promise=null;changed(e);}
      })();
      const ok=await e.promise;
      // A newer draft waits for the in-flight save; it never becomes a second note.
      if(ok&&dirty(e))return flush(c);
      return ok;
    }
    async function fresh(c){if(!await flush(c))return false;const old=entries.get(c.id);if(old?.promise||dirty(old))return false;entries.delete(c.id);changed(entry(c));return true;}
    function pending(id){return [...entries.values()].some(e=>(!id||e.candidate.id===id)&&api.valid(e.candidate)&&(!!e.promise||dirty(e)));}
    async function flushAll(){const results=await Promise.all([...entries.values()].map(e=>flush(e.candidate)));if(results.some(x=>!x))throw Error('Your quick feedback has not saved. Retry before leaving.');}
    function dispose(){for(const e of entries.values())clearTimeout(e.timer);entries.clear();}
    return {entry,edit,flush,fresh,pending,flushAll,dispose};
  }
  const api={create};if(typeof module!=='undefined')module.exports=api;global.AncalagonQuickNotes=api;
})(typeof window==='undefined'?globalThis:window);
