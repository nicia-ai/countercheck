# Countercheck evaluation

Backend: **clef**. Track: **development**. Manifest SHA-256: `ab4f24fadb14b48d939d7cbd0658e555f0e25af2cf8b11b8ecb533328083c417`.

Supplied-evidence pair adaptation; this is not an end-to-end retrieval score or production release qualification.

Packing: `pair_isolation`; envelope failure: `exclude_entire_submitted_batch`; automatic repacking: false. Batched coverage is specific to this submitted-batch protocol and is not an isolated-pair quality score.

Deadline: 3000 ms, `kernel_compilation_and_provider_total`, `route_default`. Production qualification: not assessed.

| Measure | Value |
|---|---:|
| Pair observations | 10 |
| Positive / negative | 4 / 6 |
| Precision | 1.0000 |
| Recall (uncertainty/failures miss) | 0.5000 |
| F1 | 0.6667 |
| Definitive coverage | 0.3000 |
| Clear-negative coverage | 0.1667 |
| False positive rate | 0.0000 |
| AUROC | 1.0000 |
| PR-AUC (average precision) | 1.0000 |
| Scored prevalence | 0.4000 |
| Brier | 0.0480 |
| Errors / excluded | 0 / 0 |

Probabilistic metrics exclude missing distributions; their denominator is 10. Positive recall and coverage retain errors, exclusions and uncertainty. Pair-weighted latency is diagnostic; it is not a deployed request-capacity measurement.

JSON contains complete per-pair distributions, original labels, dataset/native-negative slices, pass summaries, calibration bins, risk/coverage, Wilson intervals and group bootstrap intervals. Cost reservations are not measured charges; unavailable usage/cost stays unknown. No production gates are certified by this report.
