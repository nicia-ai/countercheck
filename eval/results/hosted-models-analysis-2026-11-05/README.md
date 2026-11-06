# Post-hoc analysis of the November 5 nine-model comparison

Status: exploratory analysis of previously published observations. No new model calls, tuning validation, or changes to the frozen measurement archives.

## Interpretation

- Four scorecards are reused development samples. FinDVer is a previously scored, untuned public evaluation cohort; its original `locked-test` protocol field is retained as historical metadata, not a claim of a fresh holdout.
- The Fastino phase was specified after the eight-model results were available. It used the same inputs and policy; it was not part of a single prospective nine-model protocol.
- One pass and original presentation were measured. Input-order robustness, inference repeatability, and generalization to unseen-to-model data were not established.
- These public corpora may have been present in provider training. The initial five-arm prompt-ablation study used Jev only; later quality iterations also explored Decider prompts and composition. No vendor-optimized comparison was performed.
- The source labels are native dataset labels, not human adjudication of the service’s four-way contract. All results remain separate from production qualification.

## Ranking and shipped behavior

AUC/AP use successful rows with observed probabilities; their denominators are explicit. Shipped F1, recall and negative coverage retain errors and abstentions in their selected-case denominators. Percentages below are 0–100; AUROC/AP are 0–1.

| Dataset | Model | Shipped F1 | Precision | Recall | Clear negatives | AUROC | AP | Retrospective R@P≥95% | Probability rows / selected |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vitaminc | Jev 1.14 | 54.9 | 90.3 | 39.4 | 79.1 | 0.863 | 0.806 | 28.2 | 200 / 200 |
| vitaminc | Clef | 54.9 | 73.8 | 43.7 | 59.7 | 0.761 | 0.691 | 11.3 | 200 / 200 |
| vitaminc | Clef Flash | 27.0 | 66.7 | 16.9 | 29.5 | 0.746 | 0.605 | 0.0 | 200 / 200 |
| vitaminc | Clef Omni | 40.8 | 65.6 | 29.6 | 58.1 | 0.774 | 0.688 | 22.5 | 200 / 200 |
| vitaminc | GPT-6 Luna (OpenAI Decisions) | 34.1 | 88.2 | 21.1 | 72.9 | 0.861 | 0.779 | 8.5 | 200 / 200 |
| vitaminc | Decision-1 (OpenRouter) | 62.6 | 81.8 | 50.7 | 75.2 | 0.870 | 0.823 | 38.0 | 200 / 200 |
| vitaminc | Pplx Decider v1.2 (OpenRouter) | 64.8 | 94.6 | 49.3 | 79.8 | 0.931 | 0.895 | 54.9 | 200 / 200 |
| vitaminc | Pplx Decider Flash v1.2 (OpenRouter) | 62.5 | 85.4 | 49.3 | 64.3 | 0.859 | 0.823 | 36.6 | 200 / 200 |
| vitaminc | GLiDE 27B (Fastino API) | 64.2 | 97.1 | 47.9 | 85.3 | 0.918 | 0.885 | 47.9 | 200 / 200 |
| scifact | Jev 1.14 | 64.8 | 94.6 | 49.3 | 82.0 | 0.968 | 0.926 | 67.6 | 199 / 199 |
| scifact | Clef | 52.5 | 92.9 | 36.6 | 55.5 | 0.950 | 0.900 | 28.2 | 199 / 199 |
| scifact | Clef Flash | 59.6 | 93.9 | 43.7 | 22.7 | 0.959 | 0.920 | 35.2 | 199 / 199 |
| scifact | Clef Omni | 66.1 | 94.7 | 50.7 | 59.4 | 0.965 | 0.936 | 56.3 | 198 / 199 |
| scifact | GPT-6 Luna (OpenAI Decisions) | 40.9 | 86.4 | 26.8 | 63.3 | 0.819 | 0.751 | 2.8 | 198 / 199 |
| scifact | Decision-1 (OpenRouter) | 63.0 | 91.9 | 47.9 | 66.4 | 0.933 | 0.872 | 14.1 | 199 / 199 |
| scifact | Pplx Decider v1.2 (OpenRouter) | 59.6 | 93.9 | 43.7 | 53.9 | 0.952 | 0.913 | 33.8 | 199 / 199 |
| scifact | Pplx Decider Flash v1.2 (OpenRouter) | 54.0 | 93.1 | 38.0 | 21.1 | 0.925 | 0.874 | 31.0 | 198 / 199 |
| scifact | GLiDE 27B (Fastino API) | 55.4 | 93.3 | 39.4 | 78.9 | 0.964 | 0.931 | 53.5 | 199 / 199 |
| contractnli | Jev 1.14 | 63.4 | 86.7 | 50.0 | 64.2 | 0.927 | 0.739 | 7.7 | 199 / 199 |
| contractnli | Clef | 47.1 | 100.0 | 30.8 | 34.1 | 0.952 | 0.841 | 50.0 | 199 / 199 |
| contractnli | Clef Flash | 51.4 | 100.0 | 34.6 | 15.0 | 0.949 | 0.834 | 42.3 | 199 / 199 |
| contractnli | Clef Omni | 65.0 | 92.9 | 50.0 | 47.4 | 0.980 | 0.886 | 26.9 | 199 / 199 |
| contractnli | GPT-6 Luna (OpenAI Decisions) | 51.3 | 76.9 | 38.5 | 38.7 | 0.854 | 0.624 | 11.5 | 198 / 199 |
| contractnli | Decision-1 (OpenRouter) | 61.8 | 58.6 | 65.4 | 48.0 | 0.885 | 0.699 | 30.8 | 199 / 199 |
| contractnli | Pplx Decider v1.2 (OpenRouter) | 68.3 | 93.3 | 53.8 | 54.9 | 0.964 | 0.861 | 46.2 | 198 / 199 |
| contractnli | Pplx Decider Flash v1.2 (OpenRouter) | 42.4 | 100.0 | 26.9 | 26.6 | 0.955 | 0.786 | 30.8 | 198 / 199 |
| contractnli | GLiDE 27B (Fastino API) | 68.3 | 93.3 | 53.8 | 71.1 | 0.977 | 0.910 | 50.0 | 199 / 199 |
| mnli | Jev 1.14 | 73.6 | 100.0 | 58.2 | 81.2 | 0.977 | 0.966 | 83.6 | 200 / 200 |
| mnli | Clef | 57.4 | 100.0 | 40.3 | 56.4 | 0.957 | 0.940 | 65.7 | 199 / 200 |
| mnli | Clef Flash | 63.3 | 100.0 | 46.3 | 41.4 | 0.982 | 0.969 | 85.1 | 200 / 200 |
| mnli | Clef Omni | 70.5 | 97.4 | 55.2 | 52.6 | 0.983 | 0.966 | 79.1 | 200 / 200 |
| mnli | GPT-6 Luna (OpenAI Decisions) | 49.4 | 100.0 | 32.8 | 66.9 | 0.876 | 0.851 | 58.2 | 200 / 200 |
| mnli | Decision-1 (OpenRouter) | 77.9 | 95.7 | 65.7 | 75.9 | 0.970 | 0.944 | 65.7 | 200 / 200 |
| mnli | Pplx Decider v1.2 (OpenRouter) | 79.6 | 97.8 | 67.2 | 60.2 | 0.987 | 0.975 | 86.6 | 199 / 200 |
| mnli | Pplx Decider Flash v1.2 (OpenRouter) | 75.2 | 97.6 | 61.2 | 50.4 | 0.984 | 0.966 | 67.2 | 200 / 200 |
| mnli | GLiDE 27B (Fastino API) | 76.4 | 97.7 | 62.7 | 82.7 | 0.980 | 0.964 | 79.1 | 199 / 200 |
| findver | Jev 1.14 | 90.0 | 100.0 | 81.8 | 71.1 | 0.963 | 0.977 | 90.9 | 82 / 82 |
| findver | Clef | 42.9 | 100.0 | 27.3 | 55.3 | 0.939 | 0.957 | 77.3 | 82 / 82 |
| findver | Clef Flash | 40.0 | 100.0 | 25.0 | 36.8 | 0.861 | 0.914 | 70.5 | 82 / 82 |
| findver | Clef Omni | 30.8 | 100.0 | 18.2 | 76.3 | 0.927 | 0.949 | 72.7 | 82 / 82 |
| findver | GPT-6 Luna (OpenAI Decisions) | 85.7 | 100.0 | 75.0 | 78.9 | 0.956 | 0.970 | 88.6 | 82 / 82 |
| findver | Decision-1 (OpenRouter) | 69.6 | 96.0 | 54.5 | 65.8 | 0.903 | 0.922 | 63.6 | 82 / 82 |
| findver | Pplx Decider v1.2 (OpenRouter) | 92.7 | 100.0 | 86.4 | 81.6 | 0.965 | 0.981 | 93.2 | 81 / 82 |
| findver | Pplx Decider Flash v1.2 (OpenRouter) | 72.5 | 100.0 | 56.8 | 76.3 | 0.968 | 0.982 | 95.5 | 82 / 82 |
| findver | GLiDE 27B (Fastino API) | 95.2 | 100.0 | 90.9 | 81.6 | 0.964 | 0.981 | 95.5 | 82 / 82 |

R@P≥95% is the maximum recall among nonempty score-threshold selections with at least 95% **observed precision on these same rows**, with whole tied-score blocks using the raw contradiction score, matching the shipped positive gate. AUROC/AP use the archived normalized binary probabilities. Threshold selection and assessment use the same labels. This is optimistic sensitivity analysis, not a validated deployment operating point or a precision guarantee. Missing/error rows remain positive misses. A zero means no native positives were recovered at a qualifying observed operating point; inspect JSON to distinguish no qualifying threshold. Full thresholds, TP/FP and denominators are in `analysis.json`. This scalar sweep does not optimize the four-way negative decision or jointly meet the application’s three targets.

## Paired differences

Each difference is first minus second, in percentage points. Source-group resampling preserves pairs and both models together. Intervals are pointwise exploratory percentile intervals from 20,000 resamples, not multiplicity-adjusted tests or uncertainty over repeated provider inference. Source groups are the recorded grouping approximation; small group counts and extreme outcomes limit inference.

| Dataset | First − second | Groups | F1 difference [95% interval] | Recall difference [95% interval] | Negative coverage difference [95% interval] |
| --- | --- | ---: | ---: | ---: | ---: |
| findver | GLiDE 27B (Fastino API) − Pplx Decider v1.2 (OpenRouter) | 59 | 2.6 [0.0, 6.4] | 4.5 [0.0, 10.9] | 0.0 [-10.3, 10.3] |
| findver | GLiDE 27B (Fastino API) − Jev 1.14 | 59 | 5.2 [1.1, 11.6] | 9.1 [2.0, 18.9] | 10.5 [-3.0, 24.3] |
| contractnli | GLiDE 27B (Fastino API) − Pplx Decider v1.2 (OpenRouter) | 20 | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 16.2 [10.5, 22.1] |
| mnli | GLiDE 27B (Fastino API) − Pplx Decider v1.2 (OpenRouter) | 69 | -3.3 [-8.7, 1.7] | -4.5 [-11.3, 1.5] | 22.6 [15.8, 29.5] |
| vitaminc | Pplx Decider v1.2 (OpenRouter) − Jev 1.14 | 25 | 9.9 [2.4, 20.5] | 9.9 [1.6, 19.7] | 0.8 [-5.0, 6.6] |
| mnli | Pplx Decider v1.2 (OpenRouter) − Jev 1.14 | 69 | 6.1 [-0.7, 13.4] | 9.0 [0.0, 17.9] | -21.1 [-28.5, -13.5] |

A finance F1 interval touching zero for GLiDE versus Decider leaves that comparison inconclusive. GLiDE versus Jev on finance and Decider versus Jev on VitaminC have exploratory F1 intervals above zero on this fixed sample; positive-only paired tests answer a different recall question. Equal observed contract detections do not establish population equivalence. Bootstrap intervals cannot establish high precision from a small cohort with zero observed false positives.

## Negative coverage by native label

All native negatives remain in each denominator. Neutral/NEI labels are not automatically the service’s `insufficient_context` label. Low confidence and a different leading relation are distinct reasons to abstain; JSON records the leading raw category among uncertain responses, preserving ties.

| Dataset | Native label | Model | Clear / selected | Coverage | Uncertain | False positives | Errors |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| vitaminc | NOT ENOUGH INFO | Jev 1.14 | 12 / 29 | 41.4 | 15 | 2 | 0 |
| vitaminc | SUPPORTS | Jev 1.14 | 90 / 100 | 90.0 | 9 | 1 | 0 |
| scifact | SUPPORT | Jev 1.14 | 105 / 128 | 82.0 | 21 | 2 | 0 |
| contractnli | Entailment | Jev 1.14 | 111 / 173 | 64.2 | 60 | 2 | 0 |
| mnli | entailment | Jev 1.14 | 65 / 72 | 90.3 | 7 | 0 | 0 |
| mnli | neutral | Jev 1.14 | 43 / 61 | 70.5 | 18 | 0 | 0 |
| findver | entailed | Jev 1.14 | 27 / 38 | 71.1 | 11 | 0 | 0 |
| vitaminc | NOT ENOUGH INFO | Clef | 8 / 29 | 27.6 | 15 | 6 | 0 |
| vitaminc | SUPPORTS | Clef | 69 / 100 | 69.0 | 26 | 5 | 0 |
| scifact | SUPPORT | Clef | 71 / 128 | 55.5 | 55 | 2 | 0 |
| contractnli | Entailment | Clef | 59 / 173 | 34.1 | 114 | 0 | 0 |
| mnli | entailment | Clef | 62 / 72 | 86.1 | 10 | 0 | 0 |
| mnli | neutral | Clef | 13 / 61 | 21.3 | 47 | 0 | 1 |
| findver | entailed | Clef | 21 / 38 | 55.3 | 17 | 0 | 0 |
| vitaminc | NOT ENOUGH INFO | Clef Flash | 4 / 29 | 13.8 | 21 | 4 | 0 |
| vitaminc | SUPPORTS | Clef Flash | 34 / 100 | 34.0 | 64 | 2 | 0 |
| scifact | SUPPORT | Clef Flash | 29 / 128 | 22.7 | 97 | 2 | 0 |
| contractnli | Entailment | Clef Flash | 26 / 173 | 15.0 | 147 | 0 | 0 |
| mnli | entailment | Clef Flash | 44 / 72 | 61.1 | 28 | 0 | 0 |
| mnli | neutral | Clef Flash | 11 / 61 | 18.0 | 50 | 0 | 0 |
| findver | entailed | Clef Flash | 14 / 38 | 36.8 | 24 | 0 | 0 |
| vitaminc | NOT ENOUGH INFO | Clef Omni | 11 / 29 | 37.9 | 12 | 6 | 0 |
| vitaminc | SUPPORTS | Clef Omni | 64 / 100 | 64.0 | 31 | 5 | 0 |
| scifact | SUPPORT | Clef Omni | 76 / 128 | 59.4 | 49 | 2 | 1 |
| contractnli | Entailment | Clef Omni | 82 / 173 | 47.4 | 90 | 1 | 0 |
| mnli | entailment | Clef Omni | 60 / 72 | 83.3 | 12 | 0 | 0 |
| mnli | neutral | Clef Omni | 10 / 61 | 16.4 | 50 | 1 | 0 |
| findver | entailed | Clef Omni | 29 / 38 | 76.3 | 9 | 0 | 0 |
| vitaminc | NOT ENOUGH INFO | GPT-6 Luna (OpenAI Decisions) | 14 / 29 | 48.3 | 13 | 2 | 0 |
| vitaminc | SUPPORTS | GPT-6 Luna (OpenAI Decisions) | 80 / 100 | 80.0 | 20 | 0 | 0 |
| scifact | SUPPORT | GPT-6 Luna (OpenAI Decisions) | 81 / 128 | 63.3 | 43 | 3 | 1 |
| contractnli | Entailment | GPT-6 Luna (OpenAI Decisions) | 67 / 173 | 38.7 | 102 | 3 | 1 |
| mnli | entailment | GPT-6 Luna (OpenAI Decisions) | 58 / 72 | 80.6 | 14 | 0 | 0 |
| mnli | neutral | GPT-6 Luna (OpenAI Decisions) | 31 / 61 | 50.8 | 30 | 0 | 0 |
| findver | entailed | GPT-6 Luna (OpenAI Decisions) | 30 / 38 | 78.9 | 8 | 0 | 0 |
| vitaminc | NOT ENOUGH INFO | Decision-1 (OpenRouter) | 10 / 29 | 34.5 | 13 | 6 | 0 |
| vitaminc | SUPPORTS | Decision-1 (OpenRouter) | 87 / 100 | 87.0 | 11 | 2 | 0 |
| scifact | SUPPORT | Decision-1 (OpenRouter) | 85 / 128 | 66.4 | 40 | 3 | 0 |
| contractnli | Entailment | Decision-1 (OpenRouter) | 83 / 173 | 48.0 | 78 | 12 | 0 |
| mnli | entailment | Decision-1 (OpenRouter) | 69 / 72 | 95.8 | 3 | 0 | 0 |
| mnli | neutral | Decision-1 (OpenRouter) | 32 / 61 | 52.5 | 27 | 2 | 0 |
| findver | entailed | Decision-1 (OpenRouter) | 25 / 38 | 65.8 | 12 | 1 | 0 |
| vitaminc | NOT ENOUGH INFO | Pplx Decider v1.2 (OpenRouter) | 8 / 29 | 27.6 | 20 | 1 | 0 |
| vitaminc | SUPPORTS | Pplx Decider v1.2 (OpenRouter) | 95 / 100 | 95.0 | 4 | 1 | 0 |
| scifact | SUPPORT | Pplx Decider v1.2 (OpenRouter) | 69 / 128 | 53.9 | 57 | 2 | 0 |
| contractnli | Entailment | Pplx Decider v1.2 (OpenRouter) | 95 / 173 | 54.9 | 76 | 1 | 1 |
| mnli | entailment | Pplx Decider v1.2 (OpenRouter) | 64 / 72 | 88.9 | 8 | 0 | 0 |
| mnli | neutral | Pplx Decider v1.2 (OpenRouter) | 16 / 61 | 26.2 | 44 | 1 | 0 |
| findver | entailed | Pplx Decider v1.2 (OpenRouter) | 31 / 38 | 81.6 | 7 | 0 | 0 |
| vitaminc | NOT ENOUGH INFO | Pplx Decider Flash v1.2 (OpenRouter) | 4 / 29 | 13.8 | 20 | 5 | 0 |
| vitaminc | SUPPORTS | Pplx Decider Flash v1.2 (OpenRouter) | 79 / 100 | 79.0 | 20 | 1 | 0 |
| scifact | SUPPORT | Pplx Decider Flash v1.2 (OpenRouter) | 27 / 128 | 21.1 | 99 | 2 | 0 |
| contractnli | Entailment | Pplx Decider Flash v1.2 (OpenRouter) | 46 / 173 | 26.6 | 127 | 0 | 0 |
| mnli | entailment | Pplx Decider Flash v1.2 (OpenRouter) | 58 / 72 | 80.6 | 14 | 0 | 0 |
| mnli | neutral | Pplx Decider Flash v1.2 (OpenRouter) | 9 / 61 | 14.8 | 51 | 1 | 0 |
| findver | entailed | Pplx Decider Flash v1.2 (OpenRouter) | 29 / 38 | 76.3 | 9 | 0 | 0 |
| vitaminc | NOT ENOUGH INFO | GLiDE 27B (Fastino API) | 14 / 29 | 48.3 | 14 | 1 | 0 |
| vitaminc | SUPPORTS | GLiDE 27B (Fastino API) | 96 / 100 | 96.0 | 4 | 0 | 0 |
| scifact | SUPPORT | GLiDE 27B (Fastino API) | 101 / 128 | 78.9 | 25 | 2 | 0 |
| contractnli | Entailment | GLiDE 27B (Fastino API) | 123 / 173 | 71.1 | 49 | 1 | 0 |
| mnli | entailment | GLiDE 27B (Fastino API) | 67 / 72 | 93.1 | 4 | 0 | 1 |
| mnli | neutral | GLiDE 27B (Fastino API) | 43 / 61 | 70.5 | 17 | 1 | 0 |
| findver | entailed | GLiDE 27B (Fastino API) | 31 / 38 | 81.6 | 7 | 0 | 0 |

GLiDE and Jev each clear 43/61 MultiNLI-neutral cases. Decider clears 16/61; of its 44 uncertain cases, 33 favor `consistent`, eight favor `insufficient_context`, and three favor `contradiction`. ContractNLI’s 173 selected negatives are all entailments: GLiDE clears 123 versus Decider’s 95. Neutral/NEI alone therefore cannot explain that coverage difference.

## Reproduction and provenance

Run `python3 -B scripts/verify-eval-release.py` from the repository root to verify both original archives and recompute this supplement. `python3 -B scripts/analyze-eval-release.py` checks the supplement alone. Python standard library only; no credentials, original finance text, or network access are needed.

The analysis pins its observation archive, summary, protocols, metric helper and analysis source by SHA-256. `archive-sha256.json` pins this supplement’s generated JSON and README. The verifier recomputes the supplement with the declared analysis implementation; its new statistical calculations are covered by analytic regression fixtures, rather than claimed as an independent second statistical implementation. The base release verifier separately checks original aggregate metrics with the independent metric helper.

To reconstruct into a new empty directory: `python3 -B scripts/analyze-eval-release.py --write --output /tmp/countercheck-analysis`. The command refuses to overwrite a nonempty directory. Original measurement inventories and source snapshots remain unchanged.
