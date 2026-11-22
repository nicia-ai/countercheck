# microsoft/microsoft-decision-1.1: validation-688 measurement

Measured 2026-11-22 through the `hosted` evaluation backend: **688 observations**, 684 completed, one sequential pass, shipped `balanced-v1` prompt and thresholds, no retries or fallback. Reported model identities: `microsoft/microsoft-decision-1.1-20261117`. Completed-call latency p50 / p95: 270 / 320 ms.

Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.

| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | 97.7 | 46.7 | 77.4 | 0.853 | 0.876 | 14 | 1 |
| scifact | 100.0 | 12.5 | 48.9 | 0.900 | 0.926 | 0 | 0 |
| contractnli | 92.9 | 43.3 | 44.9 | 0.801 | 0.930 | 0 | 2 |
| mnli | 100.0 | 48.5 | 54.4 | 0.947 | 0.963 | 0 | 1 |

Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their denominators. Ranking metrics use completed calls only.

Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.
