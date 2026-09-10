const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const candidateId = '44444444-4444-4444-8444-444444444444';
const calls = [];
const rows = {
  jobs: [{ id: jobId, workspace_id: workspaceId, title: 'QA Analyst', criteria: [], knockouts: [], weights: [], pattern_analysis: { summary: 'Remote result' }, status: 'closed', close_reason: 'Filled Internally', closed_at: '2026-09-10T00:00:00Z', hired_candidate_id: null, created_at: '2026-09-09T00:00:00Z', updated_at: '2026-09-09T00:00:00Z' }],
  candidates: [{ id: candidateId, workspace_id: workspaceId, job_id: jobId, name: 'Test Candidate', stage: 'Sourced', jd_score: 8, manager_score: 7.5, strengths: [], concerns: [], tags: [], screening_questions: [], created_at: '2026-09-09T00:00:00Z', updated_at: '2026-09-09T00:00:00Z' }],
  manager_feedback: [], interview_outcomes: [], candidate_benchmarks: [], screening_insights: [], candidate_assessments: []
};

function table(name) {
  return {
    select() { return { eq(column, value) { calls.push(['select-eq', name, column, value]); return Promise.resolve({ data: rows[name] || [], error: null }); } }; },
    upsert(data) { calls.push(['upsert', name, data]); return Promise.resolve({ error: null }); },
    insert(data) { calls.push(['insert', name, data]); return Promise.resolve({ error: null }); },
    delete() {
      return {
        eq() { calls.push(['delete-eq', name]); return Promise.resolve({ error: null }); },
        in() { calls.push(['delete-in', name]); return Promise.resolve({ error: null }); }
      };
    }
  };
}

const client = {
  from: table,
  storage: { from() { return { upload: async () => ({ error: null }), remove: async () => ({ error: null }) }; } }
};
const context = { window: {}, console, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto };
vm.runInNewContext(fs.readFileSync('assets/data.js', 'utf8'), context);

(async () => {
  const service = context.window.AncalagonData.create({ client, workspace: { id: workspaceId }, session: { user: { id: userId } } });
  const loaded = await service.load();
  assert.equal(loaded.jobs[0].title, 'QA Analyst');
  assert.equal(loaded.candidates[0].jobId, jobId);
  assert.equal(loaded.candidates[0].managerScore, 7.5);
  assert.equal(loaded.jobs[0].patternAnalysis.summary, 'Remote result');
  assert.equal(loaded.jobs[0].status, 'closed');
  assert.equal(loaded.jobs[0].closeReason, 'Filled Internally');
  assert.ok(calls.filter(call => call[0] === 'select-eq').every(call => call[3] === workspaceId));

  await service.flush({ jobs: loaded.jobs, candidates: loaded.candidates, feedback: [], interviewOutcomes: [] });
  assert.ok(calls.some(call => call[0] === 'upsert' && call[1] === 'jobs'));
  assert.equal(calls.find(call => call[0] === 'upsert' && call[1] === 'jobs')[2][0].pattern_analysis.summary, 'Remote result');
  assert.equal(calls.find(call => call[0] === 'upsert' && call[1] === 'jobs')[2][0].status, 'closed');
  assert.ok(calls.some(call => call[0] === 'upsert' && call[1] === 'candidates'));
  assert.ok(calls.some(call => call[0] === 'delete-eq' && call[1] === 'candidate_benchmarks'));
  console.log('data service load and persistence checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
