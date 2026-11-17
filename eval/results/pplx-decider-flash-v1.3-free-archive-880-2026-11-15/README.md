# perplexity/pplx-decider-flash-v1.3:free: archive-880 measurement

Measured 2026-11-15 through the `openrouter-candidate` evaluation backend: **880 observations**, 879 completed, one sequential pass, shipped `balanced-v1` prompt and thresholds, no retries or fallback. Reported model identities: `perplexity/pplx-decider-flash-v1.3-20261112`. Completed-call latency p50 / p95: 187 / 256 ms.

Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.

| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | 93.9 | 43.7 | 72.1 | 0.856 | 0.883 | 2 | 0 |
| scifact | 93.1 | 38.0 | 39.1 | 0.869 | 0.913 | 0 | 0 |
| contractnli | 100.0 | 38.5 | 34.1 | 0.828 | 0.962 | 0 | 0 |
| mnli | 100.0 | 61.2 | 62.4 | 0.959 | 0.978 | 0 | 1 |
| findver | 100.0 | 54.5 | 84.2 | 0.982 | 0.967 | 2 | 0 |

Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their denominators. Ranking metrics use completed calls only.

Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.
