(function(global) {
  'use strict';
  // A text mention is a lead to verify, never proof of a requirement.
  function matches(text, term) {
    const escaped = String(term).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escaped) return false;
    const pattern = new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'g');
    text = String(text).toLowerCase();
    for (const match of text.matchAll(pattern)) {
      const clause = text.slice(0, match.index + match[0].length).split(/[.!?;\n]/).pop();
      const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 50);
      if (/\b(no|not|never|without|lack\w*|limited|unfamiliar|unclear|unknown|verify|confirm)\b/.test(clause)) continue;
      if (/^\s+(experience\s+)?(is\s+)?(missing|unknown|unclear|unverified|not\b)/.test(tail)) continue;
      return true;
    }
    return false;
  }
  const api = {matches};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.AncalagonEvidence = api;
})(typeof window === 'undefined' ? globalThis : window);
