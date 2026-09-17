(function(global){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const words=text=>String(text||'').match(/\S+/g)||[];
  const caution=/\b(?:not|no|never|without|lack\w*|limited|unclear|unknown|unverified|uncertain|but|however|although|only|except)\b/i;
  const segments=text=>[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(text)].map(s=>s.segment.trim()).filter(Boolean);
  function clean(text){
    return String(text||'').replace(/\([^)]*(?:profile-(?:strength|concern)-\d|resume-quote-\d|manager-calibration|feedback-\d)[^)]*\)/g,'')
      .replace(/\b(?:profile-(?:strength|concern)-\d+|resume-quote-\d+|manager-calibration|feedback-\d+)\b/g,'')
      .replace(/^Provisional(?: manager-context)? score:\s*/i,'').replace(/\s+/g,' ').trim();
  }
  // Display excerpts only. Never mutate stored evidence or the text used to score it.
  // Keep a contiguous slice and retain a late qualification instead of clipping it off.
  function windowOf(text,limit){
    const tokens=[...text.matchAll(/\S+/g)];if(tokens.length<=limit)return text;
    const qualification=tokens.findLastIndex(t=>caution.test(t[0]));
    const start=qualification>=limit?Math.min(Math.max(0,qualification-4),tokens.length-limit):0;
    const end=Math.min(tokens.length,start+limit);
    return (start?'…':'')+text.slice(tokens[start].index,tokens[end-1].index+tokens[end-1][0].length)+(end<tokens.length?'…':'');
  }
  function brief(text,limit=32,count=2){
    const value=clean(text);if(words(value).length<=limit)return value;
    const parts=segments(value),chosen=[parts[0]];
    if(count>1&&parts.length>1)chosen.push(parts.slice(1).find(s=>caution.test(s))||parts[1]);
    if(count>2&&parts.length>2){const question=parts.find(s=>s.endsWith('?'));if(question&&!chosen.includes(question))chosen.push(question);}
    const each=Math.floor(limit/chosen.length);
    return chosen.map((s,i)=>windowOf(s,i===chosen.length-1?limit-each*i:each)).join(' ');
  }
  function evidence(value){
    if(value&&typeof value==='object')return {claim:String(value.claim||''),quote:String(value.quote||'')};
    const text=String(value||''),marker=' — Resume: “',start=text.indexOf(marker);
    return start>=0&&text.endsWith('”')?{claim:text.slice(0,start),quote:text.slice(start+marker.length,-1)}:{claim:text,quote:''};
  }
  function excerpt(quote,claim='',limit=25){
    const text=String(quote||'').trim();if(words(text).length<=limit)return text;
    const ignored=new Set(['the','and','for','with','from','that','this','candidate','experience','worked']);
    const terms=[...new Set((claim.toLowerCase().match(/[\p{L}\p{N}+#.]+/gu)||[]).filter(w=>w.length>2&&!ignored.has(w)))];
    const parts=text.split(/\r?\n|[•\uF0B7]/).flatMap(segments).filter(Boolean);
    const ranked=parts.map((part,i)=>({part,i,score:terms.filter(t=>part.toLowerCase().includes(t)).length})).sort((a,b)=>b.score-a.score||a.i-b.i);
    const best=ranked[0],next=best&&parts[best.i+1];
    // An adjoining qualifier can reverse a positive-looking sentence. Keep it.
    const selected=best&&next&&caution.test(next)?text.slice(text.indexOf(best.part),text.indexOf(next,text.indexOf(best.part)+best.part.length)+next.length):best?.part||text;
    return windowOf(selected,limit);
  }
  function evidenceHTML(values,limit=3){
    return (values||[]).slice(0,limit).map(value=>{const e=evidence(value);return '<li><strong>'+escape(brief(e.claim,24))+'</strong>'+(e.quote?'<blockquote class="rf-evidence-excerpt">'+escape(excerpt(e.quote,e.claim))+'</blockquote>':'')+'</li>';}).join('');
  }
  function sellingPoints(candidate){
    // Never turn a mixed/negative observation into praise by trimming its caveat.
    // Free-form internal feedback is deliberately not copied to a client draft.
    const seen=new Set();
    return (candidate.strengths||[]).map(evidence).map(e=>clean(e.claim)).filter(claim=>{
      const key=claim.toLowerCase();
      if(!claim||seen.has(key)||caution.test(claim)||/\b(?:confirm|verify|concern|gap|needs? clarification)\b/i.test(claim))return false;
      seen.add(key);return true;
    }).map(claim=>segments(claim)[0]).filter(claim=>words(claim).length<=26).slice(0,5);
  }
  const api={brief,evidence,excerpt,evidenceHTML,sellingPoints,words,clean};
  if(typeof module!=='undefined')module.exports=api;global.AncalagonPresentation=api;
})(typeof window==='undefined'?globalThis:window);
