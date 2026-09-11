export function priority(raw){
 const explicit=raw.match(/^\s*(Must Have|Preferred|Bonus)\s*\|/i);if(explicit)return explicit[1].toLowerCase()==='must have'?'Required':explicit[1][0].toUpperCase()+explicit[1].slice(1).toLowerCase();
 const clean=raw.replace(/^\s*[-•]+\s*/,'');
 if(/\b(not required|not mandatory|not preferred|no requirement)\b/i.test(clean))return 'Unspecified';
 if(/\b(required|mandatory|must have)\b/i.test(clean))return 'Required';
 if(/\b(preferred|preferably)\b/i.test(clean))return 'Preferred';
 if(/\b(a plus|bonus|nice to have)\b/i.test(clean))return 'Bonus';return 'Unspecified';
}
export function prepare(input){
 const criteria=Array.isArray(input.criteria)?input.criteria:[];
 if(criteria.length>40||criteria.some(x=>typeof x!=='string'||x.length>1500))throw Error('input_too_large');
 if(JSON.stringify(input).length>60000)throw Error('input_too_large');
 return criteria.map((original,index)=>({index,original,priority:priority(original)}));
}
const numbers=s=>(s.match(/\d+(?:\.\d+)?\s*\+?/g)||[]).map(x=>x.replace(/\s/g,''));
export function validate(result,source){
 if(!Array.isArray(result?.criteria)||result.criteria.length!==source.length)throw Error('invalid_result');
 return {criteria:source.map((item,index)=>{
  const out=result.criteria[index];
  if(out?.index!==index||typeof out.label!=='string'||!out.label.trim()||out.label.length>500||typeof out.question!=='string'||!out.question.trim()||out.question.length>800)throw Error('invalid_result');
  if(JSON.stringify(numbers(item.original))!==JSON.stringify(numbers(out.label)))throw Error('threshold_changed');
  if(/\b(no|not|without|never)\b/i.test(item.original)&&!(/\b(no|not|without|never)\b/i.test(out.label)))throw Error('negation_removed');
  return {...item,label:out.label.trim(),question:out.question.trim()};
 })};
}
