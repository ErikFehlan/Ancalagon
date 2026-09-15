type Task={user_id:string;lease_id:string};
type IO={rpc:(name:string,body:unknown)=>Promise<any>;remove:(bucket:string,names:string[])=>Promise<void>;deleteUser:(id:string)=>Promise<void>};
export async function processAccountDeletions(io:IO,userId:string|null=null){
 const tasks:Task[]=await io.rpc('claim_account_deletions',{p_user:userId});const completed:string[]=[];
 for(const task of tasks){
  try{
   // Bound each run; the durable lease lets the scheduler finish a large account.
   for(let batch=0;batch<4;batch++){
    const files=await io.rpc('account_deletion_files',{p_user:task.user_id,p_lease:task.lease_id});
    if(!files.length){await io.deleteUser(task.user_id);await io.rpc('finish_account_deletion',{p_user:task.user_id,p_lease:task.lease_id});completed.push(task.user_id);break;}
    const groups=new Map<string,string[]>();for(const file of files){if(file.bucket!=='resumes'||typeof file.name!=='string')throw Error('Invalid deletion manifest');const names=groups.get(file.bucket)||[];names.push(file.name);groups.set(file.bucket,names);}
    for(const [bucket,names] of groups)await io.remove(bucket,names);
   }
  }catch{/* Keep the durable request. Retry after the lease expires; no success claim. */}
 }
 return completed;
}
export function accountIO(base:string,key:string):IO{
 const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
 async function request(path:string,method:string,body?:unknown){const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Account cleanup temporarily unavailable');return r;}
 return {rpc:async(name,body)=>(await request('/rest/v1/rpc/'+name,'POST',body)).json(),
 remove:async(bucket,names)=>{await request('/storage/v1/object/'+encodeURIComponent(bucket),'DELETE',{prefixes:names});},
 deleteUser:async id=>{const r=await fetch(base+'/auth/v1/admin/users/'+encodeURIComponent(id),{method:'DELETE',headers,signal:AbortSignal.timeout(20000)});if(!r.ok&&r.status!==404)throw Error('Account removal temporarily unavailable');}};
}
