# Calibration follow-up: restored Jev validation and negative budgets

**Post-hoc exploratory analysis.** The per-model primary budget was chosen after the original zero-budget validation was seen. Negative cutoffs are fitted only on original fit outputs. The primary criterion was chosen post hoc; no subsequent validation-driven grid search or reselection is performed. Positive cutoffs remain frozen. The service is unchanged. Finance is transfer only. Native labels remain unchanged.

[Original zero-budget study](../separate-calibration-2026-11-05/README.md) · [Protocol and authorization](protocol.json) · [Full metrics and paired intervals](analysis.json) · [Review response](../../../docs/evaluations/calibration-review-response-2026-11-06.md)

The owner reported adding TypeSafe credits. The fresh Jev run produced **688/688 successful assessments**, HTTP statuses **{'200': 688}**. The original 688-failure run remains intact. The rerun uses the original manifest, prompts, 3,000 ms deadline and frozen policies; only status-only diagnostics were added. There were 688 new calls with a $1.38 reservation; measured billing is unknown. No other models were rerun. This supports the billing explanation but cannot establish the historical HTTP status.

## Primary rule and findings

For each model, maximize fit clear-negative count subject to no more fit false clears than its shipped balanced-v1 rule made on the same 771 selected native-positive fit pairs. The cap is an aggregate count, not protection for each subgroup or the same individual pairs. Missing distributions are not imputed. Grid order and tie breaks match the original negative fitter. A zero-budget control exactly reproduces all nine original policies.

| Model | Allowed fit false clears | Rate over 771 |
| --- | ---: | ---: |
| jev-1.14.0 | 56 | 7.26% |
| clef | 27 | 3.50% |
| clef-flash | 25 | 3.24% |
| clef-omni | 21 | 2.72% |
| gpt-6-luna | 90 | 11.67% |
| microsoft/microsoft-decision-1 | 41 | 5.32% |
| perplexity/pplx-decider-v1.2 | 18 | 2.33% |
| perplexity/pplx-decider-flash-v1.2 | 11 | 1.43% |
| fastino/GLiDE | 31 | 4.02% |

Primary pooled validation negative coverage is **36.1–79.4%**. All three point targets hold on **0 validation** and **0 archived model/domain scorecards**. Coverage recovery is a policy trade-off, not proof of corrected labels or population safety.


## Restored validation

Each coverage/count cell is zero-budget → primary. Positive precision and recall are identical across negative budgets because the positive gate is fixed. Pooled rows are descriptive mixtures; per-domain details and paired precision/recall/F1/coverage/false-clear intervals are in JSON. All errors remain in selected-case recall/coverage denominators.

| Model | Precision % | Recall % | Negative coverage % | False clears | Shipped negative coverage % / false clears |
| --- | ---: | ---: | ---: | ---: | ---: |
| jev-1.14.0 | 96.6 | 54.2 | 0.0 → 79.4 | 0 → 18 | 77.5 / 17 |
| clef | 98.1 | 24.1 | 4.4 → 49.6 | 0 → 10 | 48.3 / 8 |
| clef-flash | 92.1 | 33.0 | 1.3 → 36.1 | 0 → 10 | 31.1 / 8 |
| clef-omni | 97.5 | 36.3 | 4.0 → 59.7 | 1 → 14 | 53.6 / 13 |
| gpt-6-luna | 94.5 | 32.5 | 0.0 → 58.0 | 0 → 27 | 58.0 / 27 |
| microsoft/microsoft-decision-1 | 97.8 | 42.5 | 4.8 → 64.9 | 1 → 13 | 65.1 / 13 |
| perplexity/pplx-decider-v1.2 | 96.0 | 67.5 | 30.0 → 74.2 | 0 → 8 | 65.8 / 6 |
| perplexity/pplx-decider-flash-v1.2 | 96.9 | 59.9 | 14.9 → 59.2 | 2 → 8 | 46.0 / 5 |
| fastino/GLiDE | 97.0 | 61.8 | 15.8 → 71.0 | 2 → 10 | 71.8 / 15 |

## Archived development samples

Each coverage/count cell is zero-budget → primary. Positive precision and recall are identical across negative budgets because the positive gate is fixed. Pooled rows are descriptive mixtures; per-domain details and paired precision/recall/F1/coverage/false-clear intervals are in JSON. All errors remain in selected-case recall/coverage denominators.

| Model | Precision % | Recall % | Negative coverage % | False clears | Shipped negative coverage % / false clears |
| --- | ---: | ---: | ---: | ---: | ---: |
| jev-1.14.0 | 95.3 | 58.4 | 0.0 → 75.9 | 0 → 18 | 75.4 / 18 |
| clef | 90.7 | 28.0 | 3.0 → 50.7 | 1 → 19 | 50.4 / 19 |
| clef-flash | 92.2 | 33.7 | 1.7 → 32.4 | 0 → 9 | 27.0 / 12 |
| clef-omni | 95.8 | 32.6 | 2.8 → 58.1 | 1 → 20 | 55.2 / 18 |
| gpt-6-luna | 92.4 | 34.8 | 0.0 → 60.1 | 0 → 25 | 60.1 / 25 |
| microsoft/microsoft-decision-1 | 92.7 | 36.6 | 6.8 → 64.4 | 0 → 17 | 65.1 / 18 |
| perplexity/pplx-decider-v1.2 | 94.7 | 63.4 | 26.1 → 74.2 | 2 → 11 | 62.9 / 8 |
| perplexity/pplx-decider-flash-v1.2 | 91.3 | 52.7 | 15.0 → 55.9 | 5 → 10 | 41.9 / 8 |
| fastino/GLiDE | 94.4 | 66.7 | 11.1 → 78.9 | 1 → 12 | 79.0 / 16 |

## Fixed sensitivity grid

Budgets are floor(rate × 771) for 0%, 0.5%, 1%, 2% and 5%. These are prespecified sensitivity points within this post-hoc follow-up; no winner is selected on validation. The primary budget exceeds 5% for some models and is not implied by the grid. Full grid/domain counts are in JSON; grid point estimates have no separate bootstrap intervals.

| Model | Budget | Fit false clears | Validation negative coverage % | Validation false clears | Archived negative coverage % | Archived false clears |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| jev-1.14.0 | 0% | 0 | 0.0 | 0 | 0.0 | 0 |
| jev-1.14.0 | 0.5% | 1 | 15.3 | 1 | 11.1 | 1 |
| jev-1.14.0 | 1% | 5 | 39.7 | 6 | 33.8 | 1 |
| jev-1.14.0 | 2% | 9 | 48.5 | 6 | 44.6 | 4 |
| jev-1.14.0 | 5% | 36 | 68.5 | 15 | 65.2 | 13 |
| clef | 0% | 0 | 4.4 | 0 | 3.0 | 1 |
| clef | 0.5% | 3 | 15.3 | 3 | 11.1 | 4 |
| clef | 1% | 7 | 18.5 | 3 | 16.6 | 5 |
| clef | 2% | 15 | 34.0 | 4 | 31.4 | 9 |
| clef | 5% | 38 | 63.2 | 17 | 63.2 | 27 |
| clef-flash | 0% | 0 | 1.3 | 0 | 1.7 | 0 |
| clef-flash | 0.5% | 3 | 5.5 | 0 | 4.7 | 1 |
| clef-flash | 1% | 7 | 8.4 | 1 | 8.0 | 4 |
| clef-flash | 2% | 15 | 25.4 | 6 | 20.1 | 7 |
| clef-flash | 5% | 38 | 52.7 | 10 | 48.9 | 18 |
| clef-omni | 0% | 0 | 4.0 | 1 | 2.8 | 1 |
| clef-omni | 0.5% | 3 | 19.3 | 5 | 18.6 | 4 |
| clef-omni | 1% | 7 | 36.3 | 10 | 35.4 | 9 |
| clef-omni | 2% | 15 | 47.9 | 11 | 49.8 | 14 |
| clef-omni | 5% | 38 | 70.8 | 19 | 69.2 | 23 |
| gpt-6-luna | 0% | 0 | 0.0 | 0 | 0.0 | 0 |
| gpt-6-luna | 0.5% | 2 | 8.2 | 1 | 6.3 | 1 |
| gpt-6-luna | 1% | 2 | 8.2 | 1 | 6.3 | 1 |
| gpt-6-luna | 2% | 14 | 13.0 | 3 | 9.0 | 2 |
| gpt-6-luna | 5% | 36 | 33.8 | 9 | 31.4 | 7 |
| microsoft/microsoft-decision-1 | 0% | 0 | 4.8 | 1 | 6.8 | 0 |
| microsoft/microsoft-decision-1 | 0.5% | 3 | 21.8 | 4 | 22.1 | 1 |
| microsoft/microsoft-decision-1 | 1% | 7 | 29.6 | 4 | 29.8 | 2 |
| microsoft/microsoft-decision-1 | 2% | 15 | 40.5 | 7 | 37.1 | 5 |
| microsoft/microsoft-decision-1 | 5% | 38 | 60.9 | 12 | 58.9 | 12 |
| perplexity/pplx-decider-v1.2 | 0% | 0 | 30.0 | 0 | 26.1 | 2 |
| perplexity/pplx-decider-v1.2 | 0.5% | 3 | 47.7 | 3 | 45.1 | 3 |
| perplexity/pplx-decider-v1.2 | 1% | 7 | 62.2 | 4 | 60.7 | 4 |
| perplexity/pplx-decider-v1.2 | 2% | 15 | 69.3 | 8 | 69.9 | 9 |
| perplexity/pplx-decider-v1.2 | 5% | 38 | 82.6 | 12 | 80.2 | 13 |
| perplexity/pplx-decider-flash-v1.2 | 0% | 0 | 14.9 | 2 | 15.0 | 5 |
| perplexity/pplx-decider-flash-v1.2 | 0.5% | 3 | 46.8 | 7 | 43.3 | 7 |
| perplexity/pplx-decider-flash-v1.2 | 1% | 7 | 53.6 | 8 | 50.6 | 10 |
| perplexity/pplx-decider-flash-v1.2 | 2% | 15 | 63.0 | 10 | 58.6 | 8 |
| perplexity/pplx-decider-flash-v1.2 | 5% | 38 | 80.0 | 15 | 76.7 | 26 |
| fastino/GLiDE | 0% | 0 | 15.8 | 2 | 11.1 | 1 |
| fastino/GLiDE | 0.5% | 3 | 44.7 | 6 | 46.1 | 5 |
| fastino/GLiDE | 1% | 7 | 54.4 | 7 | 58.4 | 5 |
| fastino/GLiDE | 2% | 15 | 59.9 | 8 | 64.7 | 8 |
| fastino/GLiDE | 5% | 38 | 75.2 | 10 | 82.0 | 16 |

## GLiDE timeout interpretation

GLiDE had 75/688 failed validation assessments versus 1/920 in the original comparison. The cohorts differ in domains, source splits and input lengths, and serial runs occurred at different times. The counts do not establish that Fastino became slower. Calibration cannot recover absent distributions.

Using the frozen positive gate, deadline-inclusive validation recall is **61.8%**. Recall on successful native-positive assessments alone is **67.9%**, but that conditions on a different, potentially easier subset. There are 19 failed native-positive cases. If none/all would have been correctly detected, recall would be bounded by **61.8–70.8%**. These are counterfactual bounds, not imputed predictions or a corrected score.

## Interpretation and reproduction

The zero-false-clear constraint explains the coverage collapse in that policy. It does not establish that the native labels responsible are wrong; both label mismatch/noise and model mistakes remain possible. The 204-item blinded packet remains prepared, not yet labelled. Better prompt/representation choices and domain-aware operating policies also remain untested; this study does not exhaust every harness improvement.

Run `python3 -B scripts/verify-calibration-followup.py`. Standard library only, no network or raw dataset text. It verifies original archives, new immutable receipts and HTTP-status-only logs; independently refits every negative policy, checks 864 point-metric tables against the existing TypeScript metric engine, and recomputes 162 primary paired comparisons at 20,000 source-group resamples each. The original failed Jev validation is retained; only this new version uses the successful rerun. No service threshold, default model or prompt changed.
