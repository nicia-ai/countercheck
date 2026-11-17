# perplexity/pplx-decider-v1.3:free: validation-688 measurement

Measured 2026-11-16 through the `openrouter-candidate` evaluation backend: **688 observations**, 688 completed, one sequential pass, shipped `balanced-v1` prompt and thresholds, no retries or fallback. Reported model identities: `perplexity/pplx-decider-v1.3-20261112`. Completed-call latency p50 / p95: 287 / 904 ms.

Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.

| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | 98.0 | 54.4 | 80.4 | 0.903 | 0.940 | 12 | 0 |
| scifact | 100.0 | 12.5 | 53.3 | 0.947 | 0.978 | 0 | 0 |
| contractnli | 100.0 | 40.0 | 59.8 | 0.960 | 0.990 | 0 | 0 |
| mnli | 96.6 | 41.2 | 55.9 | 0.944 | 0.966 | 1 | 0 |

Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their denominators. Ranking metrics use completed calls only.

Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.
