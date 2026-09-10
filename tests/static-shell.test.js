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
  assert.match(html, /src="assets\/app\.js\?v=[^"]+"/);
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

