# Countercheck evaluation

Backend: **jev**. Track: **synthetic-smoke**. Manifest SHA-256: `0ca87c2190f4ce8e45c1313b5e921153beaba64b70a025d776704c03dd4a0307`.

Supplied-evidence pair adaptation; this is not an end-to-end retrieval score or production release qualification.

Packing: `atomic_batch_envelope_stress`; envelope failure: `exclude_entire_submitted_batch`; automatic repacking: false. Batched coverage is specific to this submitted-batch protocol and is not an isolated-pair quality score.

Deadline: 3000 ms, `kernel_compilation_and_provider_total`, `route_default`. Production qualification: not assessed.

| Measure | Value |
|---|---:|
| Pair observations | 20 |
| Positive / negative | 19 / 1 |
| Precision | 1.0000 |
| Recall (uncertainty/failures miss) | 1.0000 |
| F1 | 1.0000 |
| Definitive coverage | 1.0000 |
| Clear-negative coverage | 1.0000 |
| False positive rate | 0.0000 |
| AUROC | 1.0000 |
| PR-AUC (average precision) | 1.0000 |
| Scored prevalence | 0.9500 |
| Brier | 0.0001 |
| Errors / excluded | 0 / 0 |

Probabilistic metrics exclude missing distributions; their denominator is 20. Positive recall and coverage retain errors, exclusions and uncertainty. Pair-weighted latency is diagnostic; it is not a deployed request-capacity measurement.

JSON contains complete per-pair distributions, original labels, dataset/native-negative slices, pass summaries, calibration bins, risk/coverage, Wilson intervals and group bootstrap intervals. Cost reservations are not measured charges; unavailable usage/cost stays unknown. No production gates are certified by this report.

Execution observations: 20; completed: 20; errors: 0; excluded: 0. Expected-uncertain synthetic fixtures excluded from binary metrics: 0. Expected-verdict diagnostics: 0/0 (synthetic only).
