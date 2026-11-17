# liquid/d1.2: archive-880 measurement

Measured 2026-11-17 through the `openrouter-candidate` evaluation backend: **880 observations**, 880 completed, one sequential pass, shipped `balanced-v1` prompt and thresholds, no retries or fallback. Reported model identities: `liquid/d1.2-20261116`. Completed-call latency p50 / p95: 295 / 467 ms.

Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.

| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | 86.7 | 18.3 | 52.7 | 0.786 | 0.871 | 1 | 0 |
| scifact | 91.7 | 31.0 | 28.1 | 0.901 | 0.947 | 0 | 0 |
| contractnli | 88.9 | 30.8 | 14.5 | 0.806 | 0.956 | 0 | 0 |
| mnli | 100.0 | 37.3 | 41.4 | 0.958 | 0.973 | 0 | 0 |
| findver | 100.0 | 61.4 | 36.8 | 0.981 | 0.965 | 2 | 0 |

Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their denominators. Ranking metrics use completed calls only.

Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.
