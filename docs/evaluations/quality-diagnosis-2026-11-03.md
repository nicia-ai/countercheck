# Benchmark comparison and quality diagnosis

Status: offline development analysis, 2026-11-03. No new inference, runtime changes or deployment. Original benchmark artifacts and labels are unchanged. [Reproducible analysis](../../eval/analysis/quality-diagnosis-2026-11-03.py), [full results](../../eval/analysis/quality-diagnosis-2026-11-03.json), [eight-track CSV](../../eval/analysis/quality-diagnosis-2026-11-03.csv).

None of the four models demonstrates the proposed 95% contradiction precision and 90% recall targets. More decisively, no single contradiction-score cutoff on the saved predictions attains both targets on either dataset, even when selected optimistically on those same development labels. Better scoring and task alignment are required alongside calibration.

These are 200 VitaminC and 199 SciFact supplied-evidence development pairs, with 71 benchmark positives per dataset. Samples preserve groups but are not population-representative; VitaminC contains only 25 revision/contrast groups. SciFact receives complete annotated rationale sets rather than full abstracts or retrieved documents. They are diagnostic tracks, separate from the human-adjudicated release corpus.

| Dataset  | Model     | Precision | Recall |    F1 | Definite negatives / gold negatives | AUROC |
| -------- | --------- | --------: | -----: | ----: | ----------------------------------: | ----: |
| VitaminC | Jev 1.14  |     90.3% |  39.4% | 0.549 |                               79.1% | 0.865 |
| VitaminC | Full Clef |     73.8% |  43.7% | 0.549 |                               59.7% | 0.761 |
| VitaminC | Decider   |     94.6% |  49.3% | 0.648 |                               78.3% | 0.927 |
| VitaminC | DeBERTa   |     66.7% |  36.6% | 0.473 |                               89.9% | 0.737 |
| SciFact  | Jev 1.14  |     94.4% |  47.9% | 0.636 |                               85.2% | 0.966 |
| SciFact  | Full Clef |     92.9% |  36.6% | 0.525 |                               55.5% | 0.950 |
| SciFact  | Decider   |     94.3% |  46.5% | 0.623 |                               50.8% | 0.957 |
| SciFact  | DeBERTa   |     92.2% |  66.2% | 0.770 |                               96.9% | 0.924 |

The hosted decision models use the untuned four-way prompt and 0.8/0.2 abstaining policy. DeBERTa uses native forced three-way argmax mapped to contradiction versus rest. This compares decision policies as well as model ability; matched-policy/coverage evaluation is necessary before selecting a production model. The negative denominator includes each dataset's native negative labels, which are not automatically equivalent to the release corpus's human-labeled “clearly non-contradictory” subset.

Decider has the strongest observed default VitaminC F1; DeBERTa has the strongest default SciFact F1 under its forced policy. Jev has the strongest SciFact ranking metric and the lowest observed hosted latency. Full Clef's historical admission-task performance did not transfer to this prompt/task. Jev, Clef and DeBERTa each completed all 399 pairs without errors. Decider had two deadline errors, both on negative pairs: they explain none of its positive misses. No pair was excluded. Hosted kernel/provider p95 was about 92–99 ms for Jev, 505–533 ms for Clef and 832–880 ms for successful Decider calls; local CPU DeBERTa timing is a separate route and not a hosted latency comparison.

## What the offline sweep establishes

| Model     | Maximum VitaminC recall at precision ≥95% | Maximum SciFact recall at precision ≥95% |
| --------- | ----------------------------------------: | ---------------------------------------: |
| Jev 1.14  |                                     31.0% |                                    66.2% |
| Full Clef |                                     11.3% |                                    28.2% |
| Decider   |                                     53.5% |                                    31.0% |
| DeBERTa   |                                      2.8% |                                    57.7% |

These are optimistic in-sample operating points, not deployable thresholds or held-out estimates. Each dataset requires at least 64 of its 71 positives detected, with at most three false positives, to meet both point-estimate targets. Jev's best qualifying points find only 22/71 and 47/71. At 90% recall, the best attainable precision from any single cutoff is 47.9%/79.3% for Jev and 75.3%/86.7% for Decider on VitaminC/SciFact. A monotonic calibration of the existing contradiction score can move its numeric operating point but cannot improve this ranking frontier.

There are meaningful cheap improvements: on SciFact, moving Jev's cutoff to 0.4 on these same labels gives 47 true positives and two false positives, or 95.9% precision and 66.2% recall, versus 34 true positives and two false positives at 0.8. This demonstrates headroom, not qualification. Choosing that cutoff after seeing these labels requires independent validation.

Jev misses 80/142 benchmark positives: 68 are uncertain and 12 are definitive negatives. Uncertainty accounts for 85% of misses, but many uncertain pairs rank `consistent` above `contradiction`; the problem extends beyond near-threshold abstention. An ideal second stage applied only to uncertain results would still leave VitaminC's nine definitive false negatives, capping that track's recall at 62/71 = 87.3%. A verifier therefore needs a validated high-recall candidate policy that includes suspect negatives.

Pooling consistent and different-scope probabilities is not a free improvement. Keeping the other guards and requiring their sum to reach 0.8 adds ten correct Jev negatives across the two datasets, but also turns fourteen benchmark-positive uncertain results into definitive false negatives. Positive recall is unchanged. Similarly, taking the union of all four models' current positive decisions reaches only 51/71 VitaminC positives and 57/71 SciFact positives, still below the required 64, with 19 and four false positives respectively.

## Semantic findings from spot checks

The current prompt asks whether the submitted assertions can jointly hold, preserves quantifiers and times, and treats omission or lack of support as non-contradiction. Benchmark fact-verification labels do not uniformly establish that narrower relation from the provided snippets.

For example, VitaminC pair `5ee393b6c9e77c0008ccbff0_3` is a native REFUTES positive: the claim says more than 4,290 deaths and the evidence says more than 4,200. Both lower bounds can hold. Jev's low contradiction score is compatible with the API's literal policy while still receiving a benchmark miss. Other sampled cases remove an attribute from the evidence or compare different temporal cutoffs. These are audit candidates, not grounds to change published benchmark labels or an estimate of dataset noise prevalence.

SciFact also requires scientific interpretation, abbreviations/aliases and surrounding context in some examples. A rationale is a human annotation within an abstract; standalone sufficiency for the service contract should be checked separately. There are genuine underconfident conflict candidates too: Jev gives 0.76 to the RUNX1 tumor-promoting versus tumor-suppressor contrast, which the 0.8 cutoff abstains on. The spot check does not establish the relative frequency of model error, missing context or semantic mismatch. [VitaminC's task](https://aclanthology.org/2021.naacl-main.52/) and [SciFact's abstract/rationale task](https://aclanthology.org/2020.emnlp-main.609/) define why their original settings need to stay distinct from this adaptation.

## Recommended changes, in order

1. **Establish contract-aligned truth and preserve native benchmarks.** Audit a stratified failure sample with two annotators and adjudication: explicit negation, exact values versus lower bounds, dates, modality, entity aliases, omitted information and domain inference. Keep native scores intact and add separate service labels/context sufficiency. Build the already specified human-adjudicated corpus of at least 500 pairs, with at least 200 locked tests and organization/template separation. Report realistic prevalence and domain slices. Decide the supported v1 domain explicitly; broad scientific fact verification requires capabilities beyond straightforward factual/policy conflicts.
2. **Test a simpler decision formulation under a versioned experimental profile.** Compare the current four-way Choice against a focused contradiction Noul, a separate sufficiency/applicability judgment, and an ordinary three-way relation formulation with concrete hard-case criteria. Ask parallel questions within one provider request. Treat these as hypotheses: they may improve signal separation, but existing results do not prove they will. Preserve explicit dates, qualifiers and entity identity; provide necessary caller context rather than inventing it. [TypeSafe's Noul](https://docs.typesafe.ai/primitives/noul) and [Choice](https://docs.typesafe.ai/primitives/choice) references support these primitives and independently answered questions, not an accuracy guarantee.
3. **Tune and calibrate model-specific operating policies on grouped development data.** Use the same task definition and coverage accounting for all comparators, then freeze one declared policy and evaluate untouched groups. Keep positive precision, positive recall, false-clear negatives and negative coverage as separate constraints. A 0.8 cutoff has no universal meaning across these models. Retain Jev as the fast baseline and Decider as the principal VitaminC challenger; this evidence does not justify switching the default to Clef.
4. **If the improved fast scorer still cannot reach the frontier, evaluate a stronger scorer or verifier.** Compare a trainable domain-adapted NLI model and a stronger reasoning verifier on the same adjudicated pairs. For an eventual cascade, measure routing on uncertain and suspect-negative cases, joint precision/recall, cost and tail latency. This requires an explicit revision of v1's single-call/cost/deadline contract. Only independently validated quality improvements should select the production route. Package the adjudicated failure slices for model-builder evaluation.

These steps are a testable route toward the targets, not evidence they are attainable for unrestricted text within the current fast single-call budget. Current development points, optimized cutoffs, perfect-oracle thought experiments and public benchmark labels do not certify production behavior.
