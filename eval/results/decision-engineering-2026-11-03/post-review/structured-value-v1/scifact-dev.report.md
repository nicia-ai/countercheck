# Countercheck evaluation

Backend: **jev**. Track: **development**. Manifest SHA-256: `d598943442b541f93f0eeaeeea7889470ebebb8715b213608c2f86e1fb90892c`.

Supplied-evidence pair adaptation; this is not an end-to-end retrieval score or production release qualification.

Packing: `pair_isolation`; envelope failure: `exclude_entire_submitted_batch`; automatic repacking: false. Batched coverage is specific to this submitted-batch protocol and is not an isolated-pair quality score.

Deadline: 3000 ms, `kernel_compilation_and_provider_total`, `route_default`. Production qualification: not assessed.

| Measure | Value |
|---|---:|
| Pair observations | 199 |
| Positive / negative | 71 / 128 |
| Precision | 1.0000 |
| Recall (uncertainty/failures miss) | 0.1127 |
| F1 | 0.2025 |
| Definitive coverage | 0.0804 |
| Clear-negative coverage | 0.0625 |
| False positive rate | 0.0000 |
| AUROC | n/a |
| PR-AUC (average precision) | n/a |
| Scored prevalence | n/a |
| Brier | n/a |
| Errors / excluded | 0 / 0 |

Probabilistic metrics exclude missing distributions; their denominator is 0. Positive recall and coverage retain errors, exclusions and uncertainty. Pair-weighted latency is diagnostic; it is not a deployed request-capacity measurement.

JSON contains complete per-pair distributions, original labels, dataset/native-negative slices, pass summaries, calibration bins, risk/coverage, Wilson intervals and group bootstrap intervals. Cost reservations are not measured charges; unavailable usage/cost stays unknown. No production gates are certified by this report.

Execution observations: 199; completed: 199; errors: 0; excluded: 0. Expected-uncertain synthetic fixtures excluded from binary metrics: 0. Expected-verdict diagnostics: 0/0 (synthetic only).
