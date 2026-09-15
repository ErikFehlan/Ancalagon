(function(global){
  'use strict';
  // PDF.js already supplies spaces and line boundaries. Adding a space between
  // every item splits words at font changes and ligatures (for example fi/fl).
  function pageText(items){
    return items.map(item=>typeof item.str==='string'?item.str+(item.hasEOL?'\n':''):'').join('').trim();
  }
  const api={pageText};
  if(typeof module!=='undefined')module.exports=api;
  global.AncalagonPdfText=api;
})(typeof window==='undefined'?globalThis:window);
