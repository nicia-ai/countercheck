# Separately fitted nine-model calibration

## Findings

- On the archived probabilities, separately fitted policies recover **66/1337 (4.9%) previously missed native-positive model–pair outcomes**, while losing **105 previously detected outcomes**. Pooled recall improves for 4 models and declines for 4; the rest tie. These correlated outcomes reuse 279 native-positive pairs across nine models.
- The zero-fit-false-clear budget disables negative verdicts for **jev-1.14.0, gpt-6-luna**. The recall/precision trade-off alone does not describe the resulting negative coverage.
- All three point targets (precision ≥95%, recall ≥90%, negative coverage ≥85%) hold on **0 validation model/domain scorecards** and **0 archived model/domain scorecards**. These counts do not establish confidence-bound targets or production qualification.
- Validation semantic quality is **unmeasured** for **jev-1.14.0** because no assessments succeeded. Error counts remain in the execution-inclusive denominators; the incident is not hidden by dropping those rows.

[Protocol](../calibration-preparation-2026-11-05/protocol.json) · [Approval](../calibration-preparation-2026-11-05/approval.json) · [Frozen policies](policy-freeze.json) · [Jev validation incident](../../../docs/evaluations/separate-calibration-validation-incident-2026-11-06.md)

Offline verdict remapping only. The service, original archives and shipped-policy scorecards are unchanged. Thresholds were fitted on separate groups from four public train datasets, frozen before disjoint validation inference, then applied without new inference to the archived 880 pairs. These are reused development samples, not a fresh held-out test. Finance is transfer only.

Measured: 28,800 new pair observations; $57.60 operator reservation at $0.002/call. Actual billed cost is unknown. One sequential pass, 3,000 ms kernel deadline, no retries or fallbacks. Errors remain in recall/coverage denominators.

Positive cutoffs maximize fit recall at ≥95% observed fit precision. Negative gates maximize clear-negative count with zero fit false clears. This does not guarantee validation or population precision, or zero validation false clears. Raw four-way outputs remain preserved; operating-point fitting does not turn them into calibrated truth probabilities.

## Frozen policies

Displayed cutoffs are rounded; use full precision from `policies.json` for reproduction. A positive cutoff above 1 disables positive verdicts; negative support above 1 disables negative verdicts. Raw scores are unchanged.

| Model | Positive cutoff | Negative cutoff | Negative support | Fit distributions / selected |
| --- | ---: | ---: | ---: | ---: |
| jev-1.14.0 | 0.74 | 0 | 1.001 | 2512 / 2512 |
| clef | 0.8661 | 0.028 | 0 | 2511 / 2512 |
| clef-flash | 0.8009 | 0.0403 | 0.7 | 2512 / 2512 |
| clef-omni | 0.848 | 0.0291 | 0 | 2512 / 2512 |
| gpt-6-luna | 0.81 | 0 | 1.001 | 2511 / 2512 |
| microsoft/microsoft-decision-1 | 0.94864 | 0.00166056 | 0 | 2512 / 2512 |
| perplexity/pplx-decider-v1.2 | 0.665711 | 0.0073639 | 0.95 | 2510 / 2512 |
| perplexity/pplx-decider-flash-v1.2 | 0.74605 | 0.0171482 | 0 | 2512 / 2512 |
| fastino/GLiDE | 0.635917 | 0.00466137 | 0 | 2346 / 2512 |

## Recovery of shipped-policy misses

These native-positive transitions use the frozen policies and the same archived probabilities. Recovered misses isolate verdict-rule changes; they do not prove service-contract truth. Losses and precision changes must be considered alongside gains.

| Model | Previously missed | Recovered | Recovered % | Existing detections lost | Net recall change, pp |
| --- | ---: | ---: | ---: | ---: | ---: |
| jev-1.14.0 | 128 | 12 | 9.4 | 0 | 4.3 |
| clef | 175 | 0 | 0.0 | 26 | -9.3 |
| clef-flash | 185 | 0 | 0.0 | 0 | 0.0 |
| clef-omni | 164 | 0 | 0.0 | 24 | -8.6 |
| gpt-6-luna | 180 | 0 | 0.0 | 2 | -0.7 |
| microsoft/microsoft-decision-1 | 124 | 0 | 0.0 | 53 | -19.0 |
| perplexity/pplx-decider-v1.2 | 116 | 14 | 12.1 | 0 | 5.0 |
| perplexity/pplx-decider-flash-v1.2 | 144 | 12 | 8.3 | 0 | 4.3 |
| fastino/GLiDE | 121 | 28 | 23.1 | 0 | 10.0 |

Positive-only oracle union: shipped policies catch 211/279; calibrated policies catch 212/279. The calibrated union recovers 8 of the 68 previously never-caught pairs. This is not a deployed ensemble and establishes no ensemble precision.

## Disjoint validation

Each cell shows shipped → calibrated. Full native-gold confusion counts and paired metric intervals are in `scorecards.json`. If a model has zero successful assessments, its execution-inclusive recall is zero while semantic quality is unmeasured; do not interpret that as semantic errors on every pair. The pooled row is descriptive and dataset-composition dependent.

| Dataset | Model | Precision % | Recall % | Negative coverage % | False clears | Errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| vitaminc | jev-1.14.0 | n/a → n/a | 0.0 → 0.0 | 0.0 → 0.0 | 0 → 0 | 258 |
| scifact | jev-1.14.0 | n/a → n/a | 0.0 → 0.0 | 0.0 → 0.0 | 0 → 0 | 69 |
| contractnli | jev-1.14.0 | n/a → n/a | 0.0 → 0.0 | 0.0 → 0.0 | 0 → 0 | 157 |
| mnli | jev-1.14.0 | n/a → n/a | 0.0 → 0.0 | 0.0 → 0.0 | 0 → 0 | 204 |
| all | jev-1.14.0 | n/a → n/a | 0.0 → 0.0 | 0.0 → 0.0 | 0 → 0 | 688 |
| vitaminc | clef | 94.6 → 100.0 | 38.9 → 30.0 | 63.1 → 11.9 | 7 → 0 | 0 |
| scifact | clef | 100.0 → 100.0 | 41.7 → 16.7 | 35.6 → 0.0 | 0 → 0 | 0 |
| contractnli | clef | 100.0 → 100.0 | 40.0 → 23.3 | 37.8 → 0.0 | 0 → 0 | 0 |
| mnli | clef | 92.6 → 92.9 | 36.8 → 19.1 | 44.1 → 0.7 | 1 → 0 | 0 |
| all | clef | 95.3 → 98.1 | 38.7 → 24.1 | 48.3 → 4.4 | 8 → 0 | 0 |
| vitaminc | clef-flash | 80.6 → 80.6 | 27.8 → 27.8 | 47.6 → 3.0 | 8 → 0 | 0 |
| scifact | clef-flash | 100.0 → 100.0 | 29.2 → 29.2 | 15.6 → 2.2 | 0 → 0 | 0 |
| contractnli | clef-flash | 100.0 → 100.0 | 33.3 → 33.3 | 15.7 → 0.0 | 0 → 0 | 0 |
| mnli | clef-flash | 100.0 → 100.0 | 41.2 → 41.2 | 30.1 → 0.0 | 0 → 0 | 0 |
| all | clef-flash | 92.1 → 92.1 | 33.0 → 33.0 | 31.1 → 1.3 | 8 → 0 | 0 |
| vitaminc | clef-omni | 100.0 → 100.0 | 31.1 → 22.2 | 56.0 → 8.3 | 11 → 1 | 0 |
| scifact | clef-omni | 100.0 → 100.0 | 62.5 → 45.8 | 51.1 → 2.2 | 0 → 0 | 0 |
| contractnli | clef-omni | 100.0 → 100.0 | 50.0 → 33.3 | 59.8 → 0.0 | 1 → 0 | 0 |
| mnli | clef-omni | 93.5 → 94.7 | 63.2 → 52.9 | 45.6 → 2.9 | 1 → 0 | 0 |
| all | clef-omni | 97.1 → 97.5 | 47.6 → 36.3 | 53.6 → 4.0 | 13 → 1 | 0 |
| vitaminc | gpt-6-luna | 97.0 → 97.0 | 35.6 → 35.6 | 76.2 → 0.0 | 20 → 0 | 0 |
| scifact | gpt-6-luna | 100.0 → 100.0 | 20.8 → 20.8 | 51.1 → 0.0 | 1 → 0 | 0 |
| contractnli | gpt-6-luna | 87.5 → 87.5 | 46.7 → 46.7 | 38.6 → 0.0 | 5 → 0 | 0 |
| mnli | gpt-6-luna | 95.2 → 94.7 | 29.4 → 26.5 | 55.9 → 0.0 | 1 → 0 | 0 |
| all | gpt-6-luna | 94.7 → 94.5 | 33.5 → 32.5 | 58.0 → 0.0 | 27 → 0 | 0 |
| vitaminc | microsoft/microsoft-decision-1 | 95.0 → 97.9 | 63.3 → 52.2 | 78.0 → 3.0 | 11 → 1 | 0 |
| scifact | microsoft/microsoft-decision-1 | 81.8 → 100.0 | 37.5 → 20.8 | 51.1 → 2.2 | 1 → 0 | 0 |
| contractnli | microsoft/microsoft-decision-1 | 81.0 → 92.3 | 56.7 → 40.0 | 49.6 → 0.0 | 0 → 0 | 0 |
| mnli | microsoft/microsoft-decision-1 | 96.0 → 100.0 | 70.6 → 38.2 | 68.4 → 12.5 | 1 → 0 | 0 |
| all | microsoft/microsoft-decision-1 | 92.3 → 97.8 | 61.8 → 42.5 | 65.1 → 4.8 | 13 → 1 | 0 |
| vitaminc | perplexity/pplx-decider-v1.2 | 98.4 → 95.7 | 66.7 → 73.3 | 77.4 → 53.0 | 5 → 0 | 0 |
| scifact | perplexity/pplx-decider-v1.2 | 87.5 → 91.7 | 29.2 → 45.8 | 48.9 → 11.1 | 0 → 0 | 0 |
| contractnli | perplexity/pplx-decider-v1.2 | 100.0 → 100.0 | 43.3 → 53.3 | 62.2 → 10.2 | 0 → 0 | 0 |
| mnli | perplexity/pplx-decider-v1.2 | 97.7 → 96.2 | 61.8 → 73.5 | 60.3 → 26.5 | 1 → 0 | 0 |
| all | perplexity/pplx-decider-v1.2 | 97.6 → 96.0 | 57.5 → 67.5 | 65.8 → 30.0 | 6 → 0 | 0 |
| vitaminc | perplexity/pplx-decider-flash-v1.2 | 96.4 → 96.7 | 58.9 → 64.4 | 71.4 → 26.8 | 5 → 1 | 0 |
| scifact | perplexity/pplx-decider-flash-v1.2 | 100.0 → 100.0 | 29.2 → 33.3 | 22.2 → 8.9 | 0 → 0 | 0 |
| contractnli | perplexity/pplx-decider-flash-v1.2 | 100.0 → 100.0 | 50.0 → 50.0 | 28.3 → 3.1 | 0 → 0 | 0 |
| mnli | perplexity/pplx-decider-flash-v1.2 | 95.0 → 95.8 | 55.9 → 67.6 | 39.0 → 13.2 | 0 → 1 | 0 |
| all | perplexity/pplx-decider-flash-v1.2 | 96.6 → 96.9 | 53.3 → 59.9 | 46.0 → 14.9 | 5 → 2 | 0 |
| vitaminc | fastino/GLiDE | 98.1 → 98.3 | 57.8 → 63.3 | 80.4 → 32.7 | 13 → 1 | 24 |
| scifact | fastino/GLiDE | 85.7 → 92.3 | 25.0 → 50.0 | 60.0 → 4.4 | 0 → 0 | 3 |
| contractnli | fastino/GLiDE | 100.0 → 100.0 | 40.0 → 66.7 | 70.1 → 2.4 | 1 → 0 | 22 |
| mnli | fastino/GLiDE | 96.7 → 95.5 | 42.6 → 61.8 | 66.9 → 11.0 | 1 → 1 | 26 |
| all | fastino/GLiDE | 97.1 → 97.0 | 46.7 → 61.8 | 71.8 → 15.8 | 15 → 2 | 75 |

## Archived development samples

Each cell shows shipped → calibrated. Full native-gold confusion counts and paired metric intervals are in `scorecards.json`. If a model has zero successful assessments, its execution-inclusive recall is zero while semantic quality is unmeasured; do not interpret that as semantic errors on every pair. The pooled row is descriptive and dataset-composition dependent.

| Dataset | Model | Precision % | Recall % | Negative coverage % | False clears | Errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| vitaminc | jev-1.14.0 | 90.3 → 91.4 | 39.4 → 45.1 | 79.1 → 0.0 | 9 → 0 | 0 |
| scifact | jev-1.14.0 | 94.6 → 94.7 | 49.3 → 50.7 | 82.0 → 0.0 | 3 → 0 | 0 |
| contractnli | jev-1.14.0 | 86.7 → 82.4 | 50.0 → 53.8 | 64.2 → 0.0 | 2 → 0 | 0 |
| mnli | jev-1.14.0 | 100.0 → 100.0 | 58.2 → 64.2 | 81.2 → 0.0 | 3 → 0 | 0 |
| findver | jev-1.14.0 | 100.0 → 100.0 | 81.8 → 86.4 | 71.1 → 0.0 | 1 → 0 | 0 |
| all | jev-1.14.0 | 95.6 → 95.3 | 54.1 → 58.4 | 75.4 → 0.0 | 18 → 0 | 0 |
| vitaminc | clef | 73.8 → 78.1 | 43.7 → 35.2 | 59.7 → 7.0 | 15 → 1 | 0 |
| scifact | clef | 92.9 → 95.2 | 36.6 → 28.2 | 55.5 → 0.8 | 1 → 0 | 0 |
| contractnli | clef | 100.0 → 100.0 | 30.8 → 26.9 | 34.1 → 0.0 | 0 → 0 | 0 |
| mnli | clef | 100.0 → 100.0 | 40.3 → 28.4 | 56.4 → 6.0 | 1 → 0 | 1 |
| findver | clef | 100.0 → 100.0 | 27.3 → 15.9 | 55.3 → 0.0 | 2 → 0 | 0 |
| all | clef | 88.9 → 90.7 | 37.3 → 28.0 | 50.4 → 3.0 | 19 → 1 | 1 |
| vitaminc | clef-flash | 66.7 → 66.7 | 16.9 → 16.9 | 29.5 → 1.6 | 9 → 0 | 0 |
| scifact | clef-flash | 93.9 → 93.9 | 43.7 → 43.7 | 22.7 → 3.9 | 0 → 0 | 0 |
| contractnli | clef-flash | 100.0 → 100.0 | 34.6 → 34.6 | 15.0 → 0.6 | 0 → 0 | 0 |
| mnli | clef-flash | 100.0 → 100.0 | 46.3 → 46.3 | 41.4 → 1.5 | 0 → 0 | 0 |
| findver | clef-flash | 100.0 → 100.0 | 25.0 → 25.0 | 36.8 → 0.0 | 3 → 0 | 0 |
| all | clef-flash | 92.2 → 92.2 | 33.7 → 33.7 | 27.0 → 1.7 | 12 → 0 | 0 |
| vitaminc | clef-omni | 65.6 → 94.1 | 29.6 → 22.5 | 58.1 → 3.1 | 11 → 0 | 0 |
| scifact | clef-omni | 94.7 → 96.4 | 50.7 → 38.0 | 59.4 → 2.3 | 1 → 0 | 1 |
| contractnli | clef-omni | 92.9 → 88.9 | 50.0 → 30.8 | 47.4 → 0.0 | 0 → 0 | 0 |
| mnli | clef-omni | 97.4 → 97.1 | 55.2 → 50.7 | 52.6 → 6.0 | 0 → 0 | 0 |
| findver | clef-omni | 100.0 → 100.0 | 18.2 → 13.6 | 76.3 → 5.3 | 6 → 1 | 0 |
| all | clef-omni | 88.5 → 95.8 | 41.2 → 32.6 | 55.2 → 2.8 | 18 → 1 | 1 |
| vitaminc | gpt-6-luna | 88.2 → 87.5 | 21.1 → 19.7 | 72.9 → 0.0 | 9 → 0 | 0 |
| scifact | gpt-6-luna | 86.4 → 85.7 | 26.8 → 25.4 | 63.3 → 0.0 | 8 → 0 | 1 |
| contractnli | gpt-6-luna | 76.9 → 76.9 | 38.5 → 38.5 | 38.7 → 0.0 | 1 → 0 | 1 |
| mnli | gpt-6-luna | 100.0 → 100.0 | 32.8 → 32.8 | 66.9 → 0.0 | 5 → 0 | 0 |
| findver | gpt-6-luna | 100.0 → 100.0 | 75.0 → 75.0 | 78.9 → 0.0 | 2 → 0 | 0 |
| all | gpt-6-luna | 92.5 → 92.4 | 35.5 → 34.8 | 60.1 → 0.0 | 25 → 0 | 2 |
| vitaminc | microsoft/microsoft-decision-1 | 81.8 → 93.1 | 50.7 → 38.0 | 75.2 → 4.7 | 10 → 0 | 0 |
| scifact | microsoft/microsoft-decision-1 | 91.9 → 87.5 | 47.9 → 29.6 | 66.4 → 3.9 | 2 → 0 | 0 |
| contractnli | microsoft/microsoft-decision-1 | 58.6 → 83.3 | 65.4 → 38.5 | 48.0 → 0.0 | 0 → 0 | 0 |
| mnli | microsoft/microsoft-decision-1 | 95.7 → 100.0 | 65.7 → 44.8 | 75.9 → 22.6 | 2 → 0 | 0 |
| findver | microsoft/microsoft-decision-1 | 96.0 → 93.3 | 54.5 → 31.8 | 65.8 → 0.0 | 4 → 0 | 0 |
| all | microsoft/microsoft-decision-1 | 85.6 → 92.7 | 55.6 → 36.6 | 65.1 → 6.8 | 18 → 0 | 0 |
| vitaminc | perplexity/pplx-decider-v1.2 | 94.6 → 95.0 | 49.3 → 53.5 | 79.8 → 40.3 | 5 → 0 | 0 |
| scifact | perplexity/pplx-decider-v1.2 | 93.9 → 92.3 | 43.7 → 50.7 | 53.9 → 18.8 | 1 → 0 | 0 |
| contractnli | perplexity/pplx-decider-v1.2 | 93.3 → 87.5 | 53.8 → 53.8 | 54.9 → 8.1 | 0 → 0 | 1 |
| mnli | perplexity/pplx-decider-v1.2 | 97.8 → 94.4 | 67.2 → 76.1 | 60.2 → 36.1 | 0 → 0 | 1 |
| findver | perplexity/pplx-decider-v1.2 | 100.0 → 100.0 | 86.4 → 86.4 | 81.6 → 50.0 | 2 → 2 | 1 |
| all | perplexity/pplx-decider-v1.2 | 96.4 → 94.7 | 58.4 → 63.4 | 62.9 → 26.1 | 8 → 2 | 3 |
| vitaminc | perplexity/pplx-decider-flash-v1.2 | 85.4 → 80.0 | 49.3 → 56.3 | 64.3 → 10.1 | 5 → 3 | 0 |
| scifact | perplexity/pplx-decider-flash-v1.2 | 93.1 → 93.8 | 38.0 → 42.3 | 21.1 → 11.7 | 0 → 0 | 1 |
| contractnli | perplexity/pplx-decider-flash-v1.2 | 100.0 → 88.9 | 26.9 → 30.8 | 26.6 → 5.8 | 0 → 0 | 1 |
| mnli | perplexity/pplx-decider-flash-v1.2 | 97.6 → 97.7 | 61.2 → 64.2 | 50.4 → 24.8 | 0 → 0 | 0 |
| findver | perplexity/pplx-decider-flash-v1.2 | 100.0 → 100.0 | 56.8 → 59.1 | 76.3 → 50.0 | 3 → 2 | 0 |
| all | perplexity/pplx-decider-flash-v1.2 | 93.8 → 91.3 | 48.4 → 52.7 | 41.9 → 15.0 | 8 → 5 | 2 |
| vitaminc | fastino/GLiDE | 97.1 → 93.0 | 47.9 → 56.3 | 85.3 → 14.0 | 11 → 1 | 0 |
| scifact | fastino/GLiDE | 93.3 → 92.7 | 39.4 → 53.5 | 78.9 → 8.6 | 2 → 0 | 0 |
| contractnli | fastino/GLiDE | 93.3 → 88.9 | 53.8 → 61.5 | 71.1 → 3.5 | 0 → 0 | 0 |
| mnli | fastino/GLiDE | 97.7 → 96.2 | 62.7 → 74.6 | 82.7 → 21.1 | 1 → 0 | 1 |
| findver | fastino/GLiDE | 100.0 → 97.7 | 90.9 → 95.5 | 81.6 → 10.5 | 2 → 0 | 0 |
| all | fastino/GLiDE | 96.9 → 94.4 | 56.6 → 66.7 | 79.0 → 11.1 | 16 → 1 | 1 |

## Paired changes on the archived samples

Calibrated minus shipped, percentage points, with 95% source-group percentile intervals (20,000 resamples). These pointwise exploratory intervals condition on the fitted policy and the fixed provider outputs; they do not include fitting uncertainty, provider repeatability, training contamination or multiplicity correction. Undefined bootstrap precision is omitted from that metric only; valid replicate counts are recorded.

| Dataset | Model | Precision Δ [95%] | Recall Δ [95%] | Negative coverage Δ [95%] |
| --- | --- | ---: | ---: | ---: |
| vitaminc | jev-1.14.0 | 1.1 [0.0, 3.6] | 5.6 [1.4, 10.6] | -79.1 [-85.4, -72.9] |
| scifact | jev-1.14.0 | 0.1 [0.0, 0.7] | 1.4 [0.0, 4.8] | -82.0 [-89.1, -74.4] |
| contractnli | jev-1.14.0 | -4.3 [-18.3, 2.8] | 3.8 [0.0, 13.8] | -64.2 [-71.3, -57.0] |
| mnli | jev-1.14.0 | 0.0 [0.0, 0.0] | 6.0 [1.4, 12.1] | -81.2 [-87.5, -74.3] |
| findver | jev-1.14.0 | 0.0 [0.0, 0.0] | 4.5 [0.0, 11.7] | -71.1 [-84.4, -57.5] |
| vitaminc | clef | 4.3 [-6.2, 17.6] | -8.5 [-14.3, -3.1] | -52.7 [-60.6, -43.8] |
| scifact | clef | 2.4 [-3.1, 11.1] | -8.5 [-15.4, -2.8] | -54.7 [-63.4, -45.9] |
| contractnli | clef | 0.0 [0.0, 0.0] | -3.8 [-12.9, 0.0] | -34.1 [-42.9, -25.5] |
| mnli | clef | 0.0 [0.0, 0.0] | -11.9 [-20.0, -4.6] | -50.4 [-57.8, -43.1] |
| findver | clef | 0.0 [0.0, 0.0] | -11.4 [-19.6, -2.9] | -55.3 [-70.5, -39.5] |
| vitaminc | clef-flash | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | -27.9 [-41.1, -16.5] |
| scifact | clef-flash | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | -18.8 [-27.0, -10.7] |
| contractnli | clef-flash | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | -14.5 [-21.0, -8.5] |
| mnli | clef-flash | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | -39.8 [-48.2, -31.3] |
| findver | clef-flash | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | -36.8 [-51.6, -22.2] |
| vitaminc | clef-omni | 28.5 [10.7, 42.9] | -7.0 [-14.1, -1.4] | -55.0 [-66.1, -44.8] |
| scifact | clef-omni | 1.7 [-2.6, 8.0] | -12.7 [-20.6, -5.6] | -57.0 [-66.4, -47.6] |
| contractnli | clef-omni | -4.0 [-16.7, 0.0] | -19.2 [-37.5, -4.2] | -47.4 [-54.4, -39.7] |
| mnli | clef-omni | -0.2 [-0.9, 0.0] | -4.5 [-10.1, 0.0] | -46.6 [-54.5, -38.8] |
| findver | clef-omni | 0.0 [0.0, 0.0] | -4.5 [-11.4, 0.0] | -71.1 [-85.1, -55.2] |
| vitaminc | gpt-6-luna | -0.7 [-3.3, 0.0] | -1.4 [-4.9, 0.0] | -72.9 [-81.2, -63.3] |
| scifact | gpt-6-luna | -0.6 [-3.0, 0.0] | -1.4 [-4.8, 0.0] | -63.3 [-72.3, -54.1] |
| contractnli | gpt-6-luna | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | -38.7 [-45.6, -31.4] |
| mnli | gpt-6-luna | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | -66.9 [-75.0, -58.5] |
| findver | gpt-6-luna | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | -78.9 [-91.2, -65.6] |
| vitaminc | microsoft/microsoft-decision-1 | 11.3 [0.9, 24.0] | -12.7 [-22.2, -4.8] | -70.5 [-79.2, -59.4] |
| scifact | microsoft/microsoft-decision-1 | -4.4 [-11.7, 0.0] | -18.3 [-27.9, -9.6] | -62.5 [-71.1, -53.6] |
| contractnli | microsoft/microsoft-decision-1 | 24.7 [7.1, 50.0] | -26.9 [-42.4, -10.7] | -48.0 [-56.4, -39.6] |
| mnli | microsoft/microsoft-decision-1 | 4.3 [0.0, 11.1] | -20.9 [-30.9, -11.8] | -53.4 [-62.0, -44.3] |
| findver | microsoft/microsoft-decision-1 | -2.7 [-10.0, 0.0] | -22.7 [-35.6, -11.5] | -65.8 [-80.6, -50.0] |
| vitaminc | perplexity/pplx-decider-v1.2 | 0.4 [0.0, 1.5] | 4.2 [0.0, 8.7] | -39.5 [-51.2, -28.9] |
| scifact | perplexity/pplx-decider-v1.2 | -1.6 [-7.9, 2.0] | 7.0 [1.4, 14.5] | -35.2 [-43.9, -26.8] |
| contractnli | perplexity/pplx-decider-v1.2 | -5.8 [-22.9, 0.0] | 0.0 [0.0, 0.0] | -46.8 [-56.1, -36.8] |
| mnli | perplexity/pplx-decider-v1.2 | -3.4 [-8.8, 0.5] | 9.0 [2.9, 16.4] | -24.1 [-31.9, -16.7] |
| findver | perplexity/pplx-decider-v1.2 | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | -31.6 [-46.2, -17.6] |
| vitaminc | perplexity/pplx-decider-flash-v1.2 | -5.4 [-9.0, 1.2] | 7.0 [1.5, 13.2] | -54.3 [-64.1, -42.1] |
| scifact | perplexity/pplx-decider-flash-v1.2 | 0.6 [0.0, 2.3] | 4.2 [0.0, 9.4] | -9.4 [-18.3, -0.7] |
| contractnli | perplexity/pplx-decider-flash-v1.2 | -11.1 [-33.3, 0.0] | 3.8 [0.0, 12.9] | -20.8 [-28.8, -13.2] |
| mnli | perplexity/pplx-decider-flash-v1.2 | 0.1 [0.0, 0.5] | 3.0 [0.0, 7.7] | -25.6 [-35.3, -15.7] |
| findver | perplexity/pplx-decider-flash-v1.2 | 0.0 [0.0, 0.0] | 2.3 [0.0, 7.9] | -26.3 [-41.9, -11.1] |
| vitaminc | fastino/GLiDE | -4.1 [-8.8, 0.7] | 8.5 [1.4, 18.1] | -71.3 [-80.0, -61.0] |
| scifact | fastino/GLiDE | -0.7 [-6.9, 4.0] | 14.1 [6.2, 22.9] | -70.3 [-78.7, -61.9] |
| contractnli | fastino/GLiDE | -4.4 [-19.0, 2.8] | 7.7 [0.0, 21.7] | -67.6 [-76.0, -58.0] |
| mnli | fastino/GLiDE | -1.5 [-6.1, 1.0] | 11.9 [4.5, 20.3] | -61.7 [-69.2, -53.8] |
| findver | fastino/GLiDE | -2.3 [-8.1, 0.0] | 4.5 [0.0, 11.9] | -71.1 [-85.7, -54.8] |

## Reproduction and limits

Run `python3 -B scripts/verify-calibration-study.py`. Python standard library only: it verifies inventories, frozen source snapshots and protocol/approval receipts, independently refits thresholds from redacted fit predictions, cross-checks point metrics against the existing TypeScript metric engine, and reconstructs every scorecard and paired interval without network access, credentials or original dataset text. The existing release verifier remains unchanged and still verifies the original published summary.

Packet status: **packet prepared, not yet labelled**. No AI adjudication or service-contract labels were added. Native dataset labels remain unchanged. All nine models are included whether calibration helps or hurts. Prompts were unchanged; their prior development was Jev-only. These public datasets may appear in model training. Neither the original comparison nor this study measures repeated inference or input-order robustness. Freeze-before-validation ordering is recorded by the operator dispatch receipt, not an independent timestamp authority. Source snapshots freeze our code, not provider weights behind unversioned aliases; reported model/revision metadata is retained in the checkpoints. The serial model order also limits inference about provider-load effects on timing and failures. No service policy or default-model promotion follows automatically.
