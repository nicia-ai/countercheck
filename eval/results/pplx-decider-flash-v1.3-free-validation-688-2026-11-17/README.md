# perplexity/pplx-decider-flash-v1.3:free: validation-688 measurement

Measured 2026-11-17 through the `openrouter-candidate` evaluation backend: **688 observations**, 688 completed, one sequential pass, shipped `balanced-v1` prompt and thresholds, no retries or fallback. Reported model identities: `perplexity/pplx-decider-flash-v1.3-20261112`. Completed-call latency p50 / p95: 214 / 347 ms.

Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.

| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | 96.3 | 57.8 | 69.0 | 0.905 | 0.922 | 6 | 0 |
| scifact | 100.0 | 25.0 | 26.7 | 0.834 | 0.906 | 0 | 0 |
| contractnli | 100.0 | 40.0 | 39.4 | 0.947 | 0.971 | 0 | 0 |
| mnli | 94.6 | 51.5 | 48.5 | 0.935 | 0.957 | 1 | 0 |

Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their denominators. Ranking metrics use completed calls only.

Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.
