# Nace Drex: append-only benchmark comparison

Measured November 6, 2026. Five active Nace IDs, **4,600 observations**: the same 880 public pairs and 40 synthetic diagnostics per model as the [November 5 nine-model archive](../hosted-models-with-glide-2026-11-05/README.md). That archive remains unchanged. This is a later phase, specified after its results and the calibration study were available, not a contemporaneous 14-model experiment.

Fixed shipped `balanced-v1` prompt and thresholds, original presentation, isolated pairs, one pass, sequential calls, 3,000ms kernel deadline, no retries, fallback, truncation, prompt changes or threshold tuning. Pre-benchmark synthetic integration probes are separate from quality denominators; their count and sanitized receipts are recorded in `protocol.json` and `integration-probes.json`. These receipts are operator-recorded integration metadata, pinned at archive creation rather than hash-bound to the pre-inference protocol; benchmark HTTP statuses are independently instrumented during execution. Pacing between starts within each cohort is outside latency and deadlines; each cohort starts a new process, so no minimum interval is guaranteed across cohort boundaries. Explicit active IDs exclude aliases and retired forwards; returned identities must match. A checkpoint revision is unavailable.

Four public scorecards are reused development samples. FinDVer is previously scored and untuned; its historical `locked-test` manifest field is not a fresh holdout claim. Public training contamination remains possible. Native labels are not independent human adjudication of Countercheck's four-way contract. The initial prompt-ablation study was Jev-only; later Decider experiments do not make this vendor-optimized prompting. One pass does not establish repeatability or option-order robustness. Nace receives the shared kernel payload with only its model field replaced; the baseline retains its documented provider-specific encodings. Server-side rendering/tokenization may differ.

The [technical report](https://arxiv.org/abs/2611.07854) describes four released architectures; the API has five active serving IDs, including Max v1.1 and Finance. We test those hosted IDs, not the unserved DLM weights or the paper's exact checkpoints. Vendor-wide calibration and leaderboard claims are not our contradiction quality measurements. No model is promoted into the production catalog by this run. Nicia has no commercial relationship with any evaluated model provider.

## Findings

- **No Nace model/domain scorecard meets all three point targets.** These remain native-label scorecards, not production qualification.
- **Max Finance on the 82 finance pairs:** 100.0% precision, 88.6% recall and 84.2% clear-negative coverage; 3 failures remain in denominators. This describes this cohort and deadline, not a finance-wide guarantee.
- **Cutoffs matter for negative clearance.** Max v1.1 has 68 uncertain SciFact negatives and 82 uncertain ContractNLI negatives whose leading label is consistent. We have not fitted and independently validated model-specific Nace thresholds; the retrospective ranking view is not a replacement for that study.
- **Execution:** 4391/4,400 public observations completed, with 9 errors. The same deadline applies to all Nace rows; the separate status archive distinguishes HTTP responses from failures without one. Baseline comparisons are non-contemporaneous. See the paired intervals before interpreting table differences as wins.


## Shipped-policy comparison

Each cell is **precision / recall / clear-negative coverage**, in percent. Errors and abstentions remain in recall and coverage denominators. Results are separated by domain; no pooled quality ranking. Higher coverage is an operating-point result, not necessarily an intrinsic model advantage; see the [separate calibration study](../calibration-followup-2026-11-06/README.md). Nace has not had the corresponding independently fitted validation study.

| Model | VitaminC | SciFact | ContractNLI | MultiNLI | FinDVer |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jev 1.14 | 90.3 / 39.4 / 79.1 | 94.6 / 49.3 / 82.0 | 86.7 / 50.0 / 64.2 | 100.0 / 58.2 / 81.2 | 100.0 / 81.8 / 71.1 |
| Clef | 73.8 / 43.7 / 59.7 | 92.9 / 36.6 / 55.5 | 100.0 / 30.8 / 34.1 | 100.0 / 40.3 / 56.4 | 100.0 / 27.3 / 55.3 |
| Clef Flash | 66.7 / 16.9 / 29.5 | 93.9 / 43.7 / 22.7 | 100.0 / 34.6 / 15.0 | 100.0 / 46.3 / 41.4 | 100.0 / 25.0 / 36.8 |
| Clef Omni | 65.6 / 29.6 / 58.1 | 94.7 / 50.7 / 59.4 | 92.9 / 50.0 / 47.4 | 97.4 / 55.2 / 52.6 | 100.0 / 18.2 / 76.3 |
| GPT-6 Luna (OpenAI Decisions) | 88.2 / 21.1 / 72.9 | 86.4 / 26.8 / 63.3 | 76.9 / 38.5 / 38.7 | 100.0 / 32.8 / 66.9 | 100.0 / 75.0 / 78.9 |
| Decision-1 (OpenRouter) | 81.8 / 50.7 / 75.2 | 91.9 / 47.9 / 66.4 | 58.6 / 65.4 / 48.0 | 95.7 / 65.7 / 75.9 | 96.0 / 54.5 / 65.8 |
| Pplx Decider v1.2 (OpenRouter) | 94.6 / 49.3 / 79.8 | 93.9 / 43.7 / 53.9 | 93.3 / 53.8 / 54.9 | 97.8 / 67.2 / 60.2 | 100.0 / 86.4 / 81.6 |
| Pplx Decider Flash v1.2 (OpenRouter) | 85.4 / 49.3 / 64.3 | 93.1 / 38.0 / 21.1 | 100.0 / 26.9 / 26.6 | 97.6 / 61.2 / 50.4 | 100.0 / 56.8 / 76.3 |
| GLiDE 27B (Fastino API) | 97.1 / 47.9 / 85.3 | 93.3 / 39.4 / 78.9 | 93.3 / 53.8 / 71.1 | 97.7 / 62.7 / 82.7 | 100.0 / 90.9 / 81.6 |
| drex-max-v1.1 | 100.0 / 40.8 / 77.5 | 92.0 / 32.4 / 27.3 | 100.0 / 38.5 / 35.3 | 100.0 / 58.2 / 59.4 | 100.0 / 86.4 / 71.1 |
| drex-max-finance | 90.2 / 52.1 / 79.1 | 93.5 / 40.8 / 48.4 | 100.0 / 46.2 / 61.8 | 94.5 / 77.6 / 65.4 | 100.0 / 88.6 / 84.2 |
| drex-v2.0 | 83.3 / 42.3 / 51.2 | 92.9 / 36.6 / 34.4 | 88.9 / 30.8 / 37.0 | 100.0 / 52.2 / 49.6 | 100.0 / 38.6 / 60.5 |
| drex-max | 97.4 / 53.5 / 82.2 | 93.1 / 38.0 / 57.0 | 87.5 / 53.8 / 54.3 | 97.7 / 64.2 / 75.9 | 100.0 / 84.1 / 89.5 |
| drex-v1.5 | 80.9 / 53.5 / 78.3 | 90.0 / 50.7 / 87.5 | 81.8 / 34.6 / 71.7 | 97.3 / 53.7 / 84.2 | 100.0 / 68.2 / 89.5 |

## Nace ranking diagnostics

AUROC/AP use observed successful distributions only; R@P≥95% uses the raw contradiction score and is a retrospective in-sample sensitivity ceiling, **not a validated threshold**. Missing distributions stay misses in recall. No cutoff from this table is selected for deployment.

| Model | Dataset | F1 | AUROC | AP | Retrospective R@P≥95% | Probability rows / selected | False clears | Errors / excluded |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drex-max-v1.1 | vitaminc | 58.0 | 0.917 | 0.890 | 53.5 | 200 / 200 | 4 | 0 / 0 |
| drex-max-v1.1 | scifact | 47.9 | 0.921 | 0.893 | 56.3 | 198 / 199 | 0 | 1 / 0 |
| drex-max-v1.1 | contractnli | 55.6 | 0.953 | 0.839 | 53.8 | 199 / 199 | 0 | 0 / 0 |
| drex-max-v1.1 | mnli | 73.6 | 0.989 | 0.980 | 83.6 | 200 / 200 | 1 | 0 / 0 |
| drex-max-v1.1 | findver | 92.7 | 0.975 | 0.986 | 95.5 | 82 / 82 | 2 | 0 / 0 |
| drex-max-v1.1 | findver-strict-subset | 96.0 | 0.938 | 0.971 | 92.3 | 23 / 23 | 1 | 0 / 0 |
| drex-max-finance | vitaminc | 66.1 | 0.912 | 0.880 | 47.9 | 200 / 200 | 5 | 0 / 0 |
| drex-max-finance | scifact | 56.9 | 0.938 | 0.912 | 60.6 | 199 / 199 | 1 | 0 / 0 |
| drex-max-finance | contractnli | 63.2 | 0.971 | 0.893 | 50.0 | 199 / 199 | 0 | 0 / 0 |
| drex-max-finance | mnli | 85.2 | 0.983 | 0.970 | 76.1 | 198 / 200 | 1 | 2 / 0 |
| drex-max-finance | findver | 94.0 | 0.955 | 0.978 | 90.9 | 79 / 82 | 2 | 3 / 0 |
| drex-max-finance | findver-strict-subset | 91.7 | 0.917 | 0.964 | 84.6 | 21 / 23 | 1 | 2 / 0 |
| drex-v2.0 | vitaminc | 56.1 | 0.843 | 0.763 | 2.8 | 199 / 200 | 4 | 1 / 0 |
| drex-v2.0 | scifact | 52.5 | 0.923 | 0.873 | 35.2 | 198 / 199 | 0 | 1 / 0 |
| drex-v2.0 | contractnli | 45.7 | 0.940 | 0.770 | 23.1 | 199 / 199 | 0 | 0 / 0 |
| drex-v2.0 | mnli | 68.6 | 0.980 | 0.963 | 76.1 | 200 / 200 | 0 | 0 / 0 |
| drex-v2.0 | findver | 55.7 | 0.963 | 0.979 | 90.9 | 82 / 82 | 2 | 0 / 0 |
| drex-v2.0 | findver-strict-subset | 63.2 | 0.915 | 0.950 | 76.9 | 23 / 23 | 1 | 0 / 0 |
| drex-max | vitaminc | 69.1 | 0.919 | 0.886 | 53.5 | 200 / 200 | 8 | 0 / 0 |
| drex-max | scifact | 54.0 | 0.949 | 0.906 | 64.8 | 199 / 199 | 0 | 0 / 0 |
| drex-max | contractnli | 66.7 | 0.938 | 0.807 | 46.2 | 198 / 199 | 1 | 1 / 0 |
| drex-max | mnli | 77.5 | 0.975 | 0.958 | 71.6 | 200 / 200 | 2 | 0 / 0 |
| drex-max | findver | 91.4 | 0.965 | 0.980 | 95.5 | 82 / 82 | 2 | 0 / 0 |
| drex-max | findver-strict-subset | 91.7 | 0.946 | 0.970 | 84.6 | 23 / 23 | 1 | 0 / 0 |
| drex-v1.5 | vitaminc | 64.4 | 0.835 | 0.792 | 32.4 | 200 / 200 | 18 | 0 / 0 |
| drex-v1.5 | scifact | 64.9 | 0.950 | 0.884 | 9.9 | 199 / 199 | 5 | 0 / 0 |
| drex-v1.5 | contractnli | 48.6 | 0.942 | 0.757 | 26.9 | 199 / 199 | 1 | 0 / 0 |
| drex-v1.5 | mnli | 69.2 | 0.969 | 0.946 | 68.7 | 200 / 200 | 3 | 0 / 0 |
| drex-v1.5 | findver | 81.1 | 0.957 | 0.977 | 93.2 | 82 / 82 | 2 | 0 / 0 |
| drex-v1.5 | findver-strict-subset | 76.2 | 0.915 | 0.949 | 69.2 | 23 / 23 | 1 | 0 / 0 |

## Joint point targets

All three must hold on the same native-label scorecard: precision ≥95%, recall ≥90%, clear-negative coverage ≥85%. A point estimate is not a confidence-bound guarantee or human-adjudicated service-contract qualification.

| Model | Public scorecards meeting all three point targets |
| --- | --- |
| drex-max-v1.1 | None |
| drex-max-finance | None |
| drex-v2.0 | None |
| drex-max | None |
| drex-v1.5 | None |

## Paired intervals against full Decider

Exploratory post-hoc comparisons, specified after early Nace results were visible. Every Nace model is compared with the same full Decider baseline on every public scorecard. Differences are Nace minus Decider, in percentage points, with percentile 95% intervals from 20,000 paired source-group resamples (seed 20261106). The interval matches the named metric. These are unadjusted for multiple comparisons; no population-equivalence claim follows from an interval containing zero. Dataset/group selection and small samples limit inference.

| Nace model | Dataset | F1 difference [95% interval] | Recall difference [95% interval] | Clear-negative difference [95% interval] |
| --- | --- | ---: | ---: | ---: |
| drex-max | vitaminc | +4.3 [+0.0, +9.7] | +4.2 [+0.0, +10.0] | +2.3 [-0.8, +5.8] |
| drex-max | scifact | -5.6 [-13.8, +1.7] | -5.6 [-13.3, +1.7] | +3.1 [-3.8, +9.9] |
| drex-max | contractnli | -1.6 [-10.6, +9.7] | +0.0 [-10.7, +12.0] | -0.6 [-4.9, +3.3] |
| drex-max | mnli | -2.2 [-8.5, +4.1] | -3.0 [-11.3, +4.8] | +15.8 [+9.3, +22.7] |
| drex-max | findver | -1.3 [-4.2, +0.0] | -2.3 [-7.1, +0.0] | +7.9 [+0.0, +17.1] |
| drex-max-finance | vitaminc | +1.3 [-4.0, +7.7] | +2.8 [-4.3, +12.0] | -0.8 [-4.4, +2.7] |
| drex-max-finance | scifact | -2.8 [-10.6, +5.0] | -2.8 [-10.5, +5.2] | -5.5 [-12.6, +1.4] |
| drex-max-finance | contractnli | -5.1 [-16.7, +5.0] | -7.7 [-21.1, +0.0] | +6.9 [+3.0, +10.8] |
| drex-max-finance | mnli | +5.6 [-0.2, +12.4] | +10.4 [+2.9, +19.4] | +5.3 [+0.0, +10.6] |
| drex-max-finance | findver | +1.3 [-3.3, +5.7] | +2.3 [-5.6, +9.8] | +2.6 [-5.9, +11.6] |
| drex-max-v1.1 | vitaminc | -6.8 [-16.4, -0.7] | -8.5 [-17.2, -2.3] | -2.3 [-6.1, +0.8] |
| drex-max-v1.1 | scifact | -11.7 [-21.1, -3.4] | -11.3 [-19.7, -3.2] | -26.6 [-34.7, -18.7] |
| drex-max-v1.1 | contractnli | -12.7 [-25.2, +1.7] | -15.4 [-29.0, +0.0] | -19.7 [-25.1, -14.5] |
| drex-max-v1.1 | mnli | -6.1 [-13.6, +0.4] | -9.0 [-18.3, +0.0] | -0.8 [-5.8, +4.4] |
| drex-max-v1.1 | findver | +0.0 [-5.2, +5.2] | +0.0 [-8.9, +8.9] | -10.5 [-23.1, +0.0] |
| drex-v1.5 | vitaminc | -0.4 [-12.6, +12.8] | +4.2 [-10.4, +19.8] | -1.6 [-9.6, +5.0] |
| drex-v1.5 | scifact | +5.2 [-5.6, +16.7] | +7.0 [-4.6, +19.4] | +33.6 [+24.2, +42.9] |
| drex-v1.5 | contractnli | -19.6 [-39.2, +2.4] | -19.2 [-41.7, +4.2] | +16.8 [+8.1, +25.2] |
| drex-v1.5 | mnli | -10.4 [-20.4, -1.1] | -13.4 [-25.7, -1.5] | +24.1 [+16.4, +31.6] |
| drex-v1.5 | findver | -11.6 [-23.9, -2.8] | -18.2 [-34.4, -4.5] | +7.9 [-2.7, +20.0] |
| drex-v2.0 | vitaminc | -8.7 [-21.3, +2.4] | -7.0 [-21.8, +5.6] | -28.7 [-39.6, -18.8] |
| drex-v2.0 | scifact | -7.1 [-15.4, +1.1] | -7.0 [-15.0, +1.3] | -19.5 [-29.5, -9.4] |
| drex-v2.0 | contractnli | -22.6 [-38.3, -4.8] | -23.1 [-42.4, -4.3] | -17.9 [-25.1, -10.8] |
| drex-v2.0 | mnli | -11.0 [-20.6, -2.5] | -14.9 [-26.0, -4.5] | -10.5 [-17.0, -3.8] |
| drex-v2.0 | findver | -36.9 [-54.3, -23.0] | -47.7 [-64.3, -31.8] | -21.1 [-35.3, -8.6] |

## Uncertain native negatives

Counts below distinguish low-confidence compatible judgments from an insufficient-context leading label. Native negatives are not automatically unknown. Exact ties are retained separately.

| Model | Dataset | Consistent leads | Different scope leads | Insufficient context leads | Contradiction leads | Ties |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| drex-max-v1.1 | vitaminc | 12 | 1 | 8 | 8 | 0 |
| drex-max-v1.1 | scifact | 68 | 0 | 21 | 1 | 0 |
| drex-max-v1.1 | contractnli | 82 | 2 | 21 | 5 | 2 |
| drex-max-v1.1 | mnli | 41 | 0 | 9 | 4 | 0 |
| drex-max-v1.1 | findver | 10 | 0 | 1 | 0 | 0 |
| drex-max-finance | vitaminc | 9 | 1 | 5 | 8 | 0 |
| drex-max-finance | scifact | 53 | 0 | 8 | 2 | 1 |
| drex-max-finance | contractnli | 53 | 1 | 8 | 4 | 0 |
| drex-max-finance | mnli | 32 | 0 | 5 | 2 | 2 |
| drex-max-finance | findver | 4 | 0 | 1 | 0 | 0 |
| drex-v2.0 | vitaminc | 40 | 2 | 3 | 12 | 0 |
| drex-v2.0 | scifact | 55 | 3 | 22 | 2 | 0 |
| drex-v2.0 | contractnli | 87 | 8 | 3 | 10 | 0 |
| drex-v2.0 | mnli | 39 | 2 | 22 | 4 | 0 |
| drex-v2.0 | findver | 14 | 0 | 1 | 0 | 0 |
| drex-max | vitaminc | 9 | 0 | 2 | 11 | 0 |
| drex-max | scifact | 40 | 0 | 11 | 1 | 1 |
| drex-max | contractnli | 53 | 3 | 9 | 10 | 1 |
| drex-max | mnli | 22 | 0 | 5 | 4 | 0 |
| drex-max | findver | 2 | 0 | 1 | 0 | 1 |
| drex-v1.5 | vitaminc | 13 | 0 | 1 | 5 | 0 |
| drex-v1.5 | scifact | 10 | 0 | 1 | 1 | 0 |
| drex-v1.5 | contractnli | 38 | 0 | 3 | 6 | 0 |
| drex-v1.5 | mnli | 15 | 0 | 1 | 4 | 0 |
| drex-v1.5 | findver | 4 | 0 | 0 | 0 | 0 |

## Execution

Public 880-pair cohorts only. Successful-call latency excludes failures and pacing; it is not authenticated deployed API latency, a capacity comparison or an SLA. Client attempts are sequential and non-contemporaneous with the baseline; timed-out work may continue upstream. Timeout counts do not establish a change in vendor speed. Input-token arithmetic is a price estimate, not an invoice; tokens and accounting differ by provider. Failed-call usage remains unknown.

| Model | Completed | Errors / excluded | p50 ms | p95 ms | Known input tokens | Estimated known-input USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| drex-max-v1.1 | 879/880 | 1 / 0 | 184 | 332 | 402011 | 0.01206 |
| drex-max-finance | 875/880 | 5 / 0 | 222 | 305 | 398916 | 0.01197 |
| drex-v2.0 | 878/880 | 2 / 0 | 198 | 288 | 342657 | 0.02056 |
| drex-max | 879/880 | 1 / 0 | 129 | 199 | 404679 | 0.01214 |
| drex-v1.5 | 880/880 | 0 / 0 | 182 | 249 | 343379 | 0.01717 |

## Synthetic diagnostics

Reported separately; four uncertain fixtures are excluded from binary quality metrics.

| Model | Smoke explicit expectations | Contract explicit expectations |
| --- | ---: | ---: |
| drex-max-v1.1 | 0/0 | 25/32 |
| drex-max-finance | 0/0 | 24/32 |
| drex-v2.0 | 0/0 | 27/32 |
| drex-max | 0/0 | 30/32 |
| drex-v1.5 | 0/0 | 26/32 |

## Scope and reproduction

ContractNLI uses gold rationale excerpts, not the official full-document task. FinDVer is the same length-conditioned 82-pair IE cohort; the strict 23-pair subset overlaps and is derived without extra calls. MultiNLI government/telephone/Slate is business-adjacent language, not a workplace dataset. The [original data provenance](../hosted-models-2026-11-05/data-provenance.json) retains source URLs, hashes and terms. No new labels or holdouts were opened. This isolated text-pair protocol does not measure image understanding, shared-state multi-question efficiency, or the paper's wider decision tasks.

`summary.json` preserves the TypeScript scorecards and source-group intervals beside independent Python recomputation, native-label slices and probability denominators. Interval and ranking fields do not establish significant cross-model wins; table differences are descriptive. `observations.redacted.jsonl.gz` replaces every claim and comparison text with hashes/byte counts and the original sanitized pair metadata. Finance source text and full reports remain in ignored local storage. `http-status.json` contains only per-run numeric status observations and ordinals, with null for no received response. Neither keys nor error bodies are archived. Execution sources are pinned before benchmark inference, analysis provenance after inference. The unused OpenRouter adapter's later metadata-stripping fix is disclosed in the protocol; the shared kernel/metrics/transport are byte-identical to November 5.

Verify all published metrics offline, with no provider credentials or network calls:

```sh
python3 scripts/compare-nace.py --verify eval/results/nace-2026-11-06
```

Re-running inference additionally needs the original local manifests and a private `NACE_API_KEY`:

```sh
pnpm exec node --env-file=.env --import tsx scripts/run-nace-benchmark.ts \
  --live --baseline eval/results/hosted-models-2026-11-05 \
  --out eval/reports/nace-FRESH --max-calls 4600 --prior-probes 0 \
  --cost-per-call-usd 0.002 --max-spend-usd 10 --interval-ms 550
python3 scripts/compare-nace.py --input eval/reports/nace-FRESH --out eval/results/nace-FRESH
```

Call/spend figures are conservative operator reservations, not an upstream enforced spending limit or measured charge. The initial run used a 4,605-call reservation including its five separate probes. Consult the [live model catalog](https://console.nace.ai/docs/drex/reference/models), [pricing](https://console.nace.ai/docs/drex/reference/pricing) and [rate limits](https://console.nace.ai/docs/drex/reference/limits) before another run.
