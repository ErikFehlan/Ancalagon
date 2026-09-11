const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const productionFiles = ['index.html', 'assets/app.js', 'assets/auth.js', 'assets/data.js', 'assets/scoring.js'];

test('production client does not contain server-side secrets', () => {
  const source = productionFiles.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /\bsk-[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|"role"\s*:\s*"service_role"/i);
  assert.doesNotMatch(source, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
});
