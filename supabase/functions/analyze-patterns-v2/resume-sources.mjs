// The model chooses evidence; the server supplies its exact source quotation.
// Passages partition the original text without rewriting words or punctuation.
export function resumeSources(text){
  const sources=[];
  for(let start=0;start<text.length;){
    let end=Math.min(start+700,text.length);
    if(end<text.length){
      const chunk=text.slice(start,end);
      // Prefer a sentence, bullet or line boundary, then an ordinary word break.
      const boundaries=[...chunk.matchAll(/\n+|[.!?](?=\s)|(?=\s[•▪●])/g)];
      const last=boundaries.at(-1);
      if(last&&last.index>=200)end=start+last.index+last[0].length;
      else {const space=chunk.lastIndexOf(' ');if(space>=200)end=start+space+1;}
    }
    sources.push({id:'resume-'+(sources.length+1),text:text.slice(start,end)});
    start=end;
  }
  // A trailing fragment must meet the shared verifier's minimum quotation size.
  if(sources.length>1&&sources.at(-1).text.trim().length<12){
    sources[sources.length-2].text+=sources.pop().text;
  }
  return sources;
}

export function resolveResumeSources(analysis,sources){
  const byId=new Map(sources.map(source=>[source.id,source.text]));
  const fail=()=>{throw Object.assign(new Error('Invalid resume evidence reference'),{code:'invalid_evidence'});};
  if(!analysis||!Array.isArray(analysis.resume_evidence)||analysis.resume_evidence.length>5)fail();
  return {...analysis,resume_evidence:analysis.resume_evidence.map(e=>{
    if(!e||typeof e.source_id!=='string'||!byId.has(e.source_id)||Object.hasOwn(e,'quote'))fail();
    return {claim:e.claim,quote:byId.get(e.source_id)};
  })};
}
