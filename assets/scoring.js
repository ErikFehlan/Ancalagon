(function (global) {
  'use strict';

  const clamp = value => Math.max(0, Math.min(10, Number(value) || 0));
  const round = value => Math.round(Number(value) * 10) / 10;

  function recommendation(score) {
    if (score >= 9.2) return 'Interview';
    if (score >= 8.3) return 'Strong Consideration';
    if (score >= 7.2) return 'Consider';
    if (score >= 6) return 'Screen First';
    return 'Not Recommended';
  }

  function calculate(input = {}) {
    const evidenceBaseline = clamp(input.evidenceBaseline);
    const preferenceAdjustment = Math.max(-1.2, Math.min(1.2, Number(input.preferenceAdjustment) || 0));
    const calculatedScore = round(clamp(evidenceBaseline + preferenceAdjustment));
    const hasOverride = Number.isFinite(Number(input.approvedOverride));
    const finalScore = hasOverride ? round(clamp(input.approvedOverride)) : calculatedScore;
    return {
      evidenceBaseline: round(evidenceBaseline),
      preferenceAdjustment: round(preferenceAdjustment),
      calculatedScore,
      overrideAdjustment: round(finalScore - calculatedScore),
      finalScore,
      recommendation: recommendation(finalScore)
    };
  }

  const api = { calculate, recommendation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.AncalagonScoring = api;
})(typeof window === 'undefined' ? globalThis : window);
