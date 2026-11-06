# Independent audit of profile regressions

Status: initial offline development diagnosis, 2026-11-03. That diagnosis used no inference, credentials, network access, dependency changes, source edits, or production changes and wrote only this report. Later sections record separately authorized offline harness tests and workflow-guard implementation.

The evidence supports another prompt/composition experiment. It does **not** support a model-capacity ceiling. The compact semantic formulation loses useful signal; the structured formulation additionally combines competing tasks and vetoes semantic judgments on incidental parsing failures. Native benchmark errors also include comparisons that do not express the same decision boundary as the service contract. Preserve those native labels and add separately reviewed contract annotations rather than optimize either task by silently changing the other.

## Evidence and coverage

Read `AGENTS.md`, `docs/decision-engineering.md`, the measured engineering study, both archive READMEs, `eval/prompt-ablation/profiles.ts`, `src/kernel/{index,experimental,values}.ts`, and the engineering composition/probe/runner sources. Offline standard-library Python joined the exact archived manifests and prediction rows by pair ID. It scanned all 4,741 original ablation rows, the 1,293 initial engineering single-pair rows, and 431 reviewed structured single-pair rows. It enumerated every native false positive and definitive false clear across those rows, inspected their public texts/raw signals, checked all 32 synthetic targets against **expected_verdict**, and compared lost positive scores and threshold frontiers. Batch and toy-workflow evidence was read from the existing archive; it was not treated as additional independent truth.

There are **26 distinct public pair IDs** with at least one native false-positive/false-clear observation across this scope: six false-positive IDs and twenty false-clear IDs. That is a union across formulations/repeats, not an error rate. Four synthetic uncertainty proxies never enter that count or binary frontiers. The table below accounts for every public ID. This is a review of saved observations, not an independent human relabeling of the benchmarks.

Archive roots:

- `eval/results/prompt-ablation-2026-11-03/`: all three original ablation checkpoints and unchanged input manifests.
- `eval/results/decision-engineering-2026-11-03/runs/`: initial balanced, semantic and structured checkpoints.
- `eval/results/decision-engineering-2026-11-03/post-review/`: reviewed structured checkpoint, separate from the initial source/pass.

Current source read at HEAD `e604367afd927f2a8b72c41f89773cb677580d77`; the worktree is under active R&D. Relevant content hashes at this pass:

| File                               | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `eval/prompt-ablation/profiles.ts` | `40edc4582663719a46f4f124cb461279f2904a8da52f54d9d0f58cdf3ed0f7bd` |
| `src/kernel/experimental.ts`       | `8366bd36e422201ad92fb72a6a9b34ed0a1a96266d880c886199fc3ad677d863` |
| `src/kernel/values.ts`             | `1a32191121c59f150d9abaabd0da1541cfc5858eaa9c6aabbeaf6fbe79bfb4f6` |
| `eval/engineering/composition.ts`  | `18134c9356d339f1c0d3d06e2d56f39d657ab734676f9b8b02fb950f9ca3c478` |

These identify this scoped read, not a final whole-tree certification or the source of every historical run. Historical run snapshots remain authoritative for their inference.

## 1. Retained probabilities contradict a capacity-limit explanation

The following is a **retrospective in-sample frontier**, computed by trying every distinct saved contradiction score as a `score >= threshold` positive cutoff, then retaining the most true positives with native precision at least 95%. It is not a tuned shipping threshold, confidence bound, calibrated probability claim, or held-out estimate. Ties are included in full. Each dataset has 71 native positives.

| Dataset/formulation                              | Maximum TP / FP at ≥95% empirical precision |              Recall | Example threshold |
| ------------------------------------------------ | ------------------------------------------: | ------------------: | ----------------: |
| SciFact, earlier rich rubric, runs 1 / 2 / 3     |                            62/3, 63/3, 62/3 | 87.3%, 88.7%, 87.3% |   .27 / .18 / .29 |
| SciFact, earlier rich + examples, runs 1 / 2 / 3 |                            61/3, 61/3, 63/3 | 85.9%, 85.9%, 88.7% |   .22 / .25 / .15 |
| SciFact, fresh engineering balanced              |                                        46/2 |               64.8% |               .44 |
| SciFact, compact semantic                        |                                        40/2 |               56.3% |               .58 |
| VitaminC, earlier rich rubric, runs 1 / 2 / 3    |                            26/1, 24/1, 24/1 | 36.6%, 33.8%, 33.8% |   .85 / .87 / .88 |
| VitaminC, fresh balanced / compact semantic      |                                  21/1, 21/1 |        29.6%, 29.6% |         .89 / .89 |

At the original .8 cutoff the earlier rich SciFact formulation has 38 TP/2 FP, versus compact semantic 28 TP/2 FP. Ten rich positives fall below .8 in compact semantic, without a compensating new positive. This is not just a common threshold applied to a preserved ranking: its ≥95% frontier also weakens. Provider variation prevents attributing the entire difference to any one wording change, but the retained rich scores show substantially more recoverable signal than the published .8 verdicts alone suggest.

Concrete rich run-1 → compact contradiction-score losses:

| SciFact pair ID suffix | Rich → compact | What the text actually tests                                                                                                   |
| ---------------------- | -------------: | ------------------------------------------------------------------------------------------------------------------------------ |
| `1137:33370:1`         |      .93 → .61 | Tumor suppressor vs tumor enhancer; cross-name TNFAIP3/A20 mapping is also required.                                           |
| `1336:27910499:0`      |      .80 → .07 | Cord-blood TCR diversity vs a different transplant comparator; must align populations and the measured direction.              |
| `1382:17755060:1`      |      .85 → .36 | Tumor enhancement vs explicit tumor suppressor; aPKCz/PKCζ spelling/identity is relevant.                                      |
| `180:16966326:0`       |      .89 → .70 | Blocking/suppression and increased vs abolished neuronal loss.                                                                 |
| `219:21366394:0`       |      .80 → .72 | Receptor inhibition/deficiency reducing disease vs the receptor suppressing inflammation; requires causal-direction reasoning. |
| `274:11614737:0`       |      .91 → .74 | A statistically significant claim vs non-significant P values; numeric effect direction is not significance.                   |
| `274:11614737:1`       |      .88 → .76 | Explicit “significantly higher” vs “neither outcome significantly different.”                                                  |
| `743:32159283:0`       |      .93 → .76 | Protective effect vs explicitly no effect.                                                                                     |
| `859:1982286:0`        |      .85 → .74 | Tumor-promoting vs tumor-suppressor role.                                                                                      |
| `903:10648422:1`       |      .95 → .59 | Reduced vs upregulated IL-10 production with aligned intervention/actor.                                                       |

VitaminC rich-to-compact losses also include rating/review-count bounds (`5eb29887…d92dba_3`, .96→.67) and two case/death/recovery count comparisons (`5ee393b6…ccb917_3`, .89→.77; `…ccbd6d_3`, .85→.76). These need unit, quantity-role and time alignment, not merely a more permissive threshold.

## 2. “Compact” changed the task formulation, not just duplication

Earlier rich criteria put `means`, `includes`, `excludes`, and labeled examples directly under each answer category. Compact semantic uses four terse criterion strings and moves a rewritten rubric/examples into shared state. It also changes the question to a yes/no-styled “Do … make incompatible assertions?” while requesting four relation categories. The eight examples are changed: different version examples replace year examples, an insufficient-context threshold example is removed, and a rule/violation example is added. Therefore the comparison cannot isolate shared context, criterion placement, or examples independently.

Two explicit boundaries were weakened in the compact text:

- The baseline POLICY says unqualified assertions are considered together. Compact says overlapping scope/time is required and “Do not invent supersession,” but omits that positive default. This leaves room to treat an absent timestamp/applicability field as unknown.
- Earlier rich `insufficient_context.excludes` explicitly rules out unfamiliarity, missing corroboration and ordinary omitted detail. Compact's insufficient-context definition names unresolved meaning/status/applicability without that full exclusion. Its `consistent` definition partially compensates, but the operational boundary is less explicit.

Those are supported formulation differences and hypotheses to test; saved aggregate results cannot establish their individual causal effect. Restore the exact earlier formulation as a control before rewriting everything again. A placement-only arm should preserve identical definitions/examples and change only their location/references.

## 3. Structured regression has two independent mechanisms

### Global extraction veto

The reviewed structured run marks incomplete coverage on **170/200 VitaminC** and **130/199 SciFact** rows. Every such row becomes uncertain even if the semantic contradiction category is strong. Among vetoed rows with categorical contradiction ≥.8 there are **14 native positives/1 native negative in VitaminC** and **10 positives/1 negative in SciFact**. These are counterfactual observations under the existing mixed prompt, **not** a validated accuracy estimate for a new independent semantic lane.

Examples:

- SciFact `1130:17997584:0`: “more adept” at suppression vs “unable” to suppress, contradiction .93. Each side has one unsupported span associated with digit-bearing `αvβ8`; this is an identifier, not an unresolved magnitude that must be compared to establish the opposing predicates.
- SciFact `1339:15482274:0`: “raises … traumatic procedures” vs “significantly reduced … traumatic procedures,” contradiction .92. Fifteen recognized and four unsupported evidence spans veto an explicit lexical opposition. The trial's subsidiary P values and confidence intervals should not by themselves invalidate this semantic lane.
- SciFact `142:10582939:0`: higher infection rate vs explicitly decreased infection risk, contradiction .96; anti-IL-2 identifiers and study statistics trigger incomplete coverage.
- Synthetic `00`, `02`, `03`: contradiction .91/.96/.89, all vetoed. Plain participant counts and spelled duration/day expressions are outside this deliberately narrow parser. In `00`, a shared written date and monthly price syntax also block complete extraction.
- Synthetic `20` (adult vs child fare) has different_scope .95 and `27` (at least ten vs exactly twelve days) consistent .95; both are vetoed. They illustrate the coverage cost, although numeric overlap must still never establish whole-text consistency by itself.

No reviewed single-pair row selected a numeric candidate pair; all 431 have `numeric_relation: null`. The initial pass selected eight VitaminC candidate pairs (six compatible, two incompatible), zero SciFact pairs. Thus the corrected run does not demonstrate useful deterministic arithmetic participation, and cannot establish the safety/quality of a future broader numeric lane.

### Competing categories dilute otherwise simple semantics

Even with complete zero-number extraction, the structured question asks both for a whole-pair relation and for eligible candidate selection; it adds `unknown` beside `insufficient_context` and the four relation choices. The instruction to choose unknown for unlisted values conflicts operationally with semantic fallback when ordinary numbers/word numbers were not discovered. A mixed, variable-size categorical menu is neither an independent semantic distribution nor an alignment distribution.

Reviewed examples with **complete extraction and no numeric candidates**:

| Synthetic                                        | Semantic category | `unknown` | Result    |
| ------------------------------------------------ | ----------------: | --------: | --------- |
| `01`, open every Tuesday vs closed every Tuesday | contradiction .79 |       .16 | uncertain |
| `13`, API+analytics vs API                       |    consistent .68 |       .22 | uncertain |
| `15`, some mentors vs some non-mentors           |    consistent .77 |       .16 | uncertain |
| `17`, packing rule vs observed violation         |    consistent .68 |       .15 | uncertain |
| `25`, correlation vs no established causation    |    consistent .68 |       .23 | uncertain |

Removing only the extraction veto would leave these misses. Adding all pair-option mass to contradiction would be invalid: an eligible pair can overlap, be incomparable, or concern only one part of the texts. Option-selection probabilities also change when the number of candidates changes. Keep these signals separate and preserve their provenance.

## 4. Actual error audit: native labels versus literal contract

All IDs below are from the frozen public manifests. “FC” means native-positive prediction cleared, **not** a newly adjudicated service-contract error. “FP” means native-negative prediction contradicted. The distinctions below are review observations needing independent contract annotation; native metrics must retain their original labels.

| Public pair ID                                     | Native error | Text-level diagnosis / next check                                                                                                                                                                                            |
| -------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scifact:dev:1385:306006:0`                        | FP           | Enhances signaling vs enhancing formation reduced stimulatory capacity. Looks like literal opposition; do not teach “consistent” solely to match native SUPPORT.                                                             |
| `scifact:dev:593:19675911:0`                       | FP           | 10% decrease vs “did not change over time.” Looks literally opposed if time/population align; annotation/scope review required.                                                                                              |
| `vitaminc:combined:dev:5ee3932dc9e77c0008ccb615_1` | FP           | Airborne vs “not thought to be airborne.” Actual assertion vs epistemic belief/report status is decisive; do not silently strip “thought.”                                                                                   |
| `vitaminc:combined:dev:5ee393b6c9e77c0008ccb918_2` | FP           | Before April 21 vs by April 21, with approximate counts. They can describe different cutoffs; do not equate before and by, or invent an approximation tolerance.                                                             |
| `vitaminc:combined:dev:5ea2d97dc9e77c0009cdb1f1_1` | FP           | <8.55m motors vs >8.5m vehicles. Bounds overlap; measured objects differ; evidence also has encoding/truncation artifacts already present in the benchmark.                                                                  |
| `vitaminc:combined:dev:5ee3932bc9e77c0008cc9eb4_4` | FP           | <2,810 vs >2,800 permits 2,801–2,809. A real bound-overlap error in the inline-policy observation, independent of native-label mismatch.                                                                                     |
| `scifact:dev:1137:33370:0`                         | FC           | TNFAIP3 suppressor vs A20 targeting reducing tumorigenicity. Alias and intervention direction are needed; the text does not explicitly establish the alias.                                                                  |
| `scifact:dev:1221:19736671:0`                      | FC           | “Very similar” genomic aberrations vs shared and non-shared mutation signatures. Different subsets need not disprove overall similarity. Missing proportions/meaning may matter; do not force contradiction.                 |
| `scifact:dev:183:12827098:0`                       | FC           | Bone-marrow contribution vs host macrophage expansion when donor development is compromised. Residual host capacity alone does not explicitly deny contribution.                                                             |
| `scifact:dev:811:19799455:0`                       | FC           | SVCT2 vs Slc23a1−/−, increased vs reduced. Rich criteria choose different_scope (.87–.89). Correct identity/alias knowledge is absent from the supplied text; not proof of literal contradiction without further definition. |
| `scifact:dev:811:19799455:1`                       | FC           | Same naming issue; low ascorbate appears in a hemorrhage/scurvy discussion. Test explicit supplied aliases separately from unsupported biological identity.                                                                  |
| `scifact:dev:852:13843341:1`                       | FC           | Conditional guidance if conventional treatment is inadequate vs general cost/mortality benefit. Not an explicit denial of that conditional guidance.                                                                         |
| `scifact:dev:879:8426046:0`                        | FC           | No functional peptides vs occupancy insufficient to classify coding status. Lack of a diagnostic conclusion does not assert peptide production.                                                                              |
| `vitaminc:combined:dev:5ebe6f31c9e77c0008408e59_2` | FC           | >10m in first three years vs >10m US shipments. Different additional qualifiers can both hold.                                                                                                                               |
| `vitaminc:combined:dev:5ebe6f31c9e77c0008408e59_3` | FC           | Reverse of the preceding US/time qualifier comparison; omission is not negation.                                                                                                                                             |
| `vitaminc:combined:dev:5ebe6f31c9e77c0008408e5a_3` | FC           | >27m vs approximately 27m. Approximation does not specify an exact closed upper bound.                                                                                                                                       |
| `vitaminc:combined:dev:5ed7ad02c9e77c00084a6aef_1` | FC           | Platforms listed vs original game included. Omitted platforms do not deny availability.                                                                                                                                      |
| `vitaminc:combined:dev:5ed7ad03c9e77c00084a7882_2` | FC           | Retractable roof vs roof replacement. Replacement does not deny retractability.                                                                                                                                              |
| `vitaminc:combined:dev:5ee3932ac9e77c0008cc99bd_3` | FC           | >84,500 vs >84,000 recoveries. Both hold for 85,000; contract-compatible bounds.                                                                                                                                             |
| `vitaminc:combined:dev:5ee3932ac9e77c0008cc9a46_3` | FC           | >99,000 vs 99,000 recoveries on the same date. If the latter is exact, this is a real strict-bound conflict; rounding/exactness must be defined rather than assumed.                                                         |
| `vitaminc:combined:dev:5ee3932ac9e77c0008cc9d14_2` | FC           | “Airborne is false” vs not airborne for extended periods. Negating extended duration does not negate every duration; preserve the qualifier.                                                                                 |
| `vitaminc:combined:dev:5ee3932bc9e77c0008cc9eb4_2` | FC           | >2,810 vs >2,800 deaths. Compatible lower bounds.                                                                                                                                                                            |
| `vitaminc:combined:dev:5ee3932bc9e77c0008cca220_3` | FC           | >675,000 after April 4 vs about 657,200 by April 4. Later totals can increase; no need to presume a simultaneous exact-value conflict.                                                                                       |
| `vitaminc:combined:dev:5ee393b6c9e77c0008ccbff0_3` | FC           | >4,290 vs >4,200 deaths. Compatible lower bounds.                                                                                                                                                                            |
| `vitaminc:combined:dev:5ee393b7c9e77c0008ccc47c_2` | FC           | Deaths defined with positive tests vs death after positive tests. Missing detail does not explicitly deny death.                                                                                                             |
| `vitaminc:combined:dev:5ee393b7c9e77c0008ccc47c_3` | FC           | Reverse of preceding omission; not automatically a disjoint or opposite definition.                                                                                                                                          |

Do not interpret the six FP IDs as six arithmetic failures. Two SciFact cases need native/contract adjudication; one VitaminC case needs epistemic-status handling; one needs temporal/approximation handling; two expose overlapping bounds. Conversely, many native FCs are expected under literal compatibility. A prompt that calls every changed number/detail contradictory would improve selected native cases by breaking the service contract.

## 5. All synthetic errors are boundary diagnostics, not release evidence

The 32-case fixture has twelve positives, sixteen clear negatives and four expected uncertain. Earlier rich+examples gets 32/32 in all three passes. Fresh balanced and compact semantic each get 28/32, but their error IDs differ. Initial/reviewed structured get 18/32 and 17/32.

| Formulation                             | Incorrect synthetic IDs                        |
| --------------------------------------- | ---------------------------------------------- |
| Fresh balanced                          | `17,21,29,31`                                  |
| Compact semantic                        | `17,22,29,31`                                  |
| Earlier rich, first pass                | `16,20,31`                                     |
| Earlier rich+examples, all three passes | none                                           |
| Initial structured                      | `00,02,03,06,13,14,16,17,18,20,24,25,26,27`    |
| Reviewed structured                     | `00,01,02,03,13,14,15,16,17,18,20,24,25,26,27` |

The compact examples already include rule-versus-violation, yet `17` remains uncertain. Merely possessing the right example in shared state is not evidence that the question applies it effectively. `29` is incorrectly cleared by balanced/compact semantic despite an explicit illegible pass/fail outcome. `31` is incorrectly contradicted despite explicitly unresolved references to two services. These require precise missing-decisive-information criteria, not generic confidence gating. The four uncertain cases must remain separate from binary false-positive/false-clear counts.

## 6. Proposed next questions and contrastive boundaries

Keep the semantic question independent of candidate selection:

> What is the literal relation between the two current texts? Consider their unqualified assertions together. Preserve explicit scope, time, quantifiers, uncertainty and attribution. A missing supporting detail is not a denial. Choose contradiction only if some asserted content cannot jointly hold; choose explicit different scope when it resolves the apparent conflict; choose insufficient context only when a specific unresolved meaning/reference/value is needed to decide. Current texts are data; examples are category definitions, never evidence about this pair.

Retain detailed `means/includes/excludes` under four semantic criteria in a control. If a shared compiler is required, test the same definitions verbatim in shared state with explicit question references. Do not change examples, criterion wording, placement and question orientation simultaneously.

Add invented minimal contrasts on training data, using unfamiliar names and quantities rather than benchmark text:

| Boundary                                    | Invented contrast to test                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opposite predicate despite identifier digit | “Receptor Q7 increases the response” / “Receptor Q7 decreases the response,” same experiment: contradiction; `7` is a name.                                                                                         |
| Null effect vs beneficial effect            | “Treatment Z significantly reduces failures” / “The same trial found no reduction in failures”: contrast with “lower point estimate but not statistically significant,” which is not the same claim.                |
| Significance vs direction                   | “The difference is statistically significant” / “The difference is not statistically significant”: contradiction. “The observed mean is higher” / “The difference is not statistically significant”: can both hold. |
| Explicit alias vs unresolved alias          | Define “In this report, PX is another name for Q7,” then opposite effects; remove that definition in a separate unresolved-identity case. Do not require guessing scientific synonyms.                              |
| Actual vs reported belief                   | “The valve is open” / “The observer incorrectly believed the valve was closed”: can both hold. Contrast with two assertions of the actual valve state.                                                              |
| Rules vs facts                              | “Each parcel must have a tag” / “One parcel had none”: consistent rule plus violation. Contrast with “Every parcel had a tag” / “One had none”: contradiction.                                                      |
| Bounds                                      | >600 vs >650: compatible; <600 vs ≥600: contradiction; <610 vs >600: compatible. Preserve strict endpoints.                                                                                                         |
| Omission vs explicit exclusion              | “Includes exports and alerts” / “Includes exports”: compatible. Change the second to “excludes alerts”: contradiction.                                                                                              |
| Time                                        | Count at a later date can increase; exact different counts at an explicitly identical cutoff cannot. “Before” and “by” are different boundaries.                                                                    |
| Specific unknown vs ordinary omission       | Illegible final pass/fail outcome vs passed: uncertain. A description lacking an unrelated extra feature: ordinary omission, not unknown.                                                                           |

These are proposed boundaries, not frozen final fixtures or new adjudications. Explicitly define units/exactness and the assertion status so invented examples do not introduce fresh ambiguity.

Optional numeric questions should distinguish:

1. **Alignment:** Are these two supported spans constraints on the same asserted quantity, with overlapping entity/property/time/population and compatible assertion status? Return same / explicitly different / unresolved, with candidate IDs validated against source spans.
2. **Numeric necessity:** Is deciding the relation blocked by an unresolved quantitative comparison, or does an explicit independent semantic conflict/scope distinction already settle it? Incidental statistics, identifiers and citations are not automatically decisive quantities.
3. **Completeness for a negative:** Does unresolved content leave a plausible contradiction in the whole pair? A supported overlapping numeric pair is not proof of whole-pair consistency.

These are distinct judgments; do not combine their categories in one softmax or multiply their marginals as if independent. One provider request may contain multiple questions, but actual twenty-pair payload bytes, question count, latency and attribution must be measured. No existing single-pair result qualifies that envelope.

## 7. Composition and experiment design

Useful retained features are independent semantic contradiction/consistent/scope/unknown scores; asserted-vs-quoted/proposed/rejected/epistemic status; explicit same/different/unresolved quantity identity; whether a quantity is decisive; deterministic disjoint/overlap/incomparable result; extraction completeness **for the attempted proof**; candidate count; and unresolved whole-pair content. Keep source spans and per-question distributions. These are model judgments/diagnostics, not calibrated final-verdict probabilities.

Numeric disjointness may add a positive only after validated semantic alignment. Numeric overlap must not add a clear negative. Failed numeric extraction should disable that proof, not automatically cancel an independently established nonnumeric contradiction. A clear negative needs sufficient whole-pair semantic support and no decisive unresolved content. For text that actually requires unsupported arithmetic, uncertainty remains appropriate. A new lane must demonstrate that distinction rather than just remove all conservative checks.

The present engineering calibrator cannot resolve the global-veto problem by tuning: `forced_uncertain` is tested before every policy and includes extraction failure even when a separate semantic reference was supplied. Its forty-eight policies also have minimum positive threshold .5, so they cannot even explore the rich SciFact saved frontier around .2–.3. This is a design limitation for the next experiment, not a request to retrofit a low threshold into the deployed profile. Fit a frozen threshold/composition on adequately sized development tuning groups, evaluate disjoint validation groups, and protect a genuinely new test set. A two-case tuning fold cannot identify a useful composition.

Recommended controlled arms:

1. Reproduce the exact earlier rich single-pair compiler and an unchanged baseline in the same run schedule.
2. Placement-only compact arm: exact same rich rubric/examples, shared once, neutral four-way question; no changed boundary definitions.
3. Wording-only arm: same placement/criteria/examples, restored unqualified-assertion default and explicit unknown exclusions.
4. Independent semantic + optional numeric alignment arm; compare its semantic scores to the identical semantic-only arm before evaluating composition. Preserve a no-numeric control for identifier/irrelevant-statistics cases.

Freeze source, manifests, profiles, thresholds and planned comparisons before inference. Interleave matched arms/cases and unchanged repeats rather than finishing whole profiles serially; retain run time/order because identical payloads already vary. Analyze grouped paired differences and repeats as repeated observations of the same labels. Report score frontiers, false clears, native and separately annotated contract errors, negative coverage and abstention by reason. In particular, report clean nonnumeric, incidental numeric, decisive supported numeric, decisive unsupported numeric, explicit scope, and unresolved-reference slices.

Use the already inspected 399 public and 32 synthetic cases for diagnosis/training, not a newly claimed held-out gate. Any label sidecar needs its own provenance and adjudication. Keep one-shot new held-out evaluation after candidate/threshold freeze. Continue existing deadline, no-retry, one-request and complete-envelope controls; do not let extra questions silently weaken those constraints.

Recommendation: continue R&D with the exact rich control and independently measured lanes. Reject promotion of the current compact/structured candidates on measured quality. Neither these regressions nor the retained frontiers establish a production-ready model or an irreducible Jev capacity limit.

## New iteration harness: independent offline preflight

The subsequent preflight read `eval/iteration/{profiles,runner,fingerprint}.ts` and `scripts/iterate.ts`, including their relevant imported contract, transport, deadline and checkpoint behavior. Implementation changes were made by the owning agents; this reviewer changed only the assigned `tests/iteration-runner.test.ts` and this report. No review test dispatched an actual model request.

Two supported correctness problems were reported before the frozen screen and corrected by their owners:

- **Decisive unsupported arithmetic:** the first compiler emitted its quantitative question only when parsing was available, and that question asked numeric eligibility rather than necessity. It could therefore clear an unsupported decisive unit comparison using semantic negative support, with no way to distinguish it from an incidental digit-bearing identifier. The corrected compiler always asks quantitative necessity; parser availability controls only the optional selection/proof question. Tests demonstrate decisive unsupported speeds → uncertain, irrelevant `αvβ8` → independent semantic contradiction or omission result, and supported but incomparable dimensions → uncertain.
- **Rounded NLI projection:** a response with contradiction 0, entailment .6 and neutral .4005 was accepted under the intentional .001 rounding tolerance, then produced an invalid projected negative probability of 1.0005. The corrected runner uses `projectNliScores`, normalizes relation features, and retains original raw answers. Its successful result now round-trips through the replay schema with normalized bounded probabilities.

The new focused file contains thirty deterministic tests. Together with the existing iteration profile tests, **51 tests pass**; strict TypeScript checking and lint of the new test file pass. Checked cases include exact requested question/label coverage; unknown or replaced IDs; wrong Choice/Noul kinds; missing labels; non-maximal selected choice; nonfinite/out-of-range Noul output; explicit model mismatch; omitted model remaining unknown; separate Noul marginals; numeric disjoint/overlap/incomparable composition; fake zero-call behavior and unknown token usage; safe HTTP errors with one attempt; a 3000ms abort; and compiled overflow before dispatch despite valid raw snippet budgets. Numeric overlap alone does not create a whole-pair clear answer.

Freeze/checkpoint checks cover transitive value imports, re-exports and literal dynamic imports using the TypeScript AST; type-only references, comments and unrelated parallel calibrator source do not enter that graph. A transitive leaf mutation changes its fingerprint. On the actual current import graph, the preparer/calibrator is not imported by the iteration entrypoint. The source graph is a content/provenance guard, not an access-control boundary or an assertion that arbitrary future computed imports are supported. The existing graph uses static/literal relative dependencies plus locked package dependencies.

An actual fake CLI run verifies explicit mode and spend reservation rejection, exactly 32 profile/pair/pass checkpoint rows, zero provider calls, exclusive fresh outputs, stable runtime fingerprints, and source-snapshot bytes matching every frozen source hash. A separate checkpoint regression verifies that metadata exists before appending, completed rows survive a later failure, and reuse is rejected. The entrypoint limits scheduling to two workers, records per-call reservations separately from measured billing, and checkpoints each completed observation before taking its next job. The runner uses one bounded transport attempt; the payload hash identifies the actual serialized Jev request body.

The scoped runtime graph read at preflight had 22 source/dependency records, fingerprint `87cbafba748eeb41829244bd513c03063fe58c23e8ce123cde6e0813ae3a7887` (`sha256(JSON.stringify(await sourceFingerprint(root)))`). Tests and this report are outside that runtime fingerprint. This is a scoped record, not whole-tree certification or a claim about live results not yet reviewed.

**Known next-iteration prompt issue:** the frozen quantitative rule says to ignore “sample sizes” without qualifying that they must be incidental. Sample size can be the decisive asserted quantity, as in exact final participant counts. The owner was notified; once the screen had started, the agreed disposition was to preserve its frozen source and test a separately frozen wording correction afterward. Do not change a running screen or describe this wording as a code safety failure. More generally, only numbers that do not affect compatibility should be ignored; quantity roles matter. The screen's raw scores can diagnose this behavior but cannot establish it in advance.

The CLI's handling of new research role metadata and any future calibration/held-out workflow remain outside this preflight approval; those need the planned independent follow-up before protected evaluation. Approval here is for the bounded development-screen harness after the two code fixes, with the known prompt limitation retained explicitly. It is not a quality result, production promotion, or authorization to reinterpret native NLI neutral probability as a calibrated service uncertainty distribution.

## Subsequently authorized manifest-access implementation

After the first screen completed, the owner requested implementation of the missing role/locked-policy guards. This reviewer implemented `eval/iteration/access.ts`, the integration in `scripts/iterate.ts`, the shared `candidateSourceHash` helper in `eval/iteration/fingerprint.ts`, and `tests/iteration-access.test.ts`. This is an implementation handoff for the root agent's review, not an independent review of this reviewer's own changes. Other owners implemented the shared fitted-artifact validators and calibration source binding.

The CLI now permits tuning only for explicit `screen`/`fit` roles, independent validation only for `validation`/`locked-holdout`, and unassigned manifests only for original public-dev or synthetic regression. Protection flags must agree with the role. Prepared roles retain original `train` splits and development provenance; the guard never changes them to native test labels. Removing role metadata from an original-train manifest cannot turn it into an allowed regression run.

Locked validation requires `--locked-policy` with a schema-validated fitted scalar or fusion artifact. Diagnostic kinds are refused. The full runtime-source map, exact profile set, training-group hash, complete disjoint inner folds, and held-out group/source/normalized-content disjointness are checked before proceeding. Reversed normalized text pairs also count as training-content overlap. The role header and fitted policy are checked before inspecting locked pairs for validity/disjointness; parsing the containing JSON still necessarily reads those local bytes. No holdout label metrics are calculated to authorize access.

The full-graph binding repairs a pre-freeze gap identified by the root agent: hashing only `profiles.ts` would miss the imported `round-two.ts` prompts and runner feature definitions. `candidateSourceHash` now hashes the sorted actual runtime map; both access and calibration loading use it. Tests mutate an imported prompt or runner hash while preserving `profiles.ts` and verify rejection. Scalar and fusion schemas, their feature semantics and access validation are now part of that runtime graph. Further edits to any of them invalidate the next run; tests/docs remain outside it.

Exact main-policy bytes, kind and SHA are retained with the run freeze before inference. Scalar cutoffs and fusion coefficients/policies are not refitted or reselected by this CLI. Existing raw/default observations remain available for separately applying the frozen offline model; the CLI does not silently present default prediction summaries as fitted-model metrics.

An exclusive `${canonicalManifestPath}.opened.json` marker binds manifest, policy, freeze and profile hashes inside the checkpoint callback, before workers dispatch. It is retained after interruption, errors or partial completion. Canonicalization prevents a symlink alias from accidentally reopening the same manifest. These are local workflow/provenance guards, not protection against a person deliberately copying or forging local files.

Focused tests cover the complete role matrix and original-split preservation, both fitted artifact kinds versus diagnostics, malformed/mismatched policies, full-runtime binding, group/source/content overlap, coherent group/fold hashes, concurrent one-shot opening and symlink aliases. A CLI regression verifies forbidden validation-as-tune access creates neither output freeze nor opening marker. All **95 tests across five iteration suites pass**, along with strict TypeScript, scoped ESLint and formatting. The final handoff graph had 26 records and hash `608dac48d4e9abd9b962642d8be8d0853253d42f8b729c7104ade553fb58a741`; this receipt includes other owners' finalized source and does not imply independent review of their entire delta. The root must capture the actual pre-inference freeze after all owners finish. No paid calls, credentials, dependencies, profile wording, benchmark data, historical artifacts or production settings were changed by this implementation task.
