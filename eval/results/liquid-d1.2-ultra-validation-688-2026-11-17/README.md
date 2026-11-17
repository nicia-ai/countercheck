# liquid/d1.2-ultra: validation-688 measurement

Measured 2026-11-17 through the `openrouter-candidate` evaluation backend: **688 observations**, 688 completed, one sequential pass, shipped `balanced-v1` prompt and thresholds, no retries or fallback. Reported model identities: `liquid/d1.2-ultra-20261116`. Completed-call latency p50 / p95: 341 / 1153 ms.

Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.

| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | 96.9 | 34.4 | 63.7 | 0.848 | 0.874 | 10 | 0 |
| scifact | 100.0 | 8.3 | 28.9 | 0.926 | 0.949 | 0 | 0 |
| contractnli | 100.0 | 30.0 | 29.1 | 0.963 | 0.990 | 0 | 0 |
| mnli | 95.0 | 27.9 | 42.6 | 0.916 | 0.950 | 0 | 0 |

Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their denominators. Ranking metrics use completed calls only.

Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.
