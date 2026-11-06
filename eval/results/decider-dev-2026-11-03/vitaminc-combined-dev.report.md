# Countercheck evaluation

Backend: **decider**. Track: **development**. Manifest SHA-256: `982a5dc43919853176d372c53bf90bc98d4bc49e56d8703165feb14345aff0ff`.

Supplied-evidence pair adaptation; this is not an end-to-end retrieval score or production release qualification.

| Measure                            |    Value |
| ---------------------------------- | -------: |
| Pair observations                  |      200 |
| Positive / negative                | 71 / 129 |
| Precision                          |   0.9459 |
| Recall (uncertainty/failures miss) |   0.4930 |
| F1                                 |   0.6481 |
| Definitive coverage                |   0.7150 |
| Clear-negative coverage            |   0.7829 |
| False positive rate                |   0.0155 |
| AUROC                              |   0.9274 |
| PR-AUC (average precision)         |   0.8897 |
| Scored prevalence                  |   0.3568 |
| Brier                              |   0.1203 |
| Errors / excluded                  |    1 / 0 |

Probabilistic metrics exclude missing distributions; their denominator is 199. Positive recall and coverage retain errors, exclusions and uncertainty. Pair-weighted latency is diagnostic; it is not a deployed request-capacity measurement.

JSON contains complete per-pair distributions, original labels, dataset/native-negative slices, pass summaries, calibration bins, risk/coverage, Wilson intervals and group bootstrap intervals. Cost reservations are not measured charges; unavailable usage/cost stays unknown. No production gates are certified by this report.
