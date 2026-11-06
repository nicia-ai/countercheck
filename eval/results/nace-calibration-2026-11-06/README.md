# Nace Max calibration extension

Measured November 6, 2026. Drex Max and Drex Max Finance advance from the [five-model fixed-policy benchmark](../nace-2026-11-06/README.md) to separately fitted thresholds. **6,400 new calls:** the original 2,512 fit pairs and 688 group-disjoint validation pairs per model. No inference rerun on the original 880 benchmark pairs; their stored outputs are rescored for transfer, including finance. Every phase has a three-second kernel deadline, one unchanged prompt, original order, isolated pairs, sequential client attempts, free-tier pacing, no retries and no fallback.

## Findings

- **drex-max:** validation precision 97.1%, recall 62.3% (shipped 57.1%), and negative coverage 71.8%. False clears 8 → 7 on 212 native-positive cases; 3 failures stay in denominators.
- **drex-max-finance:** validation precision 96.7%, recall 69.8% (shipped 65.1%), and negative coverage 70.6%. False clears 5 → 5 on 212 native-positive cases; 1 failures stay in denominators.
- **Joint point targets:** No primary per-domain validation or archive-transfer scorecard meets all three. These native-label results do not qualify the production contract.
- **Comparison:** the previous calibrated Decider primary validates at 96.0% precision, 67.5% recall and 74.2% negative coverage on the same cases. Consult the paired intervals below; model selection, repeated public-cohort use and non-contemporaneous calls make this exploratory evidence.


## What this study establishes

The model selection followed the Nace benchmark and the earlier nine-model calibration results. This is an exploratory extension on previously studied public train cohorts, **not a newly untouched test** or human-adjudicated contract validation. The two cohorts are group/source/content disjoint. Positive cutoffs and negative policies are fitted using fit outputs only and hash-frozen before any Nace validation call. Validation never chooses or revises a cutoff or budget. No production default, model catalog or threshold changes follow automatically.

The primary maximizes fit clear negatives while allowing no more native-positive false clears than that model's shipped policy made on the same 771 fit positives. This budget definition inherits the earlier post-hoc nine-model follow-up, but is fixed **before Nace fit and validation results**. A fixed 0%, 0.5%, 1%, 2% and 5% allowance grid is sensitivity, not a validation-selected policy. Positive cutoffs target ≥95% observed fit precision; this is a point constraint, not a confidence guarantee. Errors stay misses and never receive invented scores. Budget constraints hold on fit, not automatically on validation. Model-specific budgets compare each model with its own shipped baseline; they are not an equal-risk allowance across models. This fits decision cutoffs: raw probabilities remain unchanged and are not newly calibrated truth probabilities.

Nicia has no commercial relationship with any evaluated model provider. Native public labels can disagree with the service contract; no new human-adjudicated labels are used. Finance remains transfer-only and length-conditioned. Public training contamination remains possible, and the measurements do not reproduce the vendor's broader decision index.

## Frozen policies and fit budgets

| Model | Positive cutoff | Shipped fit false-clear allowance / 771 | Primary negative cut | Primary negative support |
| --- | ---: | ---: | ---: | ---: |
| drex-max | 0.686804551 | 25 | 0.035275496 | 0.4 |
| drex-max-finance | 0.707750359 | 16 | 0.04920584 | 0.2 |

## Validation: shipped versus primary

Same 688 selected cases per model: 212 native positives and 476 negatives. Values are percentages. The negative sensitivity grid cannot change positive detections because the positive gate stays fixed and takes precedence.

| Model | Precision, shipped → fitted | Recall, shipped → fitted | Clear negatives, shipped → fitted | False clears, shipped → fitted | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| drex-max | 98.4 → 97.1 | 57.1 → 62.3 | 66.8 → 71.8 | 8 → 7 | 3 |
| drex-max-finance | 98.6 → 96.7 | 65.1 → 69.8 | 66.0 → 70.6 | 5 → 5 | 1 |

## Comparison with the previous calibrated models

Each model has its own frozen primary policy on the same validation cohort. The earlier nine-model primary was chosen after its zero-budget validation had been seen; this extension inherits that definition prospectively for the Nace calls. Different dates, policy-development histories and model selection prevent a single confirmatory eleven-model ranking.

| Model | Precision | Recall | Clear negatives | False clears / 212 | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| jev-1.14.0 | 96.6 | 54.2 | 79.4 | 18 | 0 |
| clef | 98.1 | 24.1 | 49.6 | 10 | 0 |
| clef-flash | 92.1 | 33.0 | 36.1 | 10 | 0 |
| clef-omni | 97.5 | 36.3 | 59.7 | 14 | 0 |
| gpt-6-luna | 94.5 | 32.5 | 58.0 | 27 | 0 |
| microsoft/microsoft-decision-1 | 97.8 | 42.5 | 64.9 | 13 | 0 |
| perplexity/pplx-decider-v1.2 | 96.0 | 67.5 | 74.2 | 8 | 0 |
| perplexity/pplx-decider-flash-v1.2 | 96.9 | 59.9 | 59.2 | 8 | 0 |
| fastino/GLiDE | 97.0 | 61.8 | 71.0 | 10 | 75 |
| drex-max | 97.1 | 62.3 | 71.8 | 7 | 3 |
| drex-max-finance | 96.7 | 69.8 | 70.6 | 5 | 1 |

## Primary per-domain validation and archive transfer

Targets 95% precision / 90% recall / 85% negative coverage must hold together on the same scorecard. Point estimates and exploratory bootstrap intervals do not qualify the service contract. Archive/all is a mixed-domain sensitivity diagnostic, not a quality ranking. The 23-pair strict finance subset is not added to the 82-pair denominator.

| Model | Role | Dataset | Precision | Recall | Clear negatives | False clears | Errors | All three point targets |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| drex-max | validation | vitaminc | 96.8 | 67.8 | 83.3 | 6 | 2 | No |
| drex-max | validation | scifact | 87.5 | 29.2 | 62.2 | 0 | 0 | No |
| drex-max | validation | contractnli | 100.0 | 53.3 | 64.6 | 0 | 0 | No |
| drex-max | validation | mnli | 98.0 | 70.6 | 67.6 | 1 | 1 | No |
| drex-max | validation | all | 97.1 | 62.3 | 71.8 | 7 | 3 | No |
| drex-max-finance | validation | vitaminc | 95.9 | 78.9 | 81.0 | 3 | 0 | No |
| drex-max-finance | validation | scifact | 90.9 | 41.7 | 64.4 | 0 | 0 | No |
| drex-max-finance | validation | contractnli | 100.0 | 56.7 | 63.0 | 0 | 0 | No |
| drex-max-finance | validation | mnli | 98.0 | 73.5 | 66.9 | 2 | 1 | No |
| drex-max-finance | validation | all | 96.7 | 69.8 | 70.6 | 5 | 1 | No |
| drex-max | archive | vitaminc | 87.5 | 59.2 | 74.4 | 6 | 0 | No |
| drex-max | archive | scifact | 94.6 | 49.3 | 77.3 | 3 | 0 | No |
| drex-max | archive | contractnli | 88.9 | 61.5 | 64.7 | 1 | 1 | No |
| drex-max | archive | mnli | 94.4 | 76.1 | 78.9 | 1 | 0 | No |
| drex-max | archive | findver | 100.0 | 86.4 | 86.8 | 2 | 0 | No |
| drex-max | archive | all | 93.3 | 65.2 | 74.0 | 13 | 1 | No |
| drex-max-finance | archive | vitaminc | 85.5 | 66.2 | 71.3 | 7 | 0 | No |
| drex-max-finance | archive | scifact | 95.0 | 53.5 | 69.5 | 3 | 0 | No |
| drex-max-finance | archive | contractnli | 89.5 | 65.4 | 59.5 | 0 | 0 | No |
| drex-max-finance | archive | mnli | 94.8 | 82.1 | 72.9 | 1 | 2 | No |
| drex-max-finance | archive | findver | 100.0 | 88.6 | 86.8 | 2 | 3 | No |
| drex-max-finance | archive | all | 92.9 | 70.3 | 68.9 | 13 | 5 | No |

## Validation negative-budget sensitivity

No grid entry is selected from validation. The zero-budget control remains published, including any lost coverage.

| Model | Variant | Allowed fit false clears | Validation clear negatives | Validation false clears |
| --- | --- | ---: | ---: | ---: |
| drex-max | primary | 25 | 71.8 | 7 |
| drex-max | rate_0 | 0 | 24.2 | 1 |
| drex-max | rate_0.005 | 3 | 50.0 | 5 |
| drex-max | rate_0.01 | 7 | 55.9 | 5 |
| drex-max | rate_0.02 | 15 | 65.5 | 6 |
| drex-max | rate_0.05 | 38 | 77.7 | 9 |
| drex-max-finance | primary | 16 | 70.6 | 5 |
| drex-max-finance | rate_0 | 0 | 33.4 | 2 |
| drex-max-finance | rate_0.005 | 3 | 47.7 | 2 |
| drex-max-finance | rate_0.01 | 7 | 62.0 | 4 |
| drex-max-finance | rate_0.02 | 15 | 69.1 | 4 |
| drex-max-finance | rate_0.05 | 38 | 82.4 | 6 |

## Synthetic contract controls

The 32 previously published explicit four-way contract cases are replayed after the policy freeze, never used for fitting or reselection. The eight binary smoke fixtures have no explicit four-way expectations and are not assigned new gold labels here. They test known four-way expectations, including abstention, rather than binary proxy labels. They do not establish real-world quality. Regression and improvement IDs for all sensitivity variants are retained in `analysis.json`.

| Model | Suite | Shipped correct | Primary correct | Expected-uncertain cases preserved |
| --- | --- | ---: | ---: | ---: |
| drex-max | synthetic-contract | 30/32 | 29/32 | 4/4 |
| drex-max-finance | synthetic-contract | 24/32 | 25/32 | 4/4 |

## Paired validation intervals

Differences are Nace primary minus the named control, in percentage points. Intervals use 20,000 paired source-group resamples, seed 20261106, and match the named metric. These exploratory intervals are unadjusted for multiple comparisons. JSON stores rate differences as fractions and false-clear differences as counts. All per-domain validation and archive controls are in `analysis.json`; an interval containing zero does not establish equivalence.

| Model | Control | Precision difference [95%] | Recall difference [95%] | Clear-negative difference [95%] |
| --- | --- | ---: | ---: | ---: |
| drex-max | shipped | -1.3 [-3.6, +0.3] | +5.2 [+2.3, +8.9] | +5.0 [+0.6, +10.1] |
| drex-max | zero_budget | +0.0 [+0.0, +0.0] | +0.0 [+0.0, +0.0] | +47.7 [+41.8, +54.5] |
| drex-max | decider_primary | +1.1 [-0.4, +3.5] | -5.2 [-9.8, -0.9] | -2.3 [-6.5, +1.3] |
| drex-max-finance | shipped | -1.8 [-3.8, +0.1] | +4.7 [+2.2, +8.1] | +4.6 [-0.5, +10.4] |
| drex-max-finance | zero_budget | +0.0 [+0.0, +0.0] | +0.0 [+0.0, +0.0] | +37.2 [+31.6, +43.9] |
| drex-max-finance | decider_primary | +0.8 [-1.1, +3.6] | +2.4 [-1.9, +5.8] | -3.6 [-7.9, +0.6] |

## Reproduce without model calls

```sh
python3 -B scripts/analyze-nace-calibration.py --archive eval/results/nace-calibration-2026-11-06
```

The verifier requires committed scoring artifacts and Python's standard library only. It checks every cohort against the original registry, status-only diagnostics, exact returned identity, fit-before-validation freeze receipts, source snapshots and checkpoint hashes; independently refits every cutoff/budget and recomputes the TypeScript point metrics and paired intervals. Text stays redacted, with original claim/evidence hashes. Full input-containing reports and the unsanitized operational execution receipt stay in ignored storage. Publication removes operational paths, retaining their hashes and the original receipt hash. Neither API credentials nor upstream error bodies are published.

The protocol records the operator call/spend reservation; it is not a measured charge or provider-enforced spending limit. No new financial source text, locked-role labels, prompt variants or human judgments were obtained. Quality promotion remains a separate decision.
