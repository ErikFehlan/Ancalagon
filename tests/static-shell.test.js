const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('production shell references modular application assets', () => {
  assert.match(html, /href="assets\/app\.css\?v=[^"]+"/);
  assert.match(html, /src="assets\/auth\.js\?v=[^"]+"/);
  assert.match(html, /src="assets\/data\.js\?v=[^"]+"/);
  assert.match(html, /src="assets\/select\.js\?v=[^"]+"/);
  assert.match(html, /src="assets\/scoring\.js\?v=[^"]+"/);
  assert.match(html, /src="assets\/app\.js\?v=[^"]+"/);
  assert.match(html, /id="managerPreferenceProfile"/);
  assert.match(html, /id="reevaluateCandidates"/);
  assert.match(html, /id="reevaluationResults"/);
  assert.match(html, /id="jobGuideSteps"/);
  assert.match(html, /<details class="rf-card rf-job-guide"/);
  assert.match(html, /Analyze Hiring Patterns/);
  assert.match(html, /Update Candidate Evaluations/);
  assert.match(html, /id="submissionReadiness"/);
  assert.match(html, /id="requirementEvidenceRows"/);
  assert.match(html, /id="copySubmissionSummary"/);
  assert.match(html, /id="syncStatus"/);
  assert.match(html, /id="qualityLab"/);
  assert.match(html, /src="assets\/quality\.js/);
  assert.match(html, /src="assets\/quality-ui\.js/);
  assert.doesNotMatch(html, /<style(?:\s|>)/i);
  assert.doesNotMatch(html, /<script>\s*[\s\S]+?<\/script>/i);
});

test('all locally referenced application assets exist', () => {
  const localAssets = [...html.matchAll(/(?:src|href)="(assets\/[^"?]+)(?:\?[^"#]*)?"/g)]
    .map(match => match[1]);
  assert.ok(localAssets.length >= 5);
  for (const asset of localAssets) {
    assert.ok(fs.existsSync(path.join(root, asset)), `${asset} is missing`);
  }
});
