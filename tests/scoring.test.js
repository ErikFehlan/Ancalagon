const assert = require('node:assert/strict');
const test = require('node:test');
const scoring = require('../assets/scoring.js');

test('score ledger reconciles baseline, preferences, and final score', () => {
  const result = scoring.calculate({ evidenceBaseline: 8.5, preferenceAdjustment: 0.3 });
  assert.deepEqual(result, {
    evidenceBaseline: 8.5, preferenceAdjustment: 0.3, calculatedScore: 8.8,
    overrideAdjustment: 0, finalScore: 8.8, recommendation: 'Strong Consideration'
  });
});

test('approved overrides are explicit and scores remain in range', () => {
  const result = scoring.calculate({ evidenceBaseline: 9.8, preferenceAdjustment: 1.2, approvedOverride: 8.4 });
  assert.equal(result.calculatedScore, 10);
  assert.equal(result.overrideAdjustment, -1.6);
  assert.equal(result.finalScore, 8.4);
  assert.equal(result.recommendation, 'Strong Consideration');
});

test('recommendation thresholds have stable boundary behavior', () => {
  assert.equal(scoring.recommendation(9.2), 'Interview');
  assert.equal(scoring.recommendation(8.3), 'Strong Consideration');
  assert.equal(scoring.recommendation(7.2), 'Consider');
  assert.equal(scoring.recommendation(6), 'Screen First');
  assert.equal(scoring.recommendation(5.9), 'Not Recommended');
});
