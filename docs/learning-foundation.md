# Feedback learning before beta

This release adds a learning **pipeline**, not an already-trained model. Existing Accept and Correct controls continuously capture potential examples. Training is a deliberate operator action after workspace authorization and curation. A trained version only serves that workspace after a held-out evaluation passes. No page layouts, candidate scores, approval controls or hiring decisions change.

The first task is interpreting a recruiter note as `{summary, clarification_question}`. Resume assessment, score calculation and interview outcomes are not training labels. A hired candidate does not establish that an assessment was correct. Company-specific facts and current role requirements continue to arrive as request context, not as model memory.

## Training availability (verified September 17, 2026)

OpenAI self-serve fine-tuning is restricted to eligible existing organizations: new organizations lost access May 7, 2026; since July 2, organizations without fine-tuned inference in the preceding 60 days cannot create jobs. New jobs close for the remaining active customers January 6, 2027. Existing fine-tuned inference follows the underlying model's retirement date. Source: [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations#update-to-openais-self-serve-fine-tuning).

Ancalagon's account eligibility has **not** been verified. Deploying this release enables private feedback capture and the evaluation/model registry; it does not establish that model training is available. Before running `train`, verify access for the actual provider organization/project through the provider dashboard or support and record the evidence with `--eligibility-record`. The CLI records that operator verification and checks the shutdown date before any training upload; it cannot independently certify account eligibility. Without access, continue collecting eligible examples and adapt the training/evaluation/model-routing adapter to a supported provider before training. Do not upload a dataset simply to probe availability.

## What happens automatically

- A successful interpretation retains its original input and output alongside the existing private interpretation. Accept/Correct preserves that snapshot. Older interpretations without snapshots are not backfilled or presented as faithful training examples.
- Saving a reviewed interpretation creates a deduplicated, workspace-scoped candidate example. The database checks the source note, candidate, job, workspace, feedback type and outcome. Ordinary saves retain example identities.
- Replacing a review or editing/deleting its source invalidates the corresponding example and deactivates releases that used it. Account deletion cascades through local learning data. Withdrawal disables model routing immediately on the next request.
- Authenticated feedback requests resolve the active model using the user's own workspace permissions. The registry is uncached. A missing registry or failed custom model falls back to the pinned base model. Screening and resume scoring never consult this registry.
- Capturing or accepting an example does **not** authorize export, upload data, start training, change model weights or activate a model. Private snapshots are subject to the same access and retention expectations as their source feedback.

## Operator workflow

Use Node 22 or later. Keep one private directory per workspace and training run, under ignored `.learning/`. Never commit exports, datasets, ratings, credentials or manifests. Files are written with owner-only permissions; disk encryption and an appropriate retention process are still required. Do not use a shared public build artifact location.

For database operations use the existing `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` operator credentials. `authorize` instead requires the owner's `SUPABASE_USER_TOKEN` and the public `SUPABASE_ANON_KEY`; service credentials cannot impersonate owner approval through this command. Set credentials through your secure environment, never command arguments or committed files. OpenAI commands use `OPENAI_API_KEY` from the same dedicated provider project that will serve the model.

```bash
node scripts/learning.mjs status --workspace WORKSPACE_UUID
node scripts/learning.mjs authorize --workspace WORKSPACE_UUID --record 'Reference to the approved training purpose, data authorization, retention and withdrawal process.'
node scripts/learning.mjs export --workspace WORKSPACE_UUID --dir .learning/pilot-01
# Curate .learning/pilot-01/curated.json, using export.json as evidence.
node scripts/learning.mjs build --workspace WORKSPACE_UUID --dir .learning/pilot-01
# Explicit paid operation: uploads the training split and starts one job.
node scripts/learning.mjs train --workspace WORKSPACE_UUID --dir .learning/pilot-01 --eligibility-record 'Reference to current provider confirmation for this organization/project.'
node scripts/learning.mjs poll --workspace WORKSPACE_UUID --dir .learning/pilot-01
# Run after poll reports succeeded. This makes paid inference calls.
node scripts/learning.mjs evaluate --workspace WORKSPACE_UUID --dir .learning/pilot-01
# Review evaluation.json against dataset.json; complete ratings.json.
node scripts/learning.mjs promote --workspace WORKSPACE_UUID --dir .learning/pilot-01
```

Owner authorization must reflect actual permission to use the candidate/client material for this purpose; it is not established merely by owning the application. Record the applicable authorization before export. Leave training disabled for workspaces whose data is not eligible.

### Curation

`export.json` contains private source input, original model output, accepted/corrected text and review metadata. `curated.json` starts with empty inputs and targets, not pre-approved content. Remove unready entries. For each remaining example:

1. Read the original evidence and the recruiter's reviewed interpretation. Verify that the correction is supported. Reject unsupported conclusions and protected-trait or personal-similarity inferences; do not encode a recruiter's bias as a target.
2. Write a minimal input retaining the job title, note and necessary job-related context. Replace names with consistent neutral placeholders. Remove contact information, source identifiers, client/company identifiers, protected traits and identifying combinations throughout nested context. Keep scope and chronology intact. Avoid repeated candidates across jobs in different splits.
3. Write the ideal `summary` and `clarification_question` (string or null). Corrected text may combine a summary and a question; separate them manually. Do not assume the original AI question remains appropriate after correction.
4. Enter `reviewer` and explicitly attest `authorized`, `deidentified` and `faithful_to_review`. These flags document a human decision; the automated identifier scan is only a backstop and cannot guarantee anonymization.

The pilot requires at least 50 training and 10 held-out examples across at least three jobs. Complete jobs are deterministically assigned to the test split; imbalanced job sizes can require more examples. The current cap is 1,000 examples, 24,000 characters per example and a 10 MB training file, with three epochs. Inspect the dataset size and current provider pricing before `train`; those caps are not a monetary budget guarantee.

Only training messages are uploaded as the fine-tuning dataset; held-out examples are not included as a validation file. They are sent later as inference inputs for comparison. The fixed prompt and JSON schema are shared by training, evaluation and live inference. The configured base for eligible legacy training accounts and fallback inference is `gpt-4.1-mini-2025-04-14`. Changing the task/prompt/schema requires a version bump and a new evaluated release.

### Evaluation and release

Every held-out case needs human ratings tied to a hash of its exact outputs. Rate both models on the same 1–5 scale: 1 materially wrong, 2 substantial correction needed, 3 useful with correction, 4 accurate with minor wording issues, 5 accurate and directly useful. Judge meaning, evidence, candidate-only scope and whether clarification is necessary. Inspect the input and reviewed target, not just the model prose. A separate reviewer is preferable when practical.

Activation requires all of:

- Candidate mean at least 4/5, and at least 0.1 above the current baseline.
- No candidate output with an unsupported claim or unsafe scope, and valid structured output from both models in every case.
- Complete reviewer identities and ratings, unchanged source revisions, current permission and a completed training job matching the run.
- An unchanged active baseline at activation. The database serializes promotions and locks source examples against concurrent deletion.

These are pilot release gates, not proof of broad accuracy. Include difficult, ambiguous, negative and corrected notes; do not tune against a repeatedly reused holdout. Reserve new jobs for later comparisons, review failure patterns, and increase the test set as usage grows. A failed gate leaves the current model in place. Raw inference outputs do not become approved training data automatically.

Evaluate compares the model active when the run began; if that baseline changes, use a fresh run/comparison. `run.json` records job/file IDs; `evaluation.json` and `ratings.json` record the comparison; `release.json` and the private database registry record the activation metrics and audit hash. Protect these files and retain them for the agreed audit period. Failed or interrupted calls must not be silently retried if they could create duplicate paid training jobs. A `creation_pending` run needs reconciliation through the provider's dashboard: match its training file and recorded suffix, record the confirmed job ID, then poll. Never delete the manifest and run `train` again to work around an uncertain response.

## Rollback, withdrawal and cleanup

```bash
node scripts/learning.mjs rollback --workspace WORKSPACE_UUID
node scripts/learning.mjs authorize --workspace WORKSPACE_UUID --disable --record 'Reference to the withdrawal request.'
node scripts/learning.mjs cleanup --workspace WORKSPACE_UUID --dir .learning/pilot-01
```

Rollback routes subsequent requests to the base model. Withdrawal also invalidates stored releases. Source changes/deletion deactivate affected models, but **do not erase learned weights or remotely stored provider files**. For every affected run, the operator must cancel unfinished training, delete inactive custom models and provider training/result files using `cleanup`, and remove private local exports according to the retention agreement. Cleanup refuses to delete an active model. Preserve run manifests until cleanup is confirmed, including after workspace/account deletion. If a creation or deletion response was lost, reconcile provider state before retrying. Provider job audit records and provider retention policies are separate from application deletion.

For beta, review readiness and invalidated runs regularly, curate new examples, and schedule a new supervised cycle when enough eligible work exists. Capture is continuous; training and deployment remain reviewed operator steps. No recurring paid jobs or automatic promotions are installed. Before describing the product as improving through training, complete at least one authorized real-data training/evaluation cycle and document the measured result.

## Deployment and verification

The existing backend release workflow installs the idempotent migration before deploying authenticated analysis functions. There are no new production secrets and no training job in CI. The live deployment check uses disposable accounts to verify accepted/corrected feedback capture, deduplication, workspace isolation and inactive training/model defaults before publishing browser changes. The browser asset versions only change to deliver snapshot capture. Roll out the pipeline first, record workspace permission, collect and curate examples, then perform the first model release.

```bash
node --test tests/*.test.js
deno test --allow-env tests/learning-routing.test.ts tests/analysis-latency.test.ts
psql -v ON_ERROR_STOP=1 -f tests/learning.sql
```

Database tests use a fresh disposable database with synthetic users and notes. CI covers capture/deduplication, stale/forged snapshots, isolation, owner authorization, promotion gates, deletion and fallback. These tests exercise the pipeline, not model quality; live training and human evaluation are still required.
