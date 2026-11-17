# liquid/d1.2-ultra: archive-880 measurement

Measured 2026-11-17 through the `openrouter-candidate` evaluation backend: **880 observations**, 880 completed, one sequential pass, shipped `balanced-v1` prompt and thresholds, no retries or fallback. Reported model identities: `liquid/d1.2-ultra-20261116`. Completed-call latency p50 / p95: 263 / 384 ms.

Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.

| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | 100.0 | 18.3 | 56.6 | 0.839 | 0.883 | 5 | 0 |
| scifact | 94.4 | 23.9 | 44.5 | 0.902 | 0.939 | 1 | 0 |
| contractnli | 100.0 | 34.6 | 26.6 | 0.818 | 0.936 | 0 | 0 |
| mnli | 100.0 | 32.8 | 53.4 | 0.910 | 0.941 | 0 | 0 |
| findver | 100.0 | 79.5 | 71.1 | 0.988 | 0.980 | 2 | 0 |

Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their denominators. Ranking metrics use completed calls only.

Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.
