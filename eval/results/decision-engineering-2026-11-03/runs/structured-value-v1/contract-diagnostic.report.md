# Countercheck evaluation

Backend: **jev**. Track: **synthetic-smoke**. Manifest SHA-256: `3abd761205be0fe9113b4be89fbdb71313f12a96e3331a8c9b746b9698bf3ecb`.

Supplied-evidence pair adaptation; this is not an end-to-end retrieval score or production release qualification.

Packing: `pair_isolation`; envelope failure: `exclude_entire_submitted_batch`; automatic repacking: false. Batched coverage is specific to this submitted-batch protocol and is not an isolated-pair quality score.

Deadline: 3000 ms, `kernel_compilation_and_provider_total`, `route_default`. Production qualification: not assessed.

| Measure | Value |
|---|---:|
| Pair observations | 28 |
| Positive / negative | 12 / 16 |
| Precision | 1.0000 |
| Recall (uncertainty/failures miss) | 0.6667 |
| F1 | 0.8000 |
| Definitive coverage | 0.5000 |
| Clear-negative coverage | 0.3750 |
| False positive rate | 0.0000 |
| AUROC | n/a |
| PR-AUC (average precision) | n/a |
| Scored prevalence | n/a |
| Brier | n/a |
| Errors / excluded | 0 / 0 |

Probabilistic metrics exclude missing distributions; their denominator is 0. Positive recall and coverage retain errors, exclusions and uncertainty. Pair-weighted latency is diagnostic; it is not a deployed request-capacity measurement.

JSON contains complete per-pair distributions, original labels, dataset/native-negative slices, pass summaries, calibration bins, risk/coverage, Wilson intervals and group bootstrap intervals. Cost reservations are not measured charges; unavailable usage/cost stays unknown. No production gates are certified by this report.

Execution observations: 32; completed: 32; errors: 0; excluded: 0. Expected-uncertain synthetic fixtures excluded from binary metrics: 4. Expected-verdict diagnostics: 18/32 (synthetic only).
