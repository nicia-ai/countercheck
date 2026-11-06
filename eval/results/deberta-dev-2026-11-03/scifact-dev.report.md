# Countercheck evaluation

Backend: **replay**. Track: **development**. Manifest SHA-256: `d598943442b541f93f0eeaeeea7889470ebebb8715b213608c2f86e1fb90892c`.

Supplied-evidence pair adaptation; this is not an end-to-end retrieval score or production release qualification.

| Measure                            |    Value |
| ---------------------------------- | -------: |
| Pair observations                  |      199 |
| Positive / negative                | 71 / 128 |
| Precision                          |   0.9216 |
| Recall (uncertainty/failures miss) |   0.6620 |
| F1                                 |   0.7705 |
| Definitive coverage                |   1.0000 |
| Clear-negative coverage            |   0.9688 |
| False positive rate                |   0.0313 |
| AUROC                              |   0.9237 |
| PR-AUC (average precision)         |   0.9009 |
| Scored prevalence                  |   0.3568 |
| Brier                              |   0.1285 |
| Errors / excluded                  |    0 / 0 |

Probabilistic metrics exclude missing distributions; their denominator is 199. Positive recall and coverage retain errors, exclusions and uncertainty. Pair-weighted latency is diagnostic; it is not a deployed request-capacity measurement.

JSON contains complete per-pair distributions, original labels, dataset/native-negative slices, pass summaries, calibration bins, risk/coverage, Wilson intervals and group bootstrap intervals. Cost reservations are not measured charges; unavailable usage/cost stays unknown. No production gates are certified by this report.
