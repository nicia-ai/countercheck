# Countercheck evaluation

Backend: **replay**. Track: **development**. Manifest SHA-256: `982a5dc43919853176d372c53bf90bc98d4bc49e56d8703165feb14345aff0ff`.

Supplied-evidence pair adaptation; this is not an end-to-end retrieval score or production release qualification.

| Measure                            |    Value |
| ---------------------------------- | -------: |
| Pair observations                  |      200 |
| Positive / negative                | 71 / 129 |
| Precision                          |   0.6667 |
| Recall (uncertainty/failures miss) |   0.3662 |
| F1                                 |   0.4727 |
| Definitive coverage                |   1.0000 |
| Clear-negative coverage            |   0.8992 |
| False positive rate                |   0.1008 |
| AUROC                              |   0.7371 |
| PR-AUC (average precision)         |   0.5797 |
| Scored prevalence                  |   0.3550 |
| Brier                              |   0.2813 |
| Errors / excluded                  |    0 / 0 |

Probabilistic metrics exclude missing distributions; their denominator is 200. Positive recall and coverage retain errors, exclusions and uncertainty. Pair-weighted latency is diagnostic; it is not a deployed request-capacity measurement.

JSON contains complete per-pair distributions, original labels, dataset/native-negative slices, pass summaries, calibration bins, risk/coverage, Wilson intervals and group bootstrap intervals. Cost reservations are not measured charges; unavailable usage/cost stays unknown. No production gates are certified by this report.
