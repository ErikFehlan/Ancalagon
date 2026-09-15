const test=require('node:test'),assert=require('node:assert/strict');
const {pageText}=require('../assets/pdf-text.js');
const intake=require('../assets/resume-intake.js');
test('PDF fragments retain words, explicit spaces, punctuation, and line boundaries',()=>{
  const items=[{str:'Synthetic Analyst',hasEOL:true},{str:'Certi'},{str:'fi'},{str:'ed reviewer',hasEOL:true},
    {str:'Built work'},{str:'fl'},{str:'ows'},{str:','},{str:' '},{str:'not approved',hasEOL:true},
    {type:'endMarkedContent'},{str:'Used a 1–3 risk model.'}];
  const result=pageText(items);
  assert.equal(result,'Synthetic Analyst\nCertified reviewer\nBuilt workflows, not approved\nUsed a 1–3 risk model.');
  assert.notEqual(result,items.map(x=>x.str||'').join(' ').trim(),'reproduces the previous split-word bug');
});
test('source citations handle saved split PDF words without accepting invented quotes or source IDs',async()=>{
  const {resumeSources,resolveResumeSources}=await import('../supabase/functions/analyze-patterns-v2/resume-sources.mjs');
  const text='Synthetic Analyst\nBuilt audit work fl ows and veri fi ed evidence. Did not lead the audit. Used a 1–3 risk model.';
  const sources=resumeSources(text);
  const draft={name:'Synthetic Analyst',role:'Analyst',score:7,manager_score:7,primary_signal:'Audit workflow evidence',jd_reason:'Audit support',manager_reason:'Automation',concerns:[],tags:[],screening_questions:[],resume_evidence:[{claim:'Supported audit workflows',source_id:sources[0].id}]};
  const result=intake.validate(resolveResumeSources(draft,sources),text);
  assert.equal(result.resume_evidence[0].quote,text);
  assert.throws(()=>resolveResumeSources({...draft,resume_evidence:[{claim:'Invented',source_id:'not-a-source'}]},sources),e=>e.code==='invalid_evidence');
  assert.throws(()=>resolveResumeSources({...draft,resume_evidence:[{claim:'Invented',source_id:sources[0].id,quote:'Led the audit'}]},sources),e=>e.code==='invalid_evidence');
  assert.throws(()=>intake.validate({...result,resume_evidence:[{claim:'Led audit',quote:'Led the audit and used a 1–3 risk model.'}]},text),e=>e.code==='unmatched_quote');
});
test('source passage boundaries preserve all original evidence within quote limits',async()=>{
  const {resumeSources}=await import('../supabase/functions/analyze-patterns-v2/resume-sources.mjs');
  for(const text of [
    ('Did not lead the review. • Supported 1–3 projects and verified evidence.\n').repeat(1200)+'Short tail',
    'x'.repeat(119999),
    ('Detailed review documentation with explicit limits and negation. ').repeat(12)+'End.'
  ]){
    const sources=resumeSources(text);
    assert.equal(sources.map(s=>s.text).join(''),text);
    assert.equal(new Set(sources.map(s=>s.id)).size,sources.length);
    assert.ok(sources.every(s=>s.text.length<=1000&&s.text.trim().length>=12));
  }
});
