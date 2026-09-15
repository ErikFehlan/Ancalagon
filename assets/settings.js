(function(global){
 'use strict';
 const defaults=Object.freeze({display_name:'',company:'',job_title:'',time_zone:'UTC',start_page:'home',candidate_sort:'manager',show_closed:false,text_size:'standard',density:'comfortable',reduce_motion:false,notify_assessments:true,notify_uploads:true,notify_automation:true});
 const choices={start_page:['home','job-picker','jobs','learn'],candidate_sort:['manager','jd','newest','name'],text_size:['standard','large','larger'],density:['comfortable','compact']};
 function normalize(value){const result={...defaults};for(const key of Object.keys(result)){if(typeof result[key]==='boolean')result[key]=typeof value?.[key]==='boolean'?value[key]:result[key];else if(typeof value?.[key]==='string')result[key]=value[key];}for(const [key,values] of Object.entries(choices))if(!values.includes(result[key]))result[key]=defaults[key];try{new Intl.DateTimeFormat(undefined,{timeZone:result.time_zone});}catch{result.time_zone='UTC';}return result;}
 function sortCandidates(items,sort){return [...items].sort((a,b)=>{const name=()=>String(a.name).localeCompare(String(b.name));if(sort==='name')return name();if(sort==='newest')return Number(b.createdAt)-Number(a.createdAt)||name();return Number(sort==='jd'?b.jdScore:b.managerScore)-Number(sort==='jd'?a.jdScore:a.managerScore)||name();});}
 function formatDate(value,timeZone,options={dateStyle:'medium',timeStyle:'short'}){if(!value||!Number.isFinite(new Date(value).getTime()))return '';return new Intl.DateTimeFormat(undefined,{...options,timeZone:timeZone||'UTC'}).format(new Date(value));}
 function createSession(api){let saved={...defaults},draft={...defaults},revision=0,loaded=false,busy=false,generation=0,problem='',conflict=false;
  const view=()=>({saved:{...saved},draft:{...draft},loaded,busy,problem,conflict,dirty:JSON.stringify(saved)!==JSON.stringify(draft)});
  const changed=()=>api.changed?.(view());
  async function load(){const g=++generation;busy=true;problem='';changed();try{const row=await api.load();if(g!==generation)return false;saved=normalize(row);draft={...saved};revision=Number(row?.revision)||0;loaded=true;conflict=false;api.apply(saved);return true;}catch{if(g===generation)problem='Settings could not be loaded. Retry to edit your saved preferences.';return false;}finally{if(g===generation){busy=false;changed();}}}
  function edit(values){if(!loaded||busy)return;draft={...draft,...values};changed();}
  async function save(){if(!loaded||busy||conflict)throw Error('Reload saved settings before saving.');const g=generation;busy=true;problem='';changed();try{const row=await api.save(draft,revision);if(g!==generation)return false;saved=normalize(row);draft={...saved};revision=Number(row?.revision)||0;api.apply(saved);return true;}catch(error){if(g===generation){problem=error.code==='PT409'?'Settings changed in another tab. Your edits are still here. Reload saved settings to continue.':'Settings did not save. Your edits are still here; try Save again.';conflict=error.code==='PT409';}throw error;}finally{if(g===generation){busy=false;changed();}}}
  function clear(){generation++;saved={...defaults};draft={...defaults};loaded=false;busy=false;problem='';conflict=false;api.apply(saved);changed();}
  return {view,load,save,edit,clear};
 }
 const api={defaults,normalize,sortCandidates,formatDate,createSession};if(typeof module==='object'&&module.exports)module.exports=api;global.AncalagonSettings=api;
})(globalThis);
