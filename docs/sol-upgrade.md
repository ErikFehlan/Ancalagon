# Sol assessment upgrade

Candidate resume assessments (including durable intake), screening reassessments,
background job reassessments, and default manager-feedback interpretation use
`gpt-5.6-sol`. The page layout, schemas, source validation, approval controls,
timeouts, and output limits are preserved. GPT-4.1 mini did not use reasoning;
Sol explicitly uses `reasoning.effort: none` to avoid inheriting its medium default.
Any future increase in reasoning effort needs its own latency and quality check.

Pattern summaries and criteria refinement keep their inexpensive model settings.
PDF/Word extraction and OCR remain local deterministic/library operations.
Previously approved workspace-specific fine-tunes retain their scoped override;
failure of that override now falls back to the configured default feedback model.
No training job or data upload is enabled by this release. The legacy training
tooling remains pinned to its old base and must be re-baselined against Sol before
training/promotion is resumed; its old evaluations do not establish improvement
over the new live model.

## Deployment gate

Before production handlers are replaced, the workflow temporarily deploys
`sol-model-check`, which requires the existing private worker credential and accepts only
fixed synthetic cases and two fixed models. Six budgeted model requests compare
the old base and Sol on resume, feedback, and screening contracts. Failure stops
the rollout. The temporary endpoint is removed even when the comparison fails.
Only synthetic text, model identity and timing are logged. Synthetic account and
workspace resources are deleted; global AI usage reservations are retained.

This is a compatibility and focused evidence smoke check, not a broad quality
benchmark. User-reviewed real examples are still needed to measure practical
quality improvement. Live integration checks also require Sol model provenance
on the deployed intake and both authenticated analysis endpoints.

The first live comparison exposed a shared baseline/Sol failure: a title-only
QA job caused a score reduction for missing automation despite no automation
requirement being supplied. Screening instructions now explicitly forbid
title-inferred requirements and preserve baseline scores when their relevant
job requirements or manager priorities are absent. The Sol preflight checks
this exact case before deployment.

## Configuration and rollback

The release explicitly sets `ASSESSMENT_MODEL`, `FEEDBACK_MODEL`, and
`REASSESSMENT_MODEL` to `gpt-5.6-sol` in Supabase. A stale `OPENAI_MODEL` no longer
overrides assessments; it still controls general pattern summaries. Provider
credentials are never changed or exposed. A rollback can set these three values
to `gpt-4.1-mini-2025-04-14`; Sol-only parameters are omitted automatically.
The live smoke assertions and preflight gate must match an intentional rollback.

Sol's published standard text rates checked during implementation are $4 per
million input tokens and $20 per million output tokens. Existing quotas still
apply, but the same request count can cost more. No dollar-spend guarantee is
implied by the call/token limits.

Source: https://developers.openai.com/api/docs/models/gpt-5.6-sol
The detailed online migration guide was unavailable; the bundled OpenAI Docs
migration notes supplied compatibility guidance, with actual API behavior gated
by the synthetic preflight.
