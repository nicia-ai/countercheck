# liquid/d1.2: validation-688 measurement

Measured 2026-11-17 through the `openrouter-candidate` evaluation backend: **688 observations**, 688 completed, one sequential pass, shipped `balanced-v1` prompt and thresholds, no retries or fallback. Reported model identities: `liquid/d1.2-20261116`. Completed-call latency p50 / p95: 273 / 392 ms.

Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.

| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | 97.6 | 44.4 | 58.9 | 0.895 | 0.919 | 6 | 0 |
| scifact | 100.0 | 29.2 | 26.7 | 0.905 | 0.934 | 0 | 0 |
| contractnli | 100.0 | 36.7 | 32.3 | 0.944 | 0.973 | 0 | 0 |
| mnli | 94.4 | 25.0 | 25.0 | 0.933 | 0.966 | 0 | 0 |

Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their denominators. Ranking metrics use completed calls only.

Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.
