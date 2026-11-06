# Profile regression diagnosis and next experiment

Status: offline diagnosis and leakage-separated preparation, 2026-11-03. No inference, credentials, dependencies, production changes or deployment. Archived measured results remain immutable. The accompanying analysis is reproducible with `python3 eval/analysis/profile-regression-diagnosis.py`; its JSON pins all fifteen report inputs. Representative text reviews below are AI diagnostic observations, **not new human adjudication**.

The evidence supports restoring the richer semantic formulation and separating its judgment from optional numeric selection. It does not establish a Jev capacity ceiling. Numeric extraction completeness vetoes useful semantic decisions; the compact semantic profile also loses ranking quality relative to the earlier rich rubric. Changing thresholds alone cannot meet the three targets on the saved native-label scores.

## What changed and what was lost

The earlier rich arm placed structured `means/includes/excludes` definitions in each Choice criterion, retained the complete policy in structured question instructions, and optionally attached examples to the relevant criterion. `semantic-v2` instead moves a compressed rubric/examples into shared state, shortens the criteria and policy, changes the task wording, and puts the comparison inside question instructions. That is several changes together, not a controlled test of private comparison placement or examples alone.

| Previously examined dataset | Earlier rich rubric, first pass | Compact semantic | Paired positive changes | False-positive changes |
| --------------------------- | ------------------------------: | ---------------: | ----------------------- | ---------------------- |
| SciFact, 71 positives       |                    38 TP / 2 FP |     28 TP / 2 FP | 10 lost, none recovered | none                   |
| VitaminC, 71 positives      |                    28 TP / 2 FP |     27 TP / 2 FP | 3 lost, 2 recovered     | none                   |

Earlier rich SciFact recall ranges 53.5–54.9% across its three passes at the unchanged 0.8 cutoff; compact semantic gets 39.4%. Earlier rich+examples attains 32/32 on the invented contract fixture in all three passes, versus compact semantic 28/32. This is evidence against assuming the compact shared-state rewrite preserved the rich arm's benefit. Provider variation and simultaneous representation changes prevent assigning the whole loss to one cause. The [independent error audit](profile-regression-independent-audit.md) enumerates the broader saved error union and contract boundaries.

Representative SciFact rich → compact contradiction scores:

| Frozen pair                  | Rich → compact | Diagnostic boundary                                                             |
| ---------------------------- | -------------: | ------------------------------------------------------------------------------- |
| `scifact:dev:903:10648422:1` |      .95 → .59 | Claim says PD-1 reduces IL-10; evidence describes upregulation/production.      |
| `scifact:dev:743:32159283:0` |      .93 → .76 | Protective effect versus no effect.                                             |
| `scifact:dev:274:11614737:0` |      .91 → .74 | Claimed statistical significance versus reported confidence intervals/P values. |

Do not paste these already examined development pairs into a supposedly independent test or use them as unmarked training examples. They identify failure slices; new optimization examples should come from the reserved training role or be explicitly invented.

## The numeric gate is the largest directly measurable veto

The reviewed structured lane marks 170/200 VitaminC and 130/199 SciFact pairs as incomplete candidate coverage. Its final public decisions are VitaminC 0 TP/1 FP/10 clear TN and SciFact 8 TP/0 FP/8 clear TN. The table counts high-confidence semantic labels that the code vetoes on incomplete extraction; it does not claim those labels would remain identical under a different prompt.

| Dataset  | Native-positive cases with incomplete extraction | Native-negative cases with incomplete extraction | Otherwise-positive TP vetoed | Clear TN vetoed | FP also blocked | Native-positive false clears also blocked |
| -------- | -----------------------------------------------: | -----------------------------------------------: | ---------------------------: | --------------: | --------------: | ----------------------------------------: |
| VitaminC |                                            62/71 |                                          108/129 |                           14 |              48 |               1 |                                         3 |
| SciFact  |                                            44/71 |                                           86/128 |                           10 |              29 |               1 |                                         0 |

A counterfactual applying the existing semantic threshold directly to the **same mixed-choice output** gives VitaminC 14 TP/2 FP/58 TN (87.5% precision, 19.7% recall) and SciFact 18 TP/1 FP/37 TN (94.7%, 25.4%). That remains far from the targets. It is not a safe deployed composition, a new independent semantic response, or permission to guess arithmetic when parsing fails.

The veto also catches numeric-looking identifiers unrelated to arithmetic. For `scifact:dev:1130:17997584:0`, the αvβ8/Treg comparison has raw contradiction .93, but both sides receive unsupported-span counts and the final verdict is uncertain. The CX3CR1/Th2 case `216:21366394:0` similarly has .92 contradiction and multiple unsupported spans. Statistical context, sample sizes and incidental identifiers must not automatically make a directional biological claim a numeric comparison.

The invented contract fixture demonstrates the same issue: clear contradictory four/six-day shipment statements, distinct exact participant counts and distinct exact prices are vetoed. Reviewed structured gets 17/32 exact expected verdicts. All four expected-uncertain rows remain outside binary precision/recall and probability metrics.

## Mixed Choice outcomes are a design problem, but mass dilution is not the main observed explanation

A candidate-pair selection and a whole-pair semantic relation can both be valid. Encoding them as competing outcomes in one Choice makes the meanings overlap and the option distribution depend on candidate availability. However, the actual reviewed data are more restrictive:

- All 200 VitaminC questions expose **zero** numeric-pair options.
- 198/199 SciFact questions expose zero; one exposes one candidate option with total mass .12. Mean numeric-option mass is .000603 across SciFact and zero across VitaminC.
- No reviewed row selects a numeric pair. Adding numeric-option mass to contradiction mass rescues **zero** positive decisions at 0.8.

Thus candidate-option dilution is an architectural concern, not the demonstrated principal cause of this regression. The extra `unknown` option and extraction-oriented wording also change the semantic task even when no candidates exist. Use an independent rich relation judgment; ask a separate candidate selection only when useful, and ignore uncertainty in an unused branch. Preserve candidate confidence and deterministic interval evidence separately, without presenting them as calibrated whole-verdict probabilities.

This follows the live TypeSafe guidance: a [Choice](https://docs.typesafe.ai/primitives/choice) compares competing alternatives, whereas [structured criteria](https://docs.typesafe.ai/primitives/advanced) can retain definitions and exclusions at their relevant options. The [value-extraction cookbook](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook) separates broad candidate discovery, semantic selection and exact code normalization. [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out) supports independent questions in one request and consuming only relevant branches. These are design directions, not guaranteed quality or latency results for this workload.

## Scope and native-label mismatch must stay visible

Some saved native errors are informative without being a sound instruction to change the literal contract:

| Frozen pair                                        | Native observation                       | Diagnostic issue requiring separate contract review                                                        |
| -------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `scifact:dev:593:19675911:0`                       | SUPPORT, model contradiction .97         | “Decreased by 10%” versus “did not change over time”; supplied population/time/context needs adjudication. |
| `scifact:dev:1385:306006:0`                        | SUPPORT, model contradiction .81         | Enhancing weak-ligand signaling versus reduced stimulatory capacity; apparent literal opposition.          |
| `vitaminc:combined:dev:5ee393b6c9e77c0008ccbff0_3` | REFUTES, model clear negative            | “More than 4,290” versus “more than 4,200” are compatible lower bounds.                                    |
| `vitaminc:combined:dev:5ee393b6c9e77c0008ccb918_2` | NOT ENOUGH INFO, model contradiction .95 | “Before April 21” versus “by April 21”, approximate counts and temporal endpoints.                         |
| `vitaminc:combined:dev:5ee3932dc9e77c0008ccb615_1` | NOT ENOUGH INFO, model contradiction .88 | Assertion versus “not thought to be” attribution/epistemic status.                                         |

These are diagnostic interpretations, not an estimated label-noise rate or a complete human correction set. Preserve native labels, report their task separately, and add service-contract labels only with explicit annotation provenance. A benchmark-specific NLI arm may test native evidence/refutation instructions, but it must not be silently shipped as the service's different literal-compatibility contract.

Synthetic errors also motivate narrow boundary examples: compact semantic contradicts an explicitly unresolved two-service referent (`31`), clears an illegible pass/fail result (`29`), and abstains on rule-versus-observed-violation (`17`). The example already appearing somewhere in state does not prove it was applied. Missing decisive meaning differs from omitted corroboration or unfamiliar biomedical names.

## The saved attainable frontier

These are optimistic retrospective score sweeps on **already examined** labels. Equal scores enter together. They are not heldout tuned thresholds, probability-calibration guarantees, or evidence that new semantic signals cannot improve ranking.

| Dataset / saved score                     |         Maximum recall at precision ≥95% | Best precision at recall ≥90% |
| ----------------------------------------- | ---------------------------------------: | ----------------------------: |
| SciFact, earlier rich first pass          | 62 TP/3 FP = 87.3% recall, threshold .27 |  65 TP/4 FP = 94.2% precision |
| SciFact, earlier rich across three passes |        62–63 TP/3 FP = 87.3–88.7% recall |  65 TP/4 FP = 94.2% precision |
| SciFact, compact semantic                 |                40 TP/2 FP = 56.3% recall | 64 TP/16 FP = 80.0% precision |
| VitaminC, earlier rich first pass         |                26 TP/1 FP = 36.6% recall | 64 TP/34 FP = 65.3% precision |
| VitaminC, compact semantic                |                21 TP/1 FP = 29.6% recall | 68 TP/95 FP = 41.7% precision |

No saved scalar contradiction-score track in this analysis meets 95% precision and 90% recall simultaneously. Structured diagnostic option mass is explicitly not treated as a verdict probability. At 71 native positives, 90% recall requires at least **64 TP**; achieving 95% precision with 64–71 TP allows at most **three FP**. Clear-negative coverage of 85% additionally needs **110/129** VitaminC negatives and **109/128** SciFact negatives cleared. A positive-only threshold change cannot repair a degraded score ordering or demonstrate the negative-coverage target.

## Controlled next variants

The next experiment should preserve a known rich control and change one representation boundary at a time. The active evaluation-only candidate IDs currently include `rich-control`, `local-mini`, `literal-contract`, `nli-three-way`, `noul-conflict` and `semantic-numeric`; none is a qualified production change.

1. **Restore-rich control.** Preserve the frozen rich criteria/examples representation and full policy. This checks whether its earlier ranking advantage repeats on fresh optimization groups. A compact state rewrite is a separate arm, not a substitute for this control.
2. **Literal boundary refinement.** Distinguish changed property values from explicitly different entities/time, missing decisive context from lack of corroboration, and epistemic/quoted status from bare fact. Use invented contrasts or training-only examples; keep their origin explicit.
3. **Native NLI diagnostic.** Ask evidence supports/refutes/insufficient, report as a separate native benchmark task. Compare with the literal arm rather than relabel either target.
4. **Independent semantic/numeric signals.** Always retain an independent relation question. A separate quantitative-decisiveness signal identifies whether unresolved values actually matter; candidate selection and code arithmetic are optional. Missing numeric candidates cannot veto a nonnumeric relation merely because a gene identifier contains digits. Numeric overlap never establishes whole-pair consistency.
5. **Noul alternatives and dev composition.** Separate conflict/applicability signals and fit only on the training/fit role. Do not install another universal determinability gate: the prior dual-Noul saved-output diagnostic already suppresses useful positives. [Noul](https://docs.typesafe.ai/primitives/noul) provides a yes/no probability, not another confidence field; combine signals empirically without assuming independence or multiplying marginals into a claimed verdict probability.

Predeclare failure slices: directional/negated effects; identifier digits versus decisive quantities; exact numeric disagreement; compatible bounds; statistical significance; explicit temporal/population scope; missing referents; epistemic/quoted assertions; rule versus violation; omission and native NOT ENOUGH INFO. Slice tags are derived diagnostics, not replacement gold. Report positive misses and false clears, not just aggregate F1.

## Fresh public-train protocol and prepared artifacts

The cached VitaminC training member contains 370,653 rows in 74,414 revision groups. It shares no revision group with the full official dev set, but shares seventeen Wikipedia pages (298 rows before connected-component expansion). SciFact train has 809 claims, 505 labeled claims and 957 complete rationale-set pairs; 110 evidence documents overlap the full dev set, affecting 166 training claims. Excluding individual claims alone leaves 339 labeled claims/656 rationale pairs, but the implemented connected-component exclusion is stricter.

`eval/iteration/prepare.ts` prepares from cached archive bytes only, with no downloads or inference. It:

- excludes source components touching **any** full-dev Wikipedia page/revision or SciFact annotated evidence document;
- joins SciFact claim/document connected components, retaining every complete rationale set rather than inventing negatives for other docs;
- joins exact NFKC/case/whitespace-normalized text-pair duplicates across datasets, including swapped text roles;
- rejects entire source components containing service-envelope-unsafe pairs, without truncating;
- allocates locked and validation components before fit, using seeded component hashes and **no native-label selection**; selects screen as a complete-component subset of fit.

Actual preparation excludes 334 VitaminC and 303 SciFact pairs through seen-source components, plus 502 VitaminC pairs through envelope-unsafe components. It records two normalized-duplicate component joins. Large components may be skipped to respect per-dataset sample caps; this is a label-blind diagnostic sample, not a population-representative estimate.

| Role                            |                Pairs | Source/content components | Intended access                                 |
| ------------------------------- | -------------------: | ------------------------: | ----------------------------------------------- |
| `iteration-screen.json`         | 160: 80 each dataset |                        38 | Prompt/candidate screening; subset of fit       |
| `iteration-fit.json`            |        400: 200 each |                        90 | Composition/calibration and prompt optimization |
| `iteration-validation.json`     |        200: 100 each |                        56 | Separate validation; not threshold fitting      |
| `iteration-locked-holdout.json` |        200: 100 each |                        42 | Final frozen-candidate/policy evaluation only   |

Fit, validation and holdout components are disjoint. Screen/fit membership intentionally overlaps, so do not count screen rows again as independent fit evidence. Original split remains **train** in every pair; the locked role is an experiment-heldout training subset, not the official public test split and not the human 200-pair release corpus. The source may have appeared in provider pretraining; unseen-to-model is not claimed. The preparer copies and validates native labels mechanically but does not use them to assign roles; holdout label statistics are omitted and were not manually inspected for this preparation.

Exact hashes, source/archive/member hashes, role/component lists and preparer hash are in `eval/data/iteration-index.json`. Screen SHA is `0fe13090664631f45733eb66e719b020f8d32895e5687ad6b863d8670d03549e`. Reproduction uses a fresh output prefix:

```sh
pnpm exec tsx eval/iteration/prepare.ts --prefix eval/data/iteration-reproduction --seed iteration-train-v1
```

Canonical manifests retain `purpose=development` to preserve their original public-train provenance; `iteration_protocol.role` supplies the separate workflow role. The iteration runner must reject tuning on validation/locked roles and reject any locked evaluation until the selected profile and policy are frozen. Files are locally readable, so this is a workflow guard, not cryptographic sealing. Do not inspect holdout examples/labels, search seeds for performance, or reuse old dev as new validation. Freeze sources/profiles/input hashes before calls; reserve all candidate × pair × pass calls, checkpoint each completion, and treat malformed/timeout output as missing useful execution.

After screen, advance a predeclared small number of candidates, fit thresholds/composition on fit only, and evaluate the fixed choices on validation. Adaptive validation-driven edits consume validation for optimization; reserve the locked set for one final frozen evaluation. Report native results separately per dataset and all expected-uncertain contract diagnostics separately. Even a passing native workflow holdout leaves the independently human-adjudicated 500 / locked 200 service-contract and production operational gates unmet.

## Checks

The preparer passed TypeScript, targeted ESLint and formatting. Actual role hashes, component disjointness and screen containment were checked without exposing holdout label statistics. The diagnostic Python script rebuilds all retrospective score frontiers, gate counts and paired changes without model calls. The preparation source was declared static before the parent orchestrator's inference freeze; subsequent model runs and their interpretation belong to separate measured artifacts.

## Round 1 training screen: new evidence for Round 2

The first new-source screen completed 960 calls (six candidates × 160 training cases), with stable execution sources and zero errors/exclusions. It contains 80 VitaminC cases (20 native positives) and 80 SciFact cases (30 native positives), in 38 source components. Validation and locked holdout were not opened. `eval/analysis/quality-r1-screen-audit.py` reproduces this training-only audit and pins the screen/run hashes.

| Candidate        | Default TP / FP | Precision / recall | Retrospective maximum recall at ≥95% precision |
| ---------------- | --------------: | -----------------: | ---------------------------------------------: |
| rich-control     |          27 / 3 |      90.0% / 54.0% |                                            18% |
| local-mini       |          32 / 5 |      86.5% / 64.0% |                                            14% |
| literal-contract |          31 / 3 |      91.2% / 62.0% |                                            40% |
| nli-three-way    |          31 / 3 |      91.2% / 62.0% |                                            46% |
| noul-conflict    |          27 / 3 |      90.0% / 54.0% |                                            44% |
| semantic-numeric |          19 / 3 |      86.4% / 38.0% |           48% from its ungated conflict signal |

The scalar frontiers are in-sample training diagnostics, with ties grouped; none passes the targets. With fifty native positives, ≥90% recall requires 45 TP and ≥95% precision permits at most two FP for 45–50 TP. Do not transfer the earlier 71-positive dataset's numerical FP budget to this screen.

### High-confidence training false positives and role alignment

Five distinct native-negative cases receive a positive decision in at least one arm. Three are shared across all six; two are additional `local-mini` errors. Several arise from apparent native/supplied-evidence tensions, not a reason to silently correct labels.

| Training pair                                                          | Observed issue                                                                                                                                                                            | Round 2 distinction                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scifact:train:933:14711483:0` (SUPPORT)                               | All six contradict, scores .84–.99. Claim describes increased morphine use after four hours of exposure; the evidence reports lower six-hour use and no significant four-hour difference. | Exposure duration, outcome follow-up, before/after versus between-group comparator, and statistical nondetection are different roles. Do not compare every number or infer a proven zero effect from nonsignificance.  |
| `scifact:train:164:5824985:0` and `165:5824985:0` (SUPPORT)            | All six contradict, scores .82–.98. Claim is increased colorectal or postmenopausal breast-cancer rates; the supplied sentence reports no detected association with cancer in aggregate.  | Aggregate/subtype scope and an undetected association are not a logical denial of every component effect. These are two observations from one source component, not independent evidence of two general failure rates. |
| `vitaminc:combined:train:5ed7acfec9e77c00084a5816_1` (SUPPORTS)        | Mini contradicts .82; other arms abstain. Named award winners include André 3000 versus Benjamin, without a supplied alias bridge.                                                        | Names alone neither prove a decisive alias nor establish incompatible winners. Do not invent identity facts or exclusivity; a compatibility witness can exist even without knowing an alias.                           |
| `vitaminc:combined:train:5ebe6f32c9e77c00084099c8_3` (NOT ENOUGH INFO) | Mini contradicts .81; other arms abstain. Son died in 2015 versus father was survived by that son.                                                                                        | Survival is anchored to the father's death, whose date is not supplied; the son can die later. Do not assume simultaneous observations.                                                                                |

The scientific SUPPORT labels above are unchanged. A literal-role analysis may justify lowering contradiction or preserving uncertainty, but only independent service-contract annotation could turn that into a new gold label. Similarly, “no effect” asserted as a substantive fact differs from “no statistically significant effect was detected”; an indiscriminate rule equating or separating both phrases would create new errors.

### Native-positive misses that cannot safely become blanket prompt examples

Twelve positive training cases have conflict scores below .5 in **all six** arms. Several admit direct compatibility witnesses under the literal task:

- André ancestry pairs `5ed7acfec9e77c00084a5814_2/_3`: “African-American” and “African-American and Native American” can both be true. Omission is not denial, even though the native label is REFUTES.
- SciFact claim `263`, document `30041340`, rationale sets `0/1`: identifying citrullinated proteins/antibody substrates does not itself deny a claim about disrupting an inflammatory cycle. The other document's NET/inflammation direction requires separate semantic examination; do not relabel every rationale automatically.
- SciFact claim `855`, document `8190282`: a statement about whether NIV predicts respiratory failure can coexist with evidence that NIV helps treat patients already experiencing it. Treatment and prediction are different relations. Individual rationale rows are not independent claims.

These witnesses identify a task/context gap, not a certified label-noise fraction or a model-capacity ceiling. Two tribe-name perturbations also remain hard: the supplied texts do not establish whether “Na'im” and “Al Nuaimi” are aliases or incompatible identities. Supplying invented outside identity knowledge to force a desired native answer would violate the contract.

Nine native positives have a raw positive `semantic-numeric` conflict signal but still abstain. These include dates, transfer fees and other quantities. The corresponding feature/gate records are preserved in the audit JSON. A safer arithmetic lane must distinguish unresolved decisive quantities from irrelevant numeric context; it must not silently remove all quantitative safeguards merely to recover these training cases.

### Authored Round 2 questions

`eval/iteration/round-two.ts` supplies `roundTwoQuestion('aligned-roles' | 'evidence-refutation', ref)` for the parent-owned harness. It adds invented, short contrast examples and detailed role alignment without copying benchmark rows into prompts:

- `aligned-roles`: a four-way whole-pair Choice preserving changed property values versus scope; aggregate versus component; intervention/comparator/window; statistical assertion status; treatment versus prediction; supplied aliases versus decisive unresolved identity; and omitted corroboration versus missing meaning.
- `evidence-refutation`: an independent Noul asking whether the supplied comparison refutes the claim. False includes insufficient evidence and is explicitly **not** a certificate of the service's clear-negative compatibility verdict.

The aligned question is approximately 4,045 bytes and the refutation question 2,758 bytes with the sample reference. They are single-pair quality experiments; twenty-question payload fit is not claimed. Strong single-pair wording should be measured before compacting or promoting a batch profile. Typecheck, targeted lint and formatting passed. Sources must be frozen before Round 2 inference; no numerical improvement is claimed before its results exist.
