const test=require('node:test'),assert=require('node:assert/strict');
const p=require('../assets/presentation.js');
test('resume excerpt finds the relevant sentence instead of dumping a contact header',()=>{
 const source='Example Candidate | contact@example.invalid | Software Engineer. '+('Background profile and contact information. '.repeat(8))+'Performed vulnerability scans using Nessus Professional and coordinated remediation with infrastructure teams. Other work included ticket reporting.';
 const result=p.excerpt(source,'Performed Nessus vulnerability scans');
 assert.match(result,/Performed vulnerability scans using Nessus Professional/);assert.ok(p.words(result).length<=25);assert.ok(source.includes(result));assert.doesNotMatch(result,/@/);
});
test('shortening retains a late negation and an adjacent qualification',()=>{
 const source='Worked with automated tests '+('across multiple applications '.repeat(12))+'but did not write or maintain automated tests.';
 const result=p.excerpt(source,'Worked with automated tests');
 assert.match(result,/did not write or maintain automated tests/);assert.ok(p.words(result).length<=25);assert.ok(source.includes(result.replace(/^…|…$/g,'')));
 const adjacent='Worked with automated tests across the team. However, never authored or maintained them. '+('Additional context. '.repeat(20));
 assert.match(p.excerpt(adjacent,'Worked with automated tests'),/never authored/);
});
test('brief copy removes internal references while retaining uncertainty',()=>{
 const result=p.brief('Provisional score: Manual testing supports this role. Automation ownership is unclear (profile-strength-2; manager-calibration). '+('Additional discussion. '.repeat(20)),30);
 assert.match(result,/Automation ownership is unclear/);assert.doesNotMatch(result,/profile-strength|manager-calibration|Provisional/);assert.ok(p.words(result).length<=30);
});
test('client strengths omit entire mixed claims, rather than converting uncertainty to praise',()=>{
 const c={strengths:['Owned test planning','Owned test planning','Built API tests but maintenance ownership is unclear','May have managed releases; confirm scope','Supported manual regression — Resume: “Private source”','No direct automation experience','May have led security improvements']};
 const before=JSON.stringify(c),points=p.sellingPoints(c);
 assert.deepEqual(points,['Owned test planning','Supported manual regression']);assert.equal(JSON.stringify(c),before);
});
test('short excerpts preserve exact source typography and evidence HTML escapes untrusted content',()=>{
 const source='Used “Nessus”\nfor vulnerability scanning and business‑aligned remediation.';
 assert.equal(p.excerpt(source),source);
 const html=p.evidenceHTML([{claim:'<img src=x onerror=alert(1)>',quote:'Untrusted <script> markup belongs to the document.'}]);
 assert.doesNotMatch(html,/<img|<script>/);assert.match(html,/&lt;script&gt;/);
});
