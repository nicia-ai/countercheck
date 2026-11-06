# Separate calibration and human-adjudication proposal

Status: **protocol and $57.60 / 28,800-call budget approved; execution complete**. The immutable protocol retains its original pending status; [approval.json](../../eval/results/calibration-preparation-2026-11-05/approval.json) records the subsequent authorization. Prepared November 5, 2026. The shipped service, profiles, thresholds and default model are unchanged.

Protocol: [protocol.json](../../eval/results/calibration-preparation-2026-11-05/protocol.json). SHA-256: `3febdaed3c22ad1396ea98dec60b5e747ee52700ac417bb88949b216cc29c0f2`. The [freeze](../../eval/results/calibration-preparation-2026-11-05/freeze.json) pins 52 source files, prepared input hashes, prior split metadata, and the packet registry. Run `pnpm exec tsx scripts/prepare-calibration-study.ts verify` before an approved dispatch.

## Cohort and separation

The cohort uses original public train splits through existing adapters. Complete source groups are sampled with a fixed seed, with no truncation. VitaminC page/revision and SciFact connected claim/document components reuse the existing training preparer; business adapters retain complete evidence and premise/source groups. Protected groups are excluded using existing lock metadata; held-out manifests were not opened. The new fit and validation groups are disjoint. Identical normalized/reversed pair collisions are excluded by whole group.

| Dataset     | Fit pairs | Fit positives / positive groups | Validation pairs | Validation positives / positive groups |
| ----------- | --------: | ------------------------------: | ---------------: | -------------------------------------: |
| vitaminc    |       742 |                        269 / 38 |              258 |                                90 / 10 |
| scifact     |       331 |                        121 / 49 |               69 |                                24 / 13 |
| contractnli |       643 |                        115 / 55 |              157 |                                30 / 15 |
| mnli        |       796 |                       266 / 262 |              204 |                                68 / 66 |

Prior optimization exposure to public train data is disclosed. This is group-disjoint calibration/validation, not a new untouched release test. Finance contributes no fitting or validation data; its published scorecard is evaluated only as transfer of thresholds fitted on the other domains. Exclusions, achieved sizes, source hashes and every selected ID/group/text hash are in the cohort registry. Source text remains in ignored local manifests.

## Declared policy and execution

- One **global policy per model** across all four fit domains. No per-domain secondary fitting is planned.
- Positive gate: maximize fit recall with ≥95% observed fit precision. Existing threshold selection uses observed scores plus the fixed 0.01 grid; ties favor higher precision then higher cutoff. If no nonempty point qualifies, disable positive decisions and report that result.
- Negative gate: maximize fit clear-negative count with **zero fit false clears**, following `eval/iteration/calibrate.ts`’s existing `zero_training_false_clears` constraint. The bridge uses `max(consistent, different_scope)` to preserve the shipped negative-support definition. Positive decisions take precedence. Validation false clears are reported without reselection; zero observed fit errors is not a population guarantee.
- Four-way model outputs and their identities remain preserved. Only offline verdict mapping changes; no new questions, examples, numerical overrides, model fallbacks or service configuration changes.
- Run fit predictions first, using the existing bounded runner. Fit and hash each policy before any validation inference. Execute once, sequentially, batch size one, 3,000 ms kernel deadline, no retries. Attribute every selected outcome; explicit errors remain misses and have no imputed score. Abort for missing or unmatched rows.
- Apply frozen policies to archived November 5 outputs without new calls on the 880. Publish per-domain precision, recall, negative coverage, false clears, errors, change from shipped policy and metric-matched paired source-group intervals, including models that do not improve. The original archives and the verifier’s existing summary stay byte-unchanged. The [calibrated scorecards](../../eval/results/separate-calibration-2026-11-05/README.md) are complete; Jev’s validation had no successful assessments and is not semantic validation evidence.

## Calls and operator reservation

Each model has 2,512 fit calls plus 688 validation calls: **3,200 maximum calls**, with a **$6.40** reservation at $0.002/call.

| Model                                | Fit calls | Validation calls | Total cap | Reservation |
| ------------------------------------ | --------: | ---------------: | --------: | ----------: |
| `jev-1.14.0`                         |     2,512 |              688 |     3,200 |       $6.40 |
| `clef`                               |     2,512 |              688 |     3,200 |       $6.40 |
| `clef-flash`                         |     2,512 |              688 |     3,200 |       $6.40 |
| `clef-omni`                          |     2,512 |              688 |     3,200 |       $6.40 |
| `gpt-6-luna`                         |     2,512 |              688 |     3,200 |       $6.40 |
| `microsoft/microsoft-decision-1`     |     2,512 |              688 |     3,200 |       $6.40 |
| `perplexity/pplx-decider-v1.2`       |     2,512 |              688 |     3,200 |       $6.40 |
| `perplexity/pplx-decider-flash-v1.2` |     2,512 |              688 |     3,200 |       $6.40 |
| `fastino/GLiDE`                      |     2,512 |              688 |     3,200 |       $6.40 |

**Total: 28,800 maximum calls / $57.60 operator reservation.** This is not a measured invoice, vendor price quote, or provider-enforced cap. No extra probes or retries are included. The planned command file is inert text, not approval to run it. The owner approved this protocol and budget before dispatch; all fit and validation attempts are complete.

## Human packet

Status: **packet prepared, not yet labelled**. There are 204 items: 68 never-caught positives, 68 caught-positive controls and 68 native-negative controls, matched by dataset and nearest evidence-length bin. Membership selection is seeded; presentation and opaque IDs are randomized. Frozen packet and private-key hashes identify the exact issued version.

The packet, operator key, rubric and three blank annotation templates are under ignored `eval/data/calibration-study-2026-11-05/adjudication/`. Give each annotator only the blind packet, rubric and their template. Keep the key, native labels, model outputs and membership hidden. All real judgments are null; no AI adjudication is performed. All FinDVer source text stays local. Public files contain only identities, hashes, original label metadata and aggregate measurements.

Allowed outcomes are contradiction, consistent, different_scope, insufficient_context and excerpt_insufficient_to_judge. The rubric covers bounds/exact values, omission, scope/time, quantifiers, aliases and missing excerpt context. The two annotators first work independently. A distinct third human records final adjudication for every item. The tooling checks complete identity sets, frozen content hashes and human/independence attestations; it cannot itself prove who authored the judgments.

After humans finish:

```sh
pnpm exec tsx scripts/prepare-calibration-study.ts adjudicate \
  --key eval/data/calibration-study-2026-11-05/adjudication/operator-key.json \
  --packet eval/data/calibration-study-2026-11-05/adjudication/packet.json \
  --first FIRST-HUMAN.json --second SECOND-HUMAN.json --final ADJUDICATOR.json \
  --out eval/data/calibration-study-2026-11-05/human-labels-and-scorecard.json
```

Blank templates are rejected. The output records separate service-contract labels and a separate fixed-policy scorecard; native labels are unchanged. Free-text rationales remain local, and only their hashes are exported. This enriched sample does not estimate general traffic accuracy and does not replace the human release corpus.

## Following experiment, outside this budget

Completed misses whose leading score is `insufficient_context` or `different_scope` total 162/1,333 (12.2%), plus four top-score ties retained separately. A later, separately frozen prompt experiment can test task-aligned wording/examples around those exits while preserving the exits and comparing provider-compatible formulations. These counts do not establish that deleting either exit helps. It requires new budget approval and fresh inference; it is not included here.
