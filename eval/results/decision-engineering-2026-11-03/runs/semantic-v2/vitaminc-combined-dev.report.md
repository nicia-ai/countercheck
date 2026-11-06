# Countercheck evaluation

Backend: **jev**. Track: **development**. Manifest SHA-256: `982a5dc43919853176d372c53bf90bc98d4bc49e56d8703165feb14345aff0ff`.

Supplied-evidence pair adaptation; this is not an end-to-end retrieval score or production release qualification.

Packing: `pair_isolation`; envelope failure: `exclude_entire_submitted_batch`; automatic repacking: false. Batched coverage is specific to this submitted-batch protocol and is not an isolated-pair quality score.

Deadline: 3000 ms, `kernel_compilation_and_provider_total`, `route_default`. Production qualification: not assessed.

| Measure | Value |
|---|---:|
| Pair observations | 200 |
| Positive / negative | 71 / 129 |
| Precision | 0.9310 |
| Recall (uncertainty/failures miss) | 0.3803 |
| F1 | 0.5400 |
| Definitive coverage | 0.7200 |
| Clear-negative coverage | 0.7984 |
| False positive rate | 0.0155 |
| AUROC | 0.8358 |
| PR-AUC (average precision) | 0.7903 |
| Scored prevalence | 0.3550 |
| Brier | 0.1600 |
| Errors / excluded | 0 / 0 |

Probabilistic metrics exclude missing distributions; their denominator is 200. Positive recall and coverage retain errors, exclusions and uncertainty. Pair-weighted latency is diagnostic; it is not a deployed request-capacity measurement.

JSON contains complete per-pair distributions, original labels, dataset/native-negative slices, pass summaries, calibration bins, risk/coverage, Wilson intervals and group bootstrap intervals. Cost reservations are not measured charges; unavailable usage/cost stays unknown. No production gates are certified by this report.

Execution observations: 200; completed: 200; errors: 0; excluded: 0. Expected-uncertain synthetic fixtures excluded from binary metrics: 0. Expected-verdict diagnostics: 0/0 (synthetic only).
