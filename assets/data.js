(function () {
  'use strict';

  const iso = value => new Date(Number(value) || value || Date.now()).toISOString();
  const epoch = value => value ? new Date(value).getTime() : Date.now();
  const compact = value => value == null ? null : value;

  function createDataService(auth) {
    const client = auth.client;
    const workspaceId = auth.workspace.id;
    const userId = auth.session.user.id;
    let queued = Promise.resolve();
    let timer = null;
    let pendingState = null;
    let lastFingerprint = '';

    async function query(table, columns = '*') {
      const { data, error } = await client.from(table).select(columns).eq('workspace_id', workspaceId);
      if (error) throw error;
      return data || [];
    }

    async function load() {
      const [jobRows, candidateRows, feedbackRows, outcomeRows, benchmarkRows, screeningRows, reviewRows] = await Promise.all([
        query('jobs'), query('candidates'), query('manager_feedback'), query('interview_outcomes'),
        query('candidate_benchmarks'), query('screening_insights'),
        query('candidate_assessments').then(rows => rows.filter(row => row.assessment_type === 'manual_correction'))
      ]);
      const benchmarkIds = new Set(benchmarkRows.map(row => row.candidate_id));
      const screeningByCandidate = new Map(screeningRows.sort((a, b) => epoch(a.created_at) - epoch(b.created_at)).map(row => [row.candidate_id, row]));
      const reviewByCandidate = new Map(reviewRows.sort((a, b) => epoch(a.created_at) - epoch(b.created_at)).map(row => [row.candidate_id, row]));
      return {
        jobs: jobRows.map(row => ({
          id: row.id, title: row.title, client: row.client || '', description: row.description || '',
          managerFeedback: row.manager_feedback || '', criteria: row.criteria || [], knockouts: row.knockouts || [],
          weights: row.weights || [], patternAnalysis: row.pattern_analysis || null,
          createdAt: epoch(row.created_at), updatedAt: epoch(row.updated_at)
        })),
        candidates: candidateRows.map(row => {
          const screening = screeningByCandidate.get(row.id);
          const review = reviewByCandidate.get(row.id);
          return {
            id: row.id, jobId: row.job_id, name: row.name, short: row.name, role: row.role || '',
            initials: row.name.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase(), stage: row.stage,
            score: Number(row.jd_score ?? row.resume_jd_score ?? 0), resumeJDScore: Number(row.resume_jd_score ?? row.jd_score ?? 0),
            jdScore: Number(row.jd_score ?? 0), originalManagerScore: Number(row.original_manager_score ?? row.manager_score ?? 0),
            managerScore: Number(row.manager_score ?? 0), confidence: row.confidence || 'Low', rec: row.recommendation || 'Screen First',
            signal: row.primary_signal || '', strengths: row.strengths || [], concerns: row.concerns || [], tags: row.tags || [],
            screeningQuestions: row.screening_questions || [], benchmark: benchmarkIds.has(row.id),
            createdAt: epoch(row.created_at), updatedAt: epoch(row.updated_at),
            aiReview: review ? review.evidence?.review || null : null,
            screeningInsight: screening ? {
              canDoJob: screening.can_do_job, cultureFit: screening.culture_working_style_fit, notes: screening.notes,
              assessment: { jd_score: Number(screening.resulting_jd_score), manager_score: Number(screening.resulting_manager_score), summary: screening.assessment_summary },
              source: screening.assessment_source, createdAt: epoch(screening.created_at),
              previousJDScore: Number(screening.previous_jd_score), previousManagerScore: Number(screening.previous_manager_score)
            } : null
          };
        }),
        feedback: feedbackRows.map(row => ({
          id: row.id, jobId: row.job_id, candidateId: row.candidate_id,
          candidate: candidateRows.find(candidate => candidate.id === row.candidate_id)?.name || 'Candidate',
          type: row.feedback_type, outcome: row.outcome || '', text: row.feedback_text,
          createdAt: epoch(row.created_at), updatedAt: epoch(row.updated_at)
        })),
        interviewOutcomes: outcomeRows.map(row => ({
          id: row.id, jobId: row.job_id, candidateId: row.candidate_id,
          candidate: candidateRows.find(candidate => candidate.id === row.candidate_id)?.name || 'Candidate',
          stage: row.interview_stage, decision: row.decision, positives: row.positives || '', concerns: row.concerns || '',
          notes: row.notes || '', previousStage: row.previous_pipeline_stage || 'Sourced',
          createdAt: epoch(row.created_at), updatedAt: epoch(row.updated_at)
        }))
      };
    }

    async function replaceChildren(table, rows) {
      const { error: deleteError } = await client.from(table).delete().eq('workspace_id', workspaceId);
      if (deleteError) throw deleteError;
      if (!rows.length) return;
      const { error } = await client.from(table).insert(rows);
      if (error) throw error;
    }

    async function reconcile(table, localIds) {
      const { data, error } = await client.from(table).select('id').eq('workspace_id', workspaceId);
      if (error) throw error;
      const keep = new Set(localIds);
      const removed = (data || []).map(row => row.id).filter(id => !keep.has(id));
      if (!removed.length) return;
      const { error: deleteError } = await client.from(table).delete().in('id', removed);
      if (deleteError) throw deleteError;
    }

    async function sync(state) {
      const jobRows = state.jobs.map(job => ({
        id: job.id, workspace_id: workspaceId, title: job.title, client: compact(job.client), description: job.description || '',
        manager_feedback: job.managerFeedback || '', criteria: job.criteria || [], knockouts: job.knockouts || [], weights: job.weights || [],
        pattern_analysis: job.patternAnalysis || null,
        created_by: userId, created_at: iso(job.createdAt), updated_at: iso(job.updatedAt)
      }));
      if (jobRows.length) {
        const { error } = await client.from('jobs').upsert(jobRows, { onConflict: 'id' });
        if (error) throw error;
      }

      const candidateRows = state.candidates.map(candidate => ({
        id: candidate.id, workspace_id: workspaceId, job_id: candidate.jobId, name: candidate.name || candidate.short,
        role: candidate.role || '', stage: candidate.stage || 'Sourced', resume_jd_score: candidate.resumeJDScore,
        jd_score: candidate.jdScore, original_manager_score: candidate.originalManagerScore, manager_score: candidate.managerScore,
        confidence: candidate.confidence || 'Low', recommendation: candidate.rec || 'Screen First', primary_signal: candidate.signal || '',
        strengths: candidate.strengths || [], concerns: candidate.concerns || [], tags: candidate.tags || [],
        screening_questions: candidate.screeningQuestions || [], created_by: userId,
        created_at: iso(candidate.createdAt), updated_at: iso(candidate.updatedAt)
      }));
      if (candidateRows.length) {
        const { error } = await client.from('candidates').upsert(candidateRows, { onConflict: 'id' });
        if (error) throw error;
      }

      await reconcile('candidates', state.candidates.map(x => x.id));
      await reconcile('jobs', state.jobs.map(x => x.id));

      await replaceChildren('candidate_benchmarks', state.candidates.filter(x => x.benchmark).map(candidate => ({
        workspace_id: workspaceId, job_id: candidate.jobId, candidate_id: candidate.id, created_by: userId
      })));
      await replaceChildren('manager_feedback', state.feedback.filter(x => x.candidateId).map(item => ({
        id: item.id, workspace_id: workspaceId, job_id: item.jobId, candidate_id: item.candidateId,
        feedback_type: item.type, outcome: item.outcome || null, feedback_text: item.text, created_by: userId,
        created_at: iso(item.createdAt), updated_at: iso(item.updatedAt)
      })));
      await replaceChildren('interview_outcomes', state.interviewOutcomes.filter(x => x.candidateId).map(item => ({
        id: item.id, workspace_id: workspaceId, job_id: item.jobId, candidate_id: item.candidateId,
        interview_stage: item.stage, decision: item.decision, positives: item.positives || '', concerns: item.concerns || '',
        notes: item.notes || '', previous_pipeline_stage: item.previousStage || null, created_by: userId,
        created_at: iso(item.createdAt), updated_at: iso(item.updatedAt)
      })));
      await replaceChildren('screening_insights', state.candidates.filter(x => x.screeningInsight).map(candidate => {
        const item = candidate.screeningInsight;
        return {
          workspace_id: workspaceId, job_id: candidate.jobId, candidate_id: candidate.id,
          can_do_job: item.canDoJob, culture_working_style_fit: item.cultureFit, notes: item.notes,
          previous_jd_score: item.previousJDScore, resulting_jd_score: item.assessment?.jd_score ?? candidate.jdScore,
          previous_manager_score: item.previousManagerScore, resulting_manager_score: item.assessment?.manager_score ?? candidate.managerScore,
          assessment_summary: item.assessment?.summary || '', assessment_source: item.source || 'local',
          model: item.assessment?.model || null, created_by: userId, created_at: iso(item.createdAt)
        };
      }));
      await replaceChildren('candidate_assessments', state.candidates.filter(x => x.aiReview).map(candidate => ({
        workspace_id: workspaceId, job_id: candidate.jobId, candidate_id: candidate.id, assessment_type: 'manual_correction',
        jd_score: candidate.jdScore, manager_score: candidate.managerScore, recommendation: candidate.rec,
        summary: candidate.aiReview.notes || '', evidence: { review: candidate.aiReview }, created_by: userId,
        created_at: iso(candidate.aiReview.createdAt)
      })));
      lastFingerprint = JSON.stringify(state);
    }

    function schedule(state, onError) {
      pendingState = JSON.parse(JSON.stringify(state));
      const fingerprint = JSON.stringify(pendingState);
      if (fingerprint === lastFingerprint) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = pendingState;
        queued = queued.then(() => sync(next)).catch(error => { onError?.(error); });
      }, 450);
    }

    async function flush(state) {
      clearTimeout(timer);
      await queued;
      await sync(JSON.parse(JSON.stringify(state)));
    }

    async function logUsage(operation, status, model) {
      const { error } = await client.from('ai_usage_events').insert({
        workspace_id: workspaceId, user_id: userId, operation, status, model: model || null
      });
      if (error) console.warn('AI usage event was not recorded', error);
    }

    async function uploadResume(candidate, file, extractedText) {
      const safeName = String(file.name || 'resume').replace(/[^a-zA-Z0-9._-]+/g, '-');
      const path = `${workspaceId}/${candidate.jobId}/${candidate.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await client.storage.from('resumes').upload(path, file, {
        contentType: file.type || undefined,
        upsert: false
      });
      if (uploadError) throw uploadError;
      const { error: rowError } = await client.from('candidate_documents').insert({
        workspace_id: workspaceId, job_id: candidate.jobId, candidate_id: candidate.id,
        storage_path: path, file_name: file.name, mime_type: file.type || null,
        file_size: file.size, extracted_text: extractedText || null, created_by: userId
      });
      if (rowError) {
        await client.storage.from('resumes').remove([path]);
        throw rowError;
      }
      return path;
    }

    return { load, schedule, flush, logUsage, uploadResume, workspaceId };
  }

  window.AncalagonData = { create: createDataService };
})();
