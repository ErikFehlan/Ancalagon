(function(global){
  'use strict';
  function mount({call,authorize}){
    const root=document.getElementById('qualityLab');if(!root)return;
    const suite=global.AncalagonQuality;
    let report=null,baseline=null,controller=null;
    const runButton=root.querySelector('#runQualitySuite'),stopButton=root.querySelector('#stopQualitySuite'),exportButton=root.querySelector('#exportQualityReport'),status=root.querySelector('#qualityStatus'),results=root.querySelector('#qualityResults'),comparison=root.querySelector('#qualityComparison');
    function element(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cls)e.className=cls;return e;}
    function compare(){
      comparison.replaceChildren();if(!baseline)return;
      if(!report){comparison.textContent='Baseline loaded. Run the suite to compare results.';return;}
      try{
        comparison.append(element('p','Same-suite comparison. A score-direction change alone does not prove better reasoning.'));
        suite.compare(report,baseline).forEach(row=>{const label=value=>value===null?'not available':value?'met':'not met';comparison.append(element('p',`${row.caseId}: direction check ${label(row.previous)} → ${label(row.current)}; human review ${row.previousReview} → ${row.currentReview}`));});
      }catch(error){comparison.textContent=error.message;}
    }
    function render(){
      results.replaceChildren();if(!report)return;
      const met=report.results.filter(r=>r.checks?.directionPassed).length;
      results.append(element('p',`${met} of ${suite.cases.length} provisional direction checks met. Review explanations before judging quality. Run: ${report.status}.`));
      for(const row of report.results){
        const card=element('article',null,'rf-card rf-quality-case');card.append(element('h4',row.title));
        card.append(element('p',row.error||row.checks?.label||'Incomplete result'));
        if(row.checks?.valid)card.append(element('p',`Manager Fit change: ${row.checks.delta>0?'+':''}${row.checks.delta.toFixed(1)}. Source reference present: ${row.checks.citationPresent?'yes':'no'}. Unrecognized references: ${row.checks.unknownCitations.length}. References still require an accuracy review.`));
        const rubric=element('ul');row.rubric.forEach(text=>rubric.append(element('li',text)));card.append(rubric);
        const stages=element('div',null,'rf-quality-stages');
        for(const stage of row.stages){
          const column=element('section');column.append(element('h4',stage.stage==='initial'?'Before follow-up':'After follow-up'));
          const output=stage.output||{};
          column.append(element('p',`Manager Fit: ${output.manager_score??'—'} · JD Fit: ${output.jd_score??'—'} · Confidence: ${output.confidence||'—'}`));
          column.append(element('p',output.summary||''),element('p',output.manager_reason||''),element('p',output.jd_reason||''));
          column.append(element('small',`${output.model||'Model not reported'} · ${(stage.elapsedMs/1000).toFixed(1)}s`));
          const evidence=element('details');evidence.append(element('summary','Evidence sent in this stage'));stage.input.evaluation_context.sources.forEach(source=>evidence.append(element('p',`[${source.id}] ${source.text}`)));column.append(evidence);stages.append(column);
        }
        card.append(stages);
        const choices=element('div',null,'rf-actions');choices.setAttribute('role','group');choices.setAttribute('aria-label',`Review ${row.title}`);
        for(const [value,label] of [['acceptable','Acceptable reasoning'],['needs_correction','Needs correction'],['unreviewed','Not reviewed']]){
          const button=element('button',label,'rf-btn');button.type='button';button.setAttribute('aria-pressed',String(row.humanReview===value));
          button.onclick=()=>{row.humanReview=value;row.reviewedAt=new Date().toISOString();for(const b of choices.children)b.setAttribute('aria-pressed',String(b===button));compare();};choices.append(button);
        }
        card.append(choices);
        const label=element('label','Review notes');label.htmlFor=`quality-notes-${row.caseId}`;
        const notes=element('textarea');notes.id=label.htmlFor;notes.value=row.reviewNotes;notes.placeholder='Which evidence did the AI use correctly or miss?';notes.maxLength=4000;notes.oninput=()=>{row.reviewNotes=notes.value;};card.append(label,notes);results.append(card);
      }
      exportButton.disabled=false;compare();
    }
    runButton.addEventListener('click',async()=>{
      if(controller)return;
      controller=new AbortController();runButton.disabled=true;stopButton.disabled=false;exportButton.disabled=true;
      status.textContent='Checking admin access…';
      try{
        await authorize();
        report=await suite.run(call,{signal:controller.signal,onProgress:progress=>{status.textContent=`${progress.completed+1}/${suite.cases.length}: ${progress.title} — ${progress.stage==='initial'?'initial evidence':'follow-up evidence'}`;}});
        render();status.textContent=report.status==='completed'?'Run complete. Review the explanations and export your report.':'Run finished with incomplete results. Export the report to inspect errors.';
      }catch(error){status.textContent=error.message||'Unable to run the quality check.';exportButton.disabled=!report;}
      finally{controller=null;runButton.disabled=false;stopButton.disabled=true;}
    });
    stopButton.addEventListener('click',()=>{controller?.abort();status.textContent='Stopping…';stopButton.disabled=true;});
    exportButton.addEventListener('click',()=>{
      if(!report)return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const link=element('a');link.href=url;link.download=`ancalagon-quality-${report.startedAt.replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    root.querySelector('#qualityBaseline').addEventListener('change',async event=>{
      const file=event.target.files?.[0];if(!file)return;
      try{if(file.size>2_000_000)throw new Error('Choose a report smaller than 2 MB.');const parsed=JSON.parse(await file.text());suite.compare({suite:suite.version,results:[]},parsed);baseline=parsed;compare();}
      catch(error){status.textContent=`Baseline not loaded: ${error.message}`;}
      finally{event.target.value='';}
    });
  }
  global.AncalagonQualityUI={mount};
})(window);
