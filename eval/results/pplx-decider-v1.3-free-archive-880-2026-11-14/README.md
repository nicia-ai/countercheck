# perplexity/pplx-decider-v1.3:free: archive-880 measurement

Measured 2026-11-14 through the `openrouter-candidate` evaluation backend: **880 observations**, 879 completed, one sequential pass, shipped `balanced-v1` prompt and thresholds, no retries or fallback. Reported model identities: `perplexity/pplx-decider-v1.3-20261112`. Completed-call latency p50 / p95: 280 / 416 ms.

Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.

| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | 100.0 | 38.0 | 74.4 | 0.876 | 0.912 | 2 | 1 |
| scifact | 91.7 | 31.0 | 52.3 | 0.917 | 0.964 | 0 | 0 |
| contractnli | 92.3 | 46.2 | 55.5 | 0.880 | 0.970 | 0 | 0 |
| mnli | 100.0 | 52.2 | 69.9 | 0.959 | 0.977 | 0 | 0 |
| findver | 100.0 | 88.6 | 68.4 | 0.979 | 0.961 | 2 | 0 |

Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their denominators. Ranking metrics use completed calls only.

Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.
