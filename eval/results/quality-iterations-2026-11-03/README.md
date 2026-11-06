# Quality iterations: public-training experiments, 2026-11-03

Status: complete through Round 4. **The quality targets remain unmet. No production promotion or deployment occurred. Locked-holdout labels were not parsed by the archive/analysis workflow.**

The archive preserves **10,797 physical provider calls and 17,288 head observations across 22 runs**. Every request completed without error/exclusion. Multiple heads share one physical request and are not independent examples. The strongest frozen scalar refutation policy reaches 44/59 validation positives with zero false positives (74.6% recall); the final fusion reaches 43/59 (72.9%). Its broader negative policy clears 131/141 negatives but falsely clears five positives. Neither meets 95% precision / 90% recall / 85% negative coverage jointly. Validation is a repeatedly inspected development monitor, not fresh release evidence.

## Inputs and separation

The inputs come from cached official **training** data, with original native labels and rationale sets unchanged. This is separate from the previously examined 399 public dev pairs and AI-authored diagnostic cases. Full-dev Wikipedia pages/revisions and SciFact evidence-document connected components were excluded before selecting new data. Exact normalized text-pair duplicates, including reversed roles and cross-dataset duplicates, join components. Whole components containing service-envelope violations are excluded; text is never truncated.

| Role           |                 Pairs | Components | Use                                                      |
| -------------- | --------------------: | ---------: | -------------------------------------------------------- |
| Screen         |  160 (80 per dataset) |         38 | Candidate/prompt optimization; subset of fit             |
| Fit            | 400 (200 per dataset) |         90 | Threshold and model fitting                              |
| Validation     | 200 (100 per dataset) |         56 | Completed frozen-policy evaluation                       |
| Locked holdout | 200 (100 per dataset) |         42 | Preserved unopened as gold; final authorization required |

Fit/validation/holdout components are disjoint. Round 4 later extends fit to 800 pairs (400 per dataset, 168 components), preserving all original 400 pairs exactly and adding 400 pairs in 78 components; original validation and locked components remain excluded. The extra-only manifest has a documented metadata erratum described below. Screen overlaps fit intentionally and is not an additional independent sample. Source selection is label-blind, seeded and bounded by whole-component size; it is not a uniform population sample. Original split stays `train`. The workflow holdout is not an official benchmark test, proof of unseen-to-model data, or the independently human-adjudicated release corpus. Source licenses, upstream revisions, archive/member hashes, filters, role hashes and preparer hash are retained in the exact manifests and `inputs/source-lock.json`.

The locked manifest is archived as raw compressed bytes with its original SHA; it is not JSON-parsed or label-summarized by the default reproducer. These are workflow access rules, not cryptographic secrecy. The human 500 / locked 200 service-contract gate remains unmet. The [local label-provenance audit](../../../docs/evaluations/trusted-pair-label-audit.md) found no inspected human-confirmed true-pair corpus; aggregate admission truth and model-validator agreement are not promoted to human gold.

## Actual runs

| Run           | Profiles | Input cases | Calls | Purpose                                          |
| ------------- | -------: | ----------: | ----: | ------------------------------------------------ |
| R1 screen     |        6 |         160 |   960 | Training-only formulation screen                 |
| R2 screen     |        4 |         160 |   640 | Three new formulations and repeated rich control |
| R2 fit        |        9 |         400 | 3,600 | Matched features for scalar/fusion fitting       |
| R2 validation |        9 |         200 | 1,800 | Independent source-component validation          |

These runs use pinned Jev `jev-1.14.0`, isolated requests per candidate/case, maximum concurrency two, a 3,000 ms direct evaluation deadline, no retry/fallback and no truncation. Each has its own pre-dispatch source snapshot and input fingerprint. Source changes between rounds remain distinct; no comparison is described as a pure causal wording effect. This is not deployed-service latency or capacity qualification.

R1 compares rich control, local mini, literal-contract, three-way NLI, conflict Noul, and semantic/numeric signals. R2 adds role alignment, evidence-refutation Noul with a negative-only determinability gate, and revised numeric composition. Exact formulations are in each run's source snapshot. All contrast examples are invented; native labels were not silently rewritten.

### Screening and composition

| R2 candidate          | Default TP / FP | Precision | Recall | Native-negative coverage | Best training recall at ≥95% precision with actual gates |
| --------------------- | --------------: | --------: | -----: | -----------------------: | -------------------------------------------------------: |
| Repeated rich control |          27 / 3 |     90.0% |  54.0% |                    76.4% |                                                      16% |
| Aligned roles         |          27 / 2 |     93.1% |  54.0% |                    73.6% |                                                      44% |
| Evidence refutation   |          18 / 1 |     94.7% |  36.0% |                    64.5% |                                                      56% |
| Semantic/numeric v2   |          18 / 4 |     81.8% |  36.0% |                    67.3% |                                                      30% |

The numeric-v2 **ungated** scalar frontier has 50% recall at 95% precision; its actual quantitative composition has 30%. These are different diagnostics. The recorded 0.8 decisions and frozen-policy evaluation retain numeric overrides/vetoes and negative-only determinability gates. They are not substituted with a plain contradiction-score threshold.

The repeated rich control has identical payload hashes on 160/160 cases, yet six verdicts and 69 contradiction scores change between rounds. Its net default counts stay the same. Small paired prompt differences must be considered alongside that observed provider variation; no cause or statistical significance follows from two passes.

Simple nine-head score/rank pooling did not improve the best screen frontier: mean conflict reaches 50% recall at ≥95% precision, median conflict 44%, mean midrank 46%, median midrank 42%. These are retrospective training scores, not calibrated probabilities or frozen validated policies. The separate diagnostic script preserves this distinction.

### Fit and frozen validation

Fit has 116 native positives and 284 negatives; validation has 59 and 141. At defaults, fit NLI achieves 69 TP/8 FP (89.6% precision, 59.5% recall) and 89.4% negative coverage. No default head passes all targets.

Scalar fitting maximizes training recall at ≥95% point precision and constrains training false clears to zero. This often disables negatives entirely; its strictness is visible rather than presented as passing the negative-coverage target. On frozen validation, all nine scalar policies have zero FP, but recalls range from 5.1% to 33.9%; the strongest scalar recalls are NLI and conflict Noul at 20/59 positives. Their native-negative coverage is 0% and 18.4% respectively. No scalar qualifies.

The logistic model uses all nine matched feature heads, fixed L2=1 and no dataset-ID feature. Weights, scaling, exact feature order, group-separated inner fit/check and both selected policies are archived. These are fitted binary estimates; independent probability calibration is not claimed.

| Frozen fusion policy       | Validation TP / FP | Precision | Recall | Clear native negatives | False clears |   NPV |
| -------------------------- | -----------------: | --------: | -----: | ---------------------: | -----------: | ----: |
| Zero-training-false-clears |             17 / 0 |      100% |  28.8% |         40/141 = 28.4% |            1 | 97.6% |
| Training NPV≥95%           |             17 / 0 |      100% |  28.8% |        131/141 = 92.9% |            7 | 94.9% |

The precision denominator is only seventeen, with a 95% Wilson lower bound around 81.6%; “100%” is not a reliability guarantee. Validation AUROC is 0.9537 and Brier 0.0618 for the fitted score. Inner group-check AUROC is 0.8420 versus 0.9516 on full fitting data, so all folds are retained rather than reporting only the attractive training result. Negative policies selected on training do not guarantee their training constraints on validation.

Native binary negatives include upstream SUPPORT/NOT ENOUGH INFO categories; their coverage is not independently adjudicated permission to clear service assertions. Some inspected source cases have native/literal-contract tensions; see the [diagnosis](../../../docs/evaluations/profile-regression-diagnosis.md). No corpus label-noise rate or new human gold is asserted.

## Round 3: actual bundled inference and provider challengers

The pre-inference `round-three-protocol.json` specifies fresh, physical multi-head calls rather than reuse of isolated scores. Jev receives five heads in one request; Clef and Decider receive NLI plus evidence-refutation in one request. The inference source fingerprint now includes compiler mode, provider/backend and requested model. Frozen models must match that fingerprint. The independent reproducer verifies this binding, source bytes, checkpoint rows, actual request attribution and logistic predictions. It reproduces the numeric-compatible veto only for source versions that contain it; earlier composition remains separate.

| R3 run                                             | Physical requests | Head observations |
| -------------------------------------------------- | ----------------: | ----------------: |
| Jev five-head fit, 400 cases                       |               400 |             2,000 |
| Jev five-head validation, 200 cases                |               200 |             1,000 |
| Clef two-head synthetic probe / training screen    |           8 / 160 |          16 / 320 |
| Decider two-head synthetic probe / training screen |           8 / 160 |          16 / 320 |
| Decider two-head fit / validation                  |         400 / 200 |         800 / 400 |
| Jev five-head synthetic contract                   |                32 |               160 |
| R3 total                                           |             1,568 |             5,032 |

All R3 requests complete without errors/exclusions. The per-process limit is two; a cross-process overlap violated the intended global-two protocol, disclosed below. The probe is the existing eight-case **synthetic** smoke manifest, not public performance evidence. Models are pinned `jev-1.14.0`, full Cloudflare `clef`, and Perplexity-only `perplexity/pplx-decider-v1.2` (returned revision `perplexity/pplx-decider-v1.2-20261016`). No retry/fallback or production deployment occurs. Each head's checkpoint has the shared bundle hash/usage; request usage is counted once per run/request, not once per head.

### Bundled Jev, frozen-policy evaluation

Training group cross-validation selects L2=10 from the preregistered grid [1, 10, 100] by minimum out-of-fold log loss. The positive threshold **0.9481854856144606** and two negative thresholds come from training out-of-fold scores; validation does not select thresholds. Out-of-fold training precision is 15/15, but recall is only 15/116 = 12.9%.

| R3 frozen fusion policy | Validation TP / FP | Precision | Recall | Clear native negatives | False clears |   NPV |
| ----------------------- | -----------------: | --------: | -----: | ---------------------: | -----------: | ----: |
| Zero-OOF-false-clears   |              3 / 0 |      100% |   5.1% |         36/141 = 25.5% |            0 |  100% |
| OOF NPV≥95%             |              3 / 0 |      100% |   5.1% |        117/141 = 83.0% |            6 | 95.1% |

All six false clears under the broader policy are VitaminC native positives. The precision denominator is three, with Wilson lower bound 43.9%; no reliable 95% precision claim follows. Frozen score AUROC is 0.9495, average precision 0.9336 and Brier 0.06754. The ranking and very conservative operating point are different facts. No threshold is adjusted from these validation observations.

At fixed defaults on the same validation inputs, the bundled NLI head finds 32/59 contradictions with zero FP (54.2% recall), clears 138/141 negatives, and falsely clears 13 positives. Literal-contract finds 30/59 with zero FP (50.8% recall), clears 123/141 negatives, and falsely clears six positives. Neither meets recall. These head diagnostics are not the selected frozen fusion's metrics.

This is the same source-separated validation manifest already evaluated in Round 2; after repeated inspection it is a development monitor, not new untouched release evidence. Bundling, source changes, regularization selection and provider variation differ from prior rounds, so a pure causal improvement/regression claim is not established.

### Clef and Decider training screen

| Provider / head    | Default TP / FP | Recall | Native negatives cleared | Positive false clears | Retrospective training TP / FP at ≥95% precision |
| ------------------ | --------------: | -----: | -----------------------: | --------------------: | -----------------------------------------------: |
| Clef NLI           |           8 / 0 |    16% |                  101/110 |                    19 |                              21 / 1 (42% recall) |
| Clef refutation    |          12 / 3 |    24% |                   46/110 |                     4 |                              10 / 0 (20% recall) |
| Decider NLI        |          19 / 0 |    38% |                  101/110 |                    10 |                              24 / 1 (48% recall) |
| Decider refutation |          20 / 0 |    40% |                   81/110 |                     8 |                              27 / 1 (54% recall) |

The fitted screen points retain their actual composition/negative gates and are training diagnostics, not independent validation or proof of target attainability. They do not qualify any model. Subsequent provider fitting/validation must append separate run identities rather than replacing these results.

### Decider bundled fit and frozen validation

After the screen, a separately frozen two-head Decider fit uses 400 cases and validation uses the same 200-case development monitor. Group cross-validation selects L2=1. The OOF-selected positive threshold is 0.9215406245770164; training OOF has 38 TP / 2 FP (95% precision, 32.8% recall). This is a separate provider-specific fit, not reuse of the Jev fusion's parameters.

| Frozen Decider fusion policy | Validation TP / FP | Recall | Clear native negatives | False clears |   NPV |
| ---------------------------- | -----------------: | -----: | ---------------------: | -----------: | ----: |
| Zero-OOF-false-clears        |             24 / 0 |  40.7% |         71/141 = 50.4% |            0 |  100% |
| OOF NPV≥95%                  |             24 / 0 |  40.7% |        126/141 = 89.4% |            4 | 96.9% |

Both have 100% point precision on 24 positive decisions (Wilson lower bound 86.2%), AUROC 0.9768 and Brier 0.04821. The broader policy falsely clears one SciFact and three VitaminC positives. Recall remains below target. Default refutation finds 35/59 positives with zero FP (59.3% recall), clears 113/141 negatives (80.1%) and falsely clears five positives. Default NLI finds 32/59 with zero FP (54.2%), clears 135/141 negatives and falsely clears six positives. No model is promoted, and validation is not retuned.

### Synthetic contract diagnostics

The separate 32-case Jev bundle is a synthetic fixture diagnostic, not public benchmark accuracy or human gold. Its four expected-uncertain cases are excluded from binary precision/recall/negative-coverage/calibration denominators, leaving 12 contradictions and 16 clear negatives. They remain in all 32 completion and expected-verdict diagnostics.

| Jev head            | Expected-verdict accuracy, all 32 | Binary TP / FP | Clear negatives, of 16 |
| ------------------- | --------------------------------: | -------------: | ---------------------: |
| Literal contract    |                             30/32 |         12 / 0 |                     15 |
| NLI                 |                             27/32 |         12 / 1 |                     15 |
| Conflict Noul       |                             27/32 |         12 / 0 |                     15 |
| Semantic/numeric v2 |                             19/32 |          8 / 1 |                      9 |
| Evidence refutation |                             29/32 |         12 / 0 |                     13 |

The independently rebuilt summary checks both binary exclusions and all-case expected-verdict counts. These authored examples do not establish generalization or a human qualification gate.

### Public regressions and fresh balanced baseline

The original public-dev 399 pairs are also run through fresh Jev five-head and Decider two-head bundles, plus ordinary balanced-v1 Jev. This adds 1,197 physical requests; the separate Decider 32 synthetic contract adds 32. The operator launcher awaits each CLI sequentially. Exact public manifests, sources/licenses and all checkpoints are preserved. The ordinary baseline CLI records report/checkpoint protocol but **has no separate inference-source freeze**; nearby bundled source snapshots are not retroactively substituted as one.

| Public-dev dataset         | Fresh balanced TP / FP; precision / recall | Jev literal TP / FP; precision / recall | Decider refutation TP / FP; precision / recall |
| -------------------------- | -----------------------------------------: | --------------------------------------: | ---------------------------------------------: |
| SciFact 199, 71 positives  |                      33 / 2; 94.3% / 46.5% |                   40 / 2; 95.2% / 56.3% |                          28 / 2; 93.3% / 39.4% |
| VitaminC 200, 71 positives |                      29 / 3; 90.6% / 40.8% |                   33 / 4; 89.2% / 46.5% |                          34 / 2; 94.4% / 47.9% |

The recorded baseline-request check confirms unchanged manifest and payload hashes on 200/200 VitaminC and 199/199 SciFact pairs versus the archived original balanced run. Compiler equality does not imply identical returned scores. These are paired development observations with different formulations/policies, not an untuned-default fairness or statistically significant improvement claim. Balanced-v1 requires one negative label individually ≥0.8; iteration composition can pool compatible/scope mass, so negative coverage must retain that distinction. The public data was already inspected and is not locked test data.

Decider's 32-case synthetic contract expected-verdict accuracy is 26/32 for both NLI and refutation; four uncertain cases remain excluded from binary denominators. Failed Boost experiments used existing scores only (no extra provider calls). Both frozen Boost variants recover zero validation positives; their exact implementation, CLI, test and four model/evaluation reports are archived, with independent tree-algebra reproduction. The failed prototype was then removed from the maintained runtime surface.

## Round 4: larger training set, frozen scalar and fusion

The pre-inference protocol raises the cumulative physical-call cap from 10,000 to 11,000 and reservation cap to $11 before the new 1,000 calls. One live CLI runs at a time. Decider uses the same two-head formulations, with a fresh 800-case fit call set followed by 200 validation requests. It does not merge earlier provider responses into the enlarged training matrix.

All original 400 fit pairs remain unchanged in the 800; extra components exclude original fit/validation/locked hashes, full public-dev source closure, envelope-unsafe components and normalized unordered content duplicates. All cached source hashes match. The allowed fit 800 contains SciFact 141 contradiction / 259 support and VitaminC 114 REFUTES / 200 SUPPORTS / 86 NOT ENOUGH INFO. Locked labels are not opened. There are no selected cross-dataset components in this 800-case set.

A reviewed grouping fix makes canonical prepared component IDs global across datasets and checks reversed content at evaluation boundaries. R1–R3 used dataset-prefixed group keys; no cross-dataset component was found in the original selected fit 400 or validation 200, but changing group strings changes hashed fold assignments. The independent verifier uses each frozen source version's group semantics and checks model training groups, group hashes and OOF membership. It does not refit historical models under current helpers.

| Frozen policy                 | Validation TP / FP | Precision | Recall | Clear native negatives | False clears |   NPV |
| ----------------------------- | -----------------: | --------: | -----: | ---------------------: | -----------: | ----: |
| Scalar refutation             |             44 / 0 |      100% |  74.6% |           58/141=41.1% |            0 |  100% |
| Scalar NLI                    |             35 / 0 |      100% |  59.3% |           71/141=50.4% |            0 |  100% |
| Fusion, zero-OOF-false-clears |             43 / 0 |      100% |  72.9% |           70/141=49.6% |            0 |  100% |
| Fusion, OOF NPV≥95%           |             43 / 0 |      100% |  72.9% |          131/141=92.9% |            5 | 96.3% |

Fusion selects L2=1 from training group-CV. Its positive cutoff is 0.8427687037468214; negative cuts are 0.020007743622934233 and 0.3202170233127597. Frozen validation AUROC is 0.98341, average precision 0.97028 and Brier 0.045904. The broader policy's negative coverage clears the point target while its positive recall fails. Forty-three zero-FP decisions have a 95% Wilson lower precision bound around 91.8%, not a population guarantee.

Scalar refutation's training-selected cutoff changes from 0.8512423108641396 to 0.7173701175979491; frozen validation recall rises from 33/59=55.9% to 44/59=74.6%. Its default 0.8 point remains 35 TP/0 FP (59.3% recall), with 3 false clears in the fresh pass. Training size, fitting data, source version, fold identity/seed and observed provider variation differ, so this is not a pure causal training-size effect. No threshold is selected from validation and no locked evaluation is triggered.

## Execution deviations and artifact limits

The Jev 32 contract checkpoint envelope (2026-11-04 06:56:16.199468–06:56:17.615747 UTC) overlaps Decider validation's envelope (06:56:14.407898–06:56:49.334970 UTC) by **1.416279 seconds**. It does not overlap Decider fit. Both CLIs permit two requests independently, so configured aggregate capacity is four during this overlap, inconsistent with the intended global-two cap. Individual wall-clock dispatch/completion timestamps were not recorded; exact peak simultaneous network requests cannot be reconstructed. `concurrency-deviation.json` preserves observed local filesystem timestamps and source hashes. These runs are not global-two capacity qualification. Later public regressions and R4 await one CLI at a time.

The original preparer's SHA 07dfdd7f651063d4430d0c54161258ad3d8e9b09c7e5041685381270486c0ef7 is recorded, but its exact pre-refactor source bytes were not preserved. The archive distinguishes that limitation from the exact inference-source snapshots and generated manifests it does preserve. Refactored shared-preparation/extension source versions are archived after generation; all cached source hashes and exact preservation of original 400 pairs were checked. No guessed historical source reconstruction is substituted.

The extra-only 400 manifest incorrectly records `screen_subset_of_fit:true` despite containing 0/160 screen pairs. The combined 800 manifest's corresponding flag is correct and was the actual R4 input. The measured bytes remain unchanged; `extension-metadata-erratum.json` corrects interpretation and the future generator is fixed. A separate local appender variable-shadow incident briefly overwrote the unused extra-only input; its original 6a962e… bytes were restored from the compressed archive and independently verified. Combined 800 input and inference runtime were unaffected. The fix, recovery and hashes are recorded in `archive-appender-incident.json`.

## Cost and denominators

Through R4, usage is **10,496,544 input tokens and 692,666 reported output tokens**. Output counts are unknown for 399 ordinary-baseline requests; the output figure is a reported subtotal, not an imputed total. All input usage is reported. Deduplicate by run identity plus request ID: 10,797 deduplicated physical requests use only 3,999 distinct bare request IDs. Repeated cases, multiple heads and rationales are not independent new examples.

| Provider                  | Physical requests | Input tokens |         Reported output tokens |
| ------------------------- | ----------------: | -----------: | -----------------------------: |
| Jev (all archived rounds) |             8,430 |    8,287,861 | 686,069 (399 requests unknown) |
| Clef                      |               168 |      172,650 |                     0 reported |
| Decider                   |             2,199 |    2,036,033 |                          6,597 |

At the operator-verified Jev list rate of $0.042 per million input tokens, the **Jev-only** input estimate is **$0.348090162**. The reproducer does not apply that rate to other providers; aggregate cross-provider price and actual billed cost are unknown. Reservations are execution caps, not measured charges. Per-run JSON retains latency, failures and confidence intervals; direct client timing is not a hosted-service SLA or cross-provider capacity result.

## Archive and offline reproduction

`artifact-sha256.json` records exact original and stored SHA/size for every measured artifact. JSON and JSONL are compressed with an empty gzip filename and `mtime=0`; existing source snapshots remain byte-exact. No historical model archive is rewritten.

- `protocols/`: exact pre-inference iteration protocols.
- `inputs/`: original role manifests, enlarged/extra fit manifests, public-dev manifests, synthetic fixtures and source/component locks. Locked gold is byte-preserved, not parsed by default.
- `runs/RUN/`: report, freeze, incremental checkpoint, checkpoint metadata and complete inference-source snapshot for each run.
- `ordinary/`: fresh balanced-baseline report/Markdown/checkpoint/metadata, with no invented source freeze.
- `derived/`: exact scalar/fusion/failed-Boost models, screening diagnostics and frozen evaluation results.
- `execution-audits/`: concurrency evidence, metadata erratum and restored-input incident record.
- `orchestration/`: exact operator launcher source archived as text, outside the evaluator source graph.
- `fitting-source/`: supporting fitting implementations captured after fitting/evaluation. Changed versions have distinct content-hash suffixes; per-run inference snapshots remain authoritative. These post-fit captures are not misrepresented as pre-inference freezes.
- `aggregate.py`: standard-library independent verification of source snapshots, checkpoint attribution, recorded composition, scalar policy predictions, versioned group/OOF bindings, logistic and Boost algebra, default/frozen AUROC/AP/Brier; writes compact JSON/CSV.
- `archive.py`: explicit local append tool. It makes no network/model calls and refuses changed existing measured bytes. Locked evaluation output requires a separate explicit flag after authorization.

```sh
python3 eval/results/quality-iterations-2026-11-03/aggregate.py
```

The default reproducer does not open locked labels, fit a model, tune a threshold, or call a provider. It verifies all stored/original hashes and reconstructs the currently archived completed results. Further authorized rounds must keep their execution mode/backend, source versions, models and data roles separate. The final archive contains 171 inventoried exact-byte artifacts; no stage establishes the requested three quality targets or production qualification.
