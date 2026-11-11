# google/gemini-decision-1: archive-880 measurement

Measured 2026-11-11 through the `openrouter-candidate` evaluation backend: **880 observations**, 879 completed, one sequential pass, shipped `balanced-v1` prompt and thresholds, no retries or fallback. Reported model identities: `google/gemini-decision-1-20261111`. Completed-call latency p50 / p95: 319 / 541 ms.

Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.

| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | 80.6 | 40.8 | 61.2 | 0.798 | 0.862 | 4 | 0 |
| scifact | 95.1 | 54.9 | 64.8 | 0.929 | 0.968 | 3 | 0 |
| contractnli | 82.4 | 53.8 | 56.6 | 0.821 | 0.954 | 0 | 0 |
| mnli | 95.3 | 61.2 | 60.9 | 0.944 | 0.966 | 2 | 1 |
| findver | 97.4 | 86.4 | 81.6 | 0.979 | 0.972 | 2 | 0 |

Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their denominators. Ranking metrics use completed calls only.

Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.
