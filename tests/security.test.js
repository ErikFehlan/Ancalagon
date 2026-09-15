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

test('technical sections and starter source are absent from the public app bundle', () => {
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const source=fs.readdirSync(path.join(root,'assets')).filter(file=>file.endsWith('.js')).map(file=>fs.readFileSync(path.join(root,'assets',file),'utf8')).join('\n');
  assert.doesNotMatch(html,/1\. Hybrid Engine Connection|2\. Starter Files|3\. What the backend will do|4\. MCP Tools|5\. Deployment Checklist|id="downloadServer"|id="patternAnonKey"/);
  assert.doesNotMatch(source,/function backendTemplates|Resume Fit backend running|postgresql:\/\/user:password@host/);
  assert.match(fs.readFileSync(path.join(root,'.github/workflows/deploy-pages.yml'),'utf8'),/path: _site/);
});
