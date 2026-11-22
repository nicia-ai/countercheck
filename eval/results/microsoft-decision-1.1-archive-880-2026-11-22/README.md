# microsoft/microsoft-decision-1.1: archive-880 measurement

Measured 2026-11-22 through the `hosted` evaluation backend: **880 observations**, 880 completed, one sequential pass, shipped `balanced-v1` prompt and thresholds, no retries or fallback. Reported model identities: `microsoft/microsoft-decision-1.1-20261117`. Completed-call latency p50 / p95: 266 / 313 ms.

Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.

| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | 96.6 | 39.4 | 69.0 | 0.868 | 0.903 | 3 | 0 |
| scifact | 91.7 | 31.0 | 44.5 | 0.860 | 0.918 | 1 | 0 |
| contractnli | 80.0 | 46.2 | 39.3 | 0.689 | 0.912 | 0 | 0 |
| mnli | 100.0 | 53.7 | 64.7 | 0.966 | 0.980 | 1 | 0 |
| findver | 97.2 | 79.5 | 65.8 | 0.966 | 0.945 | 3 | 0 |

Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their denominators. Ranking metrics use completed calls only.

Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.
