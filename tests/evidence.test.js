const assert=require('node:assert/strict');
const test=require('node:test');
const {matches}=require('../assets/evidence.js');
test('negative and uncertain mentions never become supporting evidence',()=>{
 for(const text of ['No Kubernetes experience','Lacks Kubernetes experience','Kubernetes experience is unknown','Need to verify Kubernetes experience','Without Kubernetes experience'])assert.equal(matches(text,'kubernetes'),false,text);
 assert.equal(matches('Built production Kubernetes clusters','kubernetes'),true);
 assert.equal(matches('JavaScript development','java'),false);
});
