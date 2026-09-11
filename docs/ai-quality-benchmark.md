# Recruiting AI quality benchmark

Open **Usage Analytics → Recruiting scenario benchmark** as an authorized analytics admin. Select **Run AI quality check** to send four synthetic scenarios, each in two stages, to the existing authenticated analysis service. A complete run makes eight paid AI requests. No recruiting records are created or changed; the existing backend records normal AI usage.

These are synthetic composite scenarios inspired by recruiting patterns. They are not reproductions of historical candidate records and contain no actual candidate identities. Review the provisional rubrics before treating the suite as an accepted quality standard.

## What the suite tests

| Scenario | New evidence | Provisional direction check |
| --- | --- | --- |
| Polished profile, weak interview | Specific examples undermine claimed decision ownership | Manager Fit falls at least 0.3 |
| Discovery uncertainty resolved | Specific observation, workshop and tradeoff examples | Manager Fit rises at least 0.3 |
| Missing keyword | No additional evidence establishes presence or absence | Manager Fit remains within 0.5 |
| Compensation withdrawal | Availability changes without capability evidence | Manager Fit remains within 0.5 |

Each first-stage request contains only the initial evidence. The second receives that stage's scores and the follow-up evidence. Reviewer rubrics and expected score direction never go to the model. Scores and explanation fields are validated before the second request. Failed scenarios remain visible; cancellation stops subsequent requests.

Automated checks inspect output structure, score direction, and recognized bracketed source references. They do not establish that an explanation is factually grounded or that a reference supports a claim. A directional pass is not a quality verdict. A directional failure is a prompt for review, not proof that the model is wrong.

## Human review

Read both outputs and the exact evidence sent. Use the three review criteria on each case to check:

- Does the explanation distinguish observed behavior, claims and uncertainty?
- Is a score change supported by new job-related evidence?
- Did it preserve or explain contradictions instead of discarding them?
- Are cited sources and quotations accurate?
- Did it invent facts or treat compensation and availability as ability?

Mark **Acceptable reasoning**, **Needs correction**, or **Not reviewed** and add notes. Export the JSON report before refreshing or starting another run. Reports live in the tab until exported and are not saved to browser storage or the recruiting database.

## Comparing changes

Upload a previous exported report from the same suite version. Compare automated direction checks and human reviews by scenario, and inspect the recorded model identifiers, exact inputs, outputs, timestamps and response times. Repeated runs help distinguish a consistent change from model variation. A single higher count does not establish improved hiring predictions.

Change the suite version whenever scenario content, scoring thresholds or reviewer expectations change. Keep later-stage observations held out of first-stage inputs. Real historical cases require verified source records, anonymization, and explicit review of the expected behavior before inclusion.

## Validation boundaries

`node --test tests/*.test.js` validates the runner, holdout separation, scoring checks, cancellation and failures with simulated responses. The GitHub browser test covers admin visibility, running eight simulated requests, reviewing a result, export and baseline import. These tests do not measure real model reasoning quality. Establish the first live baseline from the signed-in admin screen.
