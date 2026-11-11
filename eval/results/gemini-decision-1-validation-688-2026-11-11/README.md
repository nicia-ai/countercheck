# google/gemini-decision-1: validation-688 measurement

Measured 2026-11-11 through the `openrouter-candidate` evaluation backend: **688 observations**, 687 completed, one sequential pass, shipped `balanced-v1` prompt and thresholds, no retries or fallback. Reported model identities: `google/gemini-decision-1-20261111`. Completed-call latency p50 / p95: 322 / 509 ms.

Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.

| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | 98.0 | 54.4 | 77.4 | 0.866 | 0.877 | 13 | 0 |
| scifact | 100.0 | 45.8 | 60.0 | 0.978 | 0.987 | 0 | 0 |
| contractnli | 94.4 | 56.7 | 69.3 | 0.877 | 0.954 | 1 | 1 |
| mnli | 97.6 | 60.3 | 55.1 | 0.950 | 0.979 | 0 | 0 |

Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their denominators. Ranking metrics use completed calls only.

Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.
