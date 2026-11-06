# Evaluating contradiction detection with decision models

Status: original comparison measured November 5, 2026; interpretation includes the November 6 calibration follow-up. This is a reproducible research benchmark, not a production qualification or an official dataset leaderboard submission.

Countercheck evaluates a specific job: given a claim and a supplied comparison text, identify whether they make incompatible assertions under overlapping conditions. The repository contains the decision kernel, provider adapters, public-data preparation, bounded live runners, replay support, and redacted measured artifacts. You can inspect and verify the published results without a Countercheck account, model credentials, Cloudflare access, or the original finance documents.

**Disclosure (November 5, 2026):** Nicia has no commercial relationship with any evaluated model provider.

- [What we see](#what-we-see)
- [Why recall is low](#why-recall-is-low-measured-misses-and-separate-calibration)
- [Benchmark coverage and API availability](#benchmark-coverage-and-api-availability)
- [Verify the published numbers offline](#verify-the-published-numbers-offline)
- [Task and decision policy](#task-and-decision-policy)
- [Datasets and adaptations](#datasets-and-adaptations)
- [Execution and scoring](#execution-and-scoring)
- [Nine-model results](#nine-model-results)
- [Run a new evaluation](#run-a-new-evaluation)
- [Evaluate your own model](#evaluate-your-own-model)
- [Evidence, limitations, and data terms](#evidence-limitations-and-data-terms)

## What we see

1. **GLiDE’s large negative-coverage lead over full Decider holds under the shared shipped thresholds and largely closes with model-specific policies.** The shipped-policy gaps are +22.6 percentage points on MultiNLI (paired source-group 95% interval +15.8 to +29.5) and +16.2 on ContractNLI (+10.5 to +22.1). Under the separately fitted, post-hoc primary, the archived gaps shrink to +3.8 and +6.4 points; validation point differences favor Decider by 2.2 and 2.4 points. This is an example of the operating-point distinction in [finding #2](#finding-2-operating-points), not a threshold-independent model advantage.
2. <a id="finding-2-operating-points"></a>**Ranking and shipped behavior differ.** Jev and Luna have almost equal VitaminC AUROC (0.863 and 0.861), while their shipped F1 is 54.9% and 34.1%. The shared conservative cutoff measures a product operating point, not each model’s best achievable decision system. The [GLiDE/Decider coverage comparison](#glide-and-decider-under-shared-and-model-specific-policies) demonstrates the same effect using separately fitted policies.
3. **Close rankings need metric-specific paired intervals.** GLiDE’s finance F1 advantage over Decider is +2.6 points with an interval of 0.0 to +6.4, leaving the difference inconclusive. GLiDE versus Jev on finance (+5.2, +1.1 to +11.6) and Decider versus Jev on VitaminC (+9.9, +2.4 to +20.5) have exploratory F1 intervals above zero on these selected samples.
4. **Jev was the fastest observed route.** It completed all 880 public pairs with a 107 ms successful-call p95. These are provider/kernel measurements across differing routes, not deployed API latency or a capacity test.
5. **No shipped model meets all three application targets together on any public scorecard.** Retrospective recall at ≥95% observed precision is a useful sensitivity view, but the cutoff is selected on these same labels and does not establish validated precision, negative coverage, or a production recommendation.

The original comparison uses native labels and one fixed inference pass. Model-specific policies use separate fit/validation groups; the later negative-budget primary is post hoc. The original between-model intervals are exploratory and pointwise, without multiplicity correction. See [study limitations and dataset reuse](#study-limitations-and-dataset-reuse), the [paired and native-label tables](#paired-intervals-and-native-negative-coverage), and the [recomputable analysis supplement](eval/results/hosted-models-analysis-2026-11-05/README.md).

### GLiDE and Decider under shared and model-specific policies

Each cell is **GLiDE / full Decider**, in percent of native negatives cleared. “Model-specific” means the [follow-up primary](eval/results/calibration-followup-2026-11-06/README.md): frozen per-model positive cutoffs plus negative rules fitted with each model’s shipped-fit false-clear count as its budget.

| Cohort                  | Shared shipped thresholds | Model-specific primary |
| ----------------------- | ------------------------: | ---------------------: |
| MultiNLI, archive       |               82.7 / 60.2 |            83.5 / 79.7 |
| ContractNLI, archive    |               71.1 / 54.9 |            71.1 / 64.7 |
| MultiNLI, validation    |               66.9 / 60.3 |            68.4 / 70.6 |
| ContractNLI, validation |               70.1 / 62.2 |            68.5 / 70.9 |

The large shipped-policy gap is therefore substantially operating-policy dependent. This agrees with Decider’s leading `consistent` scores below the shipped confidence gate. The primary criterion was chosen after the zero-budget validation was seen; it is exploratory and uses different per-model false-clear budgets, not matched risk. The original between-model intervals above describe **only the shipped policy**. These calibrated point differences establish neither equivalence nor a statistically demonstrated reversal.

## Why recall is low: measured misses and separate calibration

Across the five public scorecards there are 279 distinct native positives and 2,511 positive/model observations. Recomputing the archive gives **1,337 missed-positive outcomes: 1,333 completed semantic misses plus four provider errors**. The completed misses comprise 1,191 uncertain answers and 142 false clears. Percentages below use the 1,333 completed misses, not all outcomes.

| Leading raw category among completed misses               | Count | Share |
| --------------------------------------------------------- | ----: | ----: |
| contradiction, strictly largest but below 0.8             |   677 | 50.8% |
| consistent, strictly largest                              |   490 | 36.8% |
| insufficient_context or different_scope, strictly largest |   162 | 12.2% |
| Tied leading categories                                   |     4 |  0.3% |

Raw contradiction scores are below 0.2 for 428 completed misses (32.1%), 0.2–0.5 for 342 (25.7%), and 0.5–0.8 for 563 (42.2%). Uncertainty accounts for 110/128 Jev misses (85.9%), 105/121 GLiDE misses (86.8%) and 106/116 Decider misses (91.4%); these model-level denominators include provider errors. The shared gate therefore suppresses many leading contradiction answers, but this breakdown does not prove how much precision-preserving recall calibration can recover, nor causally separate every harness effect from model capability.

No model caught 68 native positives: VitaminC 25, SciFact 24, MultiNLI 12, ContractNLI four, finance three. The union catches 211/279 (75.6%); that is positive-only coverage, not an implemented ensemble or a precision result. A retrospective non-finance 0.01-grid F1 check places 26/36 model/domain optima in 0.05–0.35, with exceptions up to 0.88. Those are sensitivity diagnostics, not fitted operating policies. The existing optimistic ≥95%-precision frontier’s best model per dataset reaches 54.9% recall on VitaminC, 67.6% on SciFact and 50.0% on ContractNLI; that range does not describe every model.

The approved [separate-group calibration study](eval/results/separate-calibration-2026-11-05/README.md) is complete: **28,800 new assessment attempts**, with a **$57.60 operator reservation**, not measured billing. Each model used 2,512 non-finance fit pairs and 688 source-group-disjoint validation pairs. All policies were frozen before validation; no new inference was performed on the archived 880 pairs. Finance is transfer only. The original archives, original verifier summary, service, profiles, thresholds and default model are unchanged.

On archived probabilities, the fitted policies recover **66/1,337 (4.9%) missed native-positive model–pair outcomes**, while losing **105 existing detections**. Recall improves for four models, declines for four and ties for one. The positive-only oracle union moves from 211/279 to 212/279; it recovers eight previously never-caught pairs but loses seven previously caught pairs. This establishes neither ensemble precision nor a model ceiling. This experiment isolates operating-policy effects; it does not test better prompts, examples or provider-specific formulations.

The following pooled validation results are descriptive and depend on this four-domain mixture. Delta compares the calibrated and shipped rules on the **same new validation outputs**. Errors and uncertainty stay in selected-case denominators. Full domain tables, precision/recall/negative-coverage/false-clear paired intervals and exact policies are in the [versioned archive](eval/results/separate-calibration-2026-11-05/README.md).

| Model         | Precision % |   Recall % | Recall Δ, pp | Negative coverage % | False clears | Completed |
| ------------- | ----------: | ---------: | -----------: | ------------------: | -----------: | --------: |
| Jev 1.14      |  unmeasured | unmeasured |   unmeasured |          unmeasured |   unmeasured |     0/688 |
| Clef          |        98.1 |       24.1 |        -14.6 |                 4.4 |            0 |   688/688 |
| Clef Flash    |        92.1 |       33.0 |         +0.0 |                 1.3 |            0 |   688/688 |
| Clef Omni     |        97.5 |       36.3 |        -11.3 |                 4.0 |            1 |   688/688 |
| Luna          |        94.5 |       32.5 |         -0.9 |                 0.0 |            0 |   688/688 |
| Decision-1    |        97.8 |       42.5 |        -19.3 |                 4.8 |            1 |   688/688 |
| Decider       |        96.0 |       67.5 |         +9.9 |                30.0 |            0 |   688/688 |
| Decider Flash |        96.9 |       59.9 |         +6.6 |                14.9 |            2 |   688/688 |
| GLiDE 27B     |        97.0 |       61.8 |        +15.1 |                15.8 |            2 |   613/688 |

**In the original study, Jev validation was operationally inconclusive:** all 688 attempts returned `provider_invalid_response`, so semantic quality was unmeasured in that run. The raw execution-inclusive recall is zero in the artifact; zero false clears on an all-failed run is not evidence of safety. The [incident report](docs/evaluations/separate-calibration-validation-incident-2026-11-06.md) separates known facts from the unconfirmed credit-exhaustion hypothesis. No retry occurred within that study. GLiDE had 166 fit and 75 validation deadline failures; Clef and Luna each had one fit deadline failure, and full Decider had two. Total failures were 933/28,800.

**No validation or archived model/domain scorecard meets all three point targets.** The zero-fit-false-clear budget disables negative verdicts for Jev and Luna, and pooled validation negative coverage is at most 30% for the other models. Six native-positive false clears still occur in validation despite zero on fit. Calibration therefore does not solve the joint quality problem under this protocol. Native public labels and observed fit precision cannot establish the service-contract release gates. The [proposal](docs/evaluations/separate-calibration-proposal-2026-11-05.md) records the preregistered rules; prompt/exit experiments remain separate and unrun.

Verify the original release and this study offline with `python3 -B scripts/verify-calibration-study.py`. It independently refits policies and checks point metrics against the existing TypeScript metric engine, plus recomputing 81 paired comparisons with 20,000 source-group resamples each. No credentials, raw dataset text or network access are required.

### Follow-up: restored Jev validation and shipped-relative negative budgets

The owner added Jev credits and authorized a separate **688-call / $1.38** validation rerun. It produced **688 successes and 688 HTTP 200 statuses** using the original cohort, prompts, deadline and frozen thresholds. Its [new archive](eval/results/calibration-followup-2026-11-06/README.md) restores Jev's validation evidence without overwriting the failed run or original zero-budget study. Billing is unknown. HTTP-status-only diagnostics retain no request text, credentials or upstream response bodies; the historical failure status remains unknown.

For the replacement primary, each model maximizes fit clear-negative coverage with no more false clears than its shipped balanced-v1 policy made on the same 771 fit positives: Jev 56, Luna 90, Decision-1 41, GLiDE 31, Clef 27, Clef Flash 25, Clef Omni 21, Decider 18 and Decider Flash 11. Counts were independently confirmed. **The primary was chosen after the zero-budget validation was seen.** Parameters use fit outputs only; no later validation-driven grid search or reselection occurs. All positive cutoffs remain frozen. The fixed 0%, 0.5%, 1%, 2% and 5% sensitivity grid is published alongside the primary. No other model was rerun, and finance remains transfer only.

Pooled validation results below use the fresh Jev outputs and the unchanged eight other validation cohorts. This is **post-hoc exploratory sensitivity**, not new confirmatory evidence. Positive precision and recall are invariant across negative budgets. False-clear counts are over 212 selected native-positive validation pairs; negative coverage is over 476 native negatives. Failures remain in denominators.

| Model         | Precision % | Recall % | Negative coverage %, zero → primary | False clears, primary / shipped |
| ------------- | ----------: | -------: | ----------------------------------: | ------------------------------: |
| Jev 1.14      |        96.6 |     54.2 |                          0.0 → 79.4 |                         18 / 17 |
| Clef          |        98.1 |     24.1 |                          4.4 → 49.6 |                          10 / 8 |
| Clef Flash    |        92.1 |     33.0 |                          1.3 → 36.1 |                          10 / 8 |
| Clef Omni     |        97.5 |     36.3 |                          4.0 → 59.7 |                         14 / 13 |
| Luna          |        94.5 |     32.5 |                          0.0 → 58.0 |                         27 / 27 |
| Decision-1    |        97.8 |     42.5 |                          4.8 → 64.9 |                         13 / 13 |
| Decider       |        96.0 |     67.5 |                         30.0 → 74.2 |                           8 / 6 |
| Decider Flash |        96.9 |     59.9 |                         14.9 → 59.2 |                           8 / 5 |
| GLiDE 27B     |        97.0 |     61.8 |                         15.8 → 71.0 |                         10 / 15 |

The replacement restores pooled negative coverage to 36.1–79.4%, showing that the zero constraint drove the earlier collapse. It does not prove that label noise caused those fit false clears, nor guarantee shipped-level errors on validation or each subgroup. **No primary model/domain scorecard meets all three point targets.** The [review response](docs/evaluations/calibration-review-response-2026-11-06.md) narrows the causal claims and supplies thread wording.

GLiDE's 75 validation timeouts include 19 native-positive cases. Its frozen-gate recall is 61.8% including failures, 67.9% conditional on successful positives, and at most 70.8% if all 19 missing positive answers had detected contradiction. Missing answers were not imputed. Different cohorts and serial timing prevent attributing the change from one timeout in 920 original calls to provider slowdown alone.

Verify all three versions offline with `python3 -B scripts/verify-calibration-followup.py`: independent negative refits, 864 metric tables and 162 primary paired comparisons with 20,000 source-group resamples each, plus both preceding studies. No provider credentials, network or raw dataset text are needed.

The [human packet registry](eval/results/calibration-preparation-2026-11-05/packet-registry.json) records 204 blinded items with matched controls. Status: **packet prepared, not yet labelled**. Two independent human annotations and third-human adjudication are required; no AI judgments or new service-contract scores exist. FinDVer text and all annotation views/notes remain in ignored local files. The [recomputable miss breakdown](eval/results/calibration-preparation-2026-11-05/miss-breakdown.json) preserves exact counts and the distinction between completed misses and errors.

## Benchmark coverage and API availability

Benchmark coverage and the public API catalog are separate:

| Models                                        | Evaluation coverage                                 | API and dashboard availability                                          |
| --------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| [Eight exposed hosted models](docs/models.md) | November 5 comparison: 920 scored observations each | Selectable in the invitation-only preview; Jev 1.14 is the default      |
| Hosted Fastino GLiDE 27B (`fastino/GLiDE`)    | Same comparison and inputs: 920 scored observations | Evaluation-runner adapter only; API/dashboard route not yet implemented |
| DeBERTa NLI                                   | Earlier, separate baseline cohort                   | Offline evaluation comparator                                           |
| GLiDE 0.4B, 0.8B, 2B and 9B                   | Pending; no measured results in this repository     | No service integration                                                  |

“Evaluation-only” describes integration scope, not a model-quality tier or a failed qualification decision specific to GLiDE. Every exposed model is also an unqualified evaluation preview. No model met all three proposed quality targets together on the public scorecards.

The Fastino runner uses `FASTINO_API_KEY`. Provisioning that credential on a Worker does not add a model to the service: a runtime adapter, catalog/request-schema entry, dashboard support, documentation and deployed-route verification are also required. Use the [supported-model reference](docs/models.md) and live [`/v1/models`](https://countercheck.nicia.ai/v1/models) catalog to determine what API callers can select. The hosted 27B results do not establish performance for the four smaller sizes.

## Verify the published numbers offline

Python 3.9 or newer and the committed files are sufficient:

```sh
git clone https://github.com/nicia-ai/countercheck.git
cd countercheck
python3 -B scripts/verify-eval-release.py
```

The command verifies artifact hashes and execution-source snapshots, checks identical input identities, labels and text hashes across models, and independently recomputes confusion counts, precision, recall, F1, coverage, AUROC, average precision, Brier scores, latency percentiles, and reported input-token totals. It reads **redacted scoring rows**, not original claims or evidence. It makes no network or model calls.

Expected summary for this release:

```json
{
  "verified_models": 9,
  "verified_observations": 8280,
  "verified_scorecards": 72,
  "identical_inputs_across_models": true,
  "execution_errors": 10,
  "verified_analysis_scorecards": 45,
  "verified_paired_comparisons": 6,
  "bootstrap_replicates_per_comparison": 20000,
  "network_calls": 0,
  "raw_dataset_text_required": false
}
```

There are 63 scored model/dataset runs, plus nine derived finance-subset scorecards. The subset does not add inference calls or independent examples. The separate [post-hoc supplement](eval/results/hosted-models-analysis-2026-11-05/README.md) adds 45 ranking/operating-point rows, 63 native-negative-label slices and six metric-specific paired comparisons. Its declared analysis implementation is replayed deterministically and covered by analytic regression fixtures; this is not an independent second statistical implementation. The original aggregate checks do not independently recompute every older bootstrap interval or diagnostic curve. Verification checks the archived calculations and provenance; it does not reproduce model inference, independently establish vendor hardware or weights, or authenticate the provider's claims about its model.

For a no-credential execution smoke test, install Node.js 24.22.2 and pnpm 11.20.0, then run:

```sh
pnpm install --frozen-lockfile
pnpm eval:smoke
```

This uses a deterministic fake transport and an invented eight-pair fixture. It tests the pipeline, not a model's semantic ability. The smoke runner cleans up its temporary output.

## Task and decision policy

A contradiction means incompatible assertions or guidance about the same subject under overlapping conditions and times. The detector does not decide which statement is true. It does not retrieve evidence, apply an unstated authority or supersession rule, or combine several comparison texts into new premises.

For example, “SSO is included in every plan” conflicts with “SSO is available only on Enterprise.” Two explicitly disjoint versions of a policy can instead have different scope. Restatement, missing support, unrelated assertions, and omission alone are not contradictions. Dates, units, exceptions, quantifiers, negation, and whether a statement is proposed, quoted or rejected matter.

The shipped `balanced-v1` compiler asks one typed Choice question per pair:

| Native choice          | Meaning                                                 |
| ---------------------- | ------------------------------------------------------- |
| `contradiction`        | Incompatible assertions in overlapping scope            |
| `consistent`           | Jointly satisfiable, including restatement and omission |
| `different_scope`      | Explicitly disjoint applicability; takes precedence     |
| `insufficient_context` | Required meaning or applicability cannot be determined  |

The complete policy and criteria are in [the kernel](src/kernel/index.ts). The submitted text is untrusted data, not instructions. Only claim and evidence text enter inference; gold labels, rationale explanations, and scoring metadata do not.

The fixed verdict mapping is:

```text
if P(contradiction) >= 0.8:
    contradiction
else if P(contradiction) <= 0.2 and
        max(P(consistent), P(different_scope)) >= 0.8:
    no_contradiction_detected
else:
    uncertain
```

`uncertain` is a valid completed assessment. It is different from a provider error or an excluded input. A negative result is not proof of consistency. API verdicts belong to individual comparisons; there is no top-level semantic verdict.

These thresholds are shared across the measured models. They were not fitted on this comparison. This measures current shipped-policy behavior, not the best prompt, calibration, or operating point achievable for every model. The baseline uses no few-shot examples. For this balanced policy, Jev, Workers AI, OpenRouter and Fastino receive the same structured state/question/criteria representation, plus their route settings. The OpenAI adapter serializes state and converts questions/choices to its native arrays. Different vendor tokenizers and representations can still differ; a common formulation is not a vendor-optimized comparison.

## Datasets and adaptations

Each model received the same **880 distinct public pairs**, followed by 40 separately reported synthetic diagnostic cases. Four scorecards are reused development samples, not fresh held-out data. FinDVer is a previously scored, untuned public evaluation cohort. These frozen selections do not contain every row of the original corpora.

| Scorecard                                                  | Selected pairs | Native positive / negative | Adaptation and important limits                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | -------------: | -------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [VitaminC](https://github.com/TalSchuster/VitaminC)        |            200 |                   71 / 129 | Combined development data. `REFUTES` is positive; `SUPPORTS` and `NOT ENOUGH INFO` remain separate negative slices. Not an evidence-retrieval task.                                                                                                          |
| [SciFact](https://github.com/allenai/scifact)              |            199 |                   71 / 128 | Each complete gold rationale sentence set is joined in annotated order. `CONTRADICT` is positive; `SUPPORT` is negative. No arbitrary corpus negatives or labels assigned to individual sentences.                                                           |
| [ContractNLI](https://github.com/stanfordnlp/contract-nli) |            199 |                   26 / 173 | All annotated evidence spans, in document order, against the hypothesis. Full-contract labels are transferred to excerpts; definitions or exceptions outside the excerpt can matter. `NotMentioned` cases without evidence are excluded.                     |
| [MultiNLI](https://cims.nyu.edu/~sbowman/multinli/)        |            200 |                   67 / 133 | Development-matched government, telephone and Slate genres. Contradiction is positive; entailment and neutral remain distinct negative slices. This is business-adjacent language, not a workplace-native policy or CRM corpus.                              |
| [FinDVer](https://github.com/yilunzhao/FinDVer)            |             82 |                    44 / 38 | Public testmini information-extraction variant; every annotated paragraph/table is retained, without the gold explanation. Only 82 of 250 IE pairs fit the evidence limit. Previously scored on November 4; untuned evaluation variant, not a fresh holdout. |

“Negative” here means the source dataset's binary non-contradiction projection. In particular, NLI neutral or VitaminC insufficient evidence does not become independently adjudicated truth for the service's four-way semantic contract.

The 40 synthetic cases comprise the [eight-pair smoke fixture](eval/fixtures/synthetic-smoke.json) and [32-pair contract fixture](eval/fixtures/prompt-ablation-contract.json). Four contract cases have an explicit expected `uncertain` result and only a schema-level binary proxy label. They are excluded from binary quality and calibration metrics, while retained in execution and expected-verdict diagnostics.

### Selection, grouping, and length coverage

The API envelope permits a 4 KiB claim, a 2 KiB comparison, and a 16 KiB compiled provider request. Evidence is never shortened to make a case fit.

VitaminC/SciFact selection preserves complete revision/claim groups and uses seeded greedy label-proportion matching. This is **not a uniform or population-representative group sample**. Published diagnostics record its group-size and label-mixture bias. Business preparation uses seeded source-group ordering without label-based ordering. Group identity is retained for uncertainty intervals and future train/validation separation.

The primary finance set keeps every complete individually supported pair. The earlier conservative 23-pair cohort drops an entire source group when one sibling is too long. All 23 occur unchanged within the 82; their scores are derived without new calls. They are not 105 independent finance examples. The broader set retains only 32.8% of IE inputs and remains strongly length-conditioned.

Exact input bytes, adapter versions, seeds, source URLs, original labels, group IDs and SHA-256 values are recorded in the [data provenance](eval/results/hosted-models-2026-11-05/data-provenance.json) and run protocols. See [public dataset preparation](eval/README.md#prepare-the-public-datasets) and [business preparation](eval/business/README.md#prepare-pinned-inputs).

## Execution and scoring

The November 5 run used Node.js 24.22.2, the same kernel and fixed `balanced-v1` policy, one pass, original presentation, one pair per call, and sequential client attempts. Each operation had a 3,000 ms kernel deadline. There were no retries, fallbacks, automatic repacking, or silent truncation.

The original eight-model phase contained 7,360 observations. The appended Fastino phase added 920 on identical input hashes and unchanged shared compiler/kernel/metrics. Three Fastino integration probes are recorded separately and excluded from quality denominators. Together this gives **8,280 scored observations**, including 7,920 public pair observations and 360 synthetic observations.

| Evaluated model         | Requested ID                         | Route                                     |
| ----------------------- | ------------------------------------ | ----------------------------------------- |
| Jev 1.14                | `jev-1.14.0`                         | TypeSafe System One HTTPS                 |
| Clef                    | `clef`                               | Native Cloudflare Workers AI binding      |
| Clef Flash              | `clef-flash`                         | Native Cloudflare Workers AI binding      |
| Clef Omni               | `clef-omni`                          | Native Cloudflare Workers AI binding      |
| GPT-6 Luna Decisions    | `gpt-6-luna`                         | Native OpenAI Decisions API               |
| Decision-1              | `microsoft/microsoft-decision-1`     | OpenRouter Decisions                      |
| Pplx Decider v1.2       | `perplexity/pplx-decider-v1.2`       | OpenRouter Decisions                      |
| Pplx Decider Flash v1.2 | `perplexity/pplx-decider-flash-v1.2` | OpenRouter Decisions                      |
| GLiDE 27B               | `fastino/GLiDE`                      | Fastino System One HTTPS; evaluation-only |

The Clef binding was reached through Wrangler's remote proxy. Other routes used native provider HTTPS interfaces. These are provider/kernel measurements, not authenticated production API latency or a capacity test. The deployed API's nested provider budget is 2,500 ms, distinct from this comparison's 3,000 ms kernel budget. Fixed model order, network variation, mutable upstream aliases and one pass limit conclusions about repeat stability and timing. Timed-out native Cloudflare work can continue upstream.

Requested and reported identities are retained separately. OpenRouter reported reviewed dated snapshots for its three models; Fastino reported `glide_v2`, while its catalog described v2.3 in NVFP4 on a B200. An immutable checkpoint revision was not supplied for every route. Names and metadata do not establish immutable weights. Fastino requests use `store:false` and `thinking:false`; the integration probe observed a `not-stored` retention header. The smaller four GLiDE sizes were not served in the observed API catalog and remain explicitly unrun.

### Denominators are part of the result

Let `TP` be correctly flagged contradictions, `FP` incorrectly flagged native negatives, `TN` correctly cleared native negatives, `Npos` all selected native positives, and `Nneg` all selected native negatives.

| Measure                 | Definition                                                         |
| ----------------------- | ------------------------------------------------------------------ |
| Contradiction precision | `TP / (TP + FP)`                                                   |
| Contradiction recall    | `TP / Npos`; uncertain positives, errors and exclusions are misses |
| F1 with abstention      | `2 × TP / (Npos + TP + FP)`                                        |
| Clear-negative coverage | `TN / Nneg`; uncertainty and errors do not count as clear answers  |
| Definitive coverage     | Fraction of selected rows receiving either definitive verdict      |
| False clears            | Native contradictions confidently returned as no contradiction     |
| Completion              | Valid assessments, including uncertainty, divided by selected rows |

Probability metrics use successful rows with observed probabilities, including uncertain verdicts. Their own denominators are reported; missing distributions are not imputed. AUROC, tie-aware average precision, Brier score, calibration bins and risk/coverage diagnostics complement the operating-point metrics. Native four-way probabilities are preserved separately from the derived binary projection. A forced binary-at-0.5 view is also retained; it is not the shipped abstaining policy.

Wilson intervals assume independent Bernoulli observations. Deterministic source-group bootstrap intervals preserve related pairs and repeated passes together; the recorded default uses 200 resamples. Small cohorts, especially 26 contract positives, make close rankings uncertain. No domain-pooled quality winner or population-wide business accuracy is reported.

Usage reports keep known token subtotals and unknown observations separate. Actual billed cost is unknown. Operator per-call reservations and caps are execution safeguards, not measured prices or vendor-enforced charge limits.

## Nine-model results

F1 values are percentages under the fixed abstaining policy. Successful-call p95 is in milliseconds; errors are shown separately and remain quality misses.

| Model                   | Wikipedia | Science | Contracts | Business-adjacent | Finance | p95 ms | Errors / 880 public pairs |
| ----------------------- | --------: | ------: | --------: | ----------------: | ------: | -----: | ------------------------: |
| Jev 1.14                |      54.9 |    64.8 |      63.4 |              73.6 |    90.0 |    107 |                         0 |
| Clef                    |      54.9 |    52.5 |      47.1 |              57.4 |    42.9 |    787 |                         1 |
| Clef Flash              |      27.0 |    59.6 |      51.4 |              63.3 |    40.0 |    261 |                         0 |
| Clef Omni               |      40.8 |    66.1 |      65.0 |              70.5 |    30.8 |    694 |                         1 |
| GPT-6 Luna Decisions    |      34.1 |    40.9 |      51.3 |              49.4 |    85.7 |    534 |                         2 |
| Decision-1              |      62.6 |    63.0 |      61.8 |              77.9 |    69.6 |    403 |                         0 |
| Pplx Decider v1.2       |      64.8 |    59.6 |      68.3 |              79.6 |    92.7 |    865 |                         3 |
| Pplx Decider Flash v1.2 |      62.5 |    54.0 |      42.4 |              75.2 |    72.5 |    258 |                         2 |
| GLiDE 27B               |      64.2 |    55.4 |      68.3 |              76.4 |    95.2 |    242 |                         1 |

All selected inputs fit the evaluated envelope. There were ten execution errors, retained without retry, and zero envelope exclusions in the scored run. Dataset preparation exclusions, particularly the finance length funnel, are separate from that zero.

### Ranking and threshold sensitivity

Each cell is **AUROC / average precision / retrospective recall at ≥95% observed precision (%)**. AUC/AP use successful rows with probabilities, including uncertain verdicts; the complete per-cell probability denominators and errors are in the [supplement](eval/results/hosted-models-analysis-2026-11-05/README.md#ranking-and-shipped-behavior). Errors remain misses in recall’s full native-positive denominator. The third number is an optimistic same-sample threshold sweep with tied scores grouped, not held-out performance or a deployment cutoff.

| Model                   |            Wikipedia |              Science |            Contracts |    Business-adjacent |              Finance |
| ----------------------- | -------------------: | -------------------: | -------------------: | -------------------: | -------------------: |
| Jev 1.14                | 0.863 / 0.806 / 28.2 | 0.968 / 0.926 / 67.6 |  0.927 / 0.739 / 7.7 | 0.977 / 0.966 / 83.6 | 0.963 / 0.977 / 90.9 |
| Clef                    | 0.761 / 0.691 / 11.3 | 0.950 / 0.900 / 28.2 | 0.952 / 0.841 / 50.0 | 0.957 / 0.940 / 65.7 | 0.939 / 0.957 / 77.3 |
| Clef Flash              |  0.746 / 0.605 / 0.0 | 0.959 / 0.920 / 35.2 | 0.949 / 0.834 / 42.3 | 0.982 / 0.969 / 85.1 | 0.861 / 0.914 / 70.5 |
| Clef Omni               | 0.774 / 0.688 / 22.5 | 0.965 / 0.936 / 56.3 | 0.980 / 0.886 / 26.9 | 0.983 / 0.966 / 79.1 | 0.927 / 0.949 / 72.7 |
| GPT-6 Luna              |  0.861 / 0.779 / 8.5 |  0.819 / 0.751 / 2.8 | 0.854 / 0.624 / 11.5 | 0.876 / 0.851 / 58.2 | 0.956 / 0.970 / 88.6 |
| Decision-1              | 0.870 / 0.823 / 38.0 | 0.933 / 0.872 / 14.1 | 0.885 / 0.699 / 30.8 | 0.970 / 0.944 / 65.7 | 0.903 / 0.922 / 63.6 |
| Pplx Decider v1.2       | 0.931 / 0.895 / 54.9 | 0.952 / 0.913 / 33.8 | 0.964 / 0.861 / 46.2 | 0.987 / 0.975 / 86.6 | 0.965 / 0.981 / 93.2 |
| Pplx Decider Flash v1.2 | 0.859 / 0.823 / 36.6 | 0.925 / 0.874 / 31.0 | 0.955 / 0.786 / 30.8 | 0.984 / 0.966 / 67.2 | 0.968 / 0.982 / 95.5 |
| GLiDE 27B               | 0.918 / 0.885 / 47.9 | 0.964 / 0.931 / 53.5 | 0.977 / 0.910 / 50.0 | 0.980 / 0.964 / 79.1 | 0.964 / 0.981 / 95.5 |

The scalar sweep selects the largest recall with at least 95% **observed** precision among nonempty threshold selections on the same labels. It can overfit, and it does not select the negative gate or jointly satisfy all three application targets. The sweep uses raw contradiction scores, matching the shipped positive gate; AUROC/AP use archived normalized binary probabilities. A zero denotes no recovered positives at a qualifying observed operating point; full threshold/TP/FP records distinguish an absent qualifying threshold. AUC/AP evaluate native binary ranking, not the correctness of the service’s four-way semantics. The archive’s existing risk–coverage diagnostic uses forced binary decisions at 0.5; it must not be presented as the shipped four-way abstention policy’s risk curve.

### Paired intervals and native-negative coverage

These are the original **shared shipped-policy** comparisons; their intervals do not describe the [model-specific primary](#glide-and-decider-under-shared-and-model-specific-policies). First minus second; differences and intervals are in percentage points. Each bootstrap resamples complete recorded source groups, including all pairs and both models together. There are 20,000 resamples per comparison, with the seed and valid-replicate counts in the supplement. Intervals are pointwise, conditional on these selected groups and one fixed inference pass, with no correction for the post-hoc selection of contrasts or multiple comparisons.

| Dataset     | First − second                | Groups | F1 difference [95% interval] | Recall difference [95% interval] | Negative coverage difference [95% interval] |
| ----------- | ----------------------------- | -----: | ---------------------------: | -------------------------------: | ------------------------------------------: |
| findver     | GLiDE 27B − Pplx Decider v1.2 |     59 |               2.6 [0.0, 6.4] |                  4.5 [0.0, 10.9] |                           0.0 [-10.3, 10.3] |
| findver     | GLiDE 27B − Jev 1.14          |     59 |              5.2 [1.1, 11.6] |                  9.1 [2.0, 18.9] |                           10.5 [-3.0, 24.3] |
| contractnli | GLiDE 27B − Pplx Decider v1.2 |     20 |               0.0 [0.0, 0.0] |                   0.0 [0.0, 0.0] |                           16.2 [10.5, 22.1] |
| mnli        | GLiDE 27B − Pplx Decider v1.2 |     69 |             -3.3 [-8.7, 1.7] |                -4.5 [-11.3, 1.5] |                           22.6 [15.8, 29.5] |
| vitaminc    | Pplx Decider v1.2 − Jev 1.14  |     25 |              9.9 [2.4, 20.5] |                  9.9 [1.6, 19.7] |                             0.8 [-5.0, 6.6] |
| mnli        | Pplx Decider v1.2 − Jev 1.14  |     69 |             6.1 [-0.7, 13.4] |                  9.0 [0.0, 17.9] |                        -21.1 [-28.5, -13.5] |

Equal contract F1/recall on this sample does not establish equivalence. Zero observed false positives in a small finance cohort cannot establish population precision, even when a bootstrap interval degenerates. Positive-only paired tests address recall, not F1; intervals must match the metric being discussed.

Native-negative coverage below is **cleared / selected (%)**. A native neutral/NEI annotation is not an independently adjudicated service `insufficient_context` label.

| Model                   | VitaminC SUPPORTS | VitaminC NEI | MNLI entailment | MNLI neutral | ContractNLI Entailment |
| ----------------------- | ----------------: | -----------: | --------------: | -----------: | ---------------------: |
| Jev 1.14                |     90/100 (90.0) | 12/29 (41.4) |    65/72 (90.3) | 43/61 (70.5) |         111/173 (64.2) |
| Clef                    |     69/100 (69.0) |  8/29 (27.6) |    62/72 (86.1) | 13/61 (21.3) |          59/173 (34.1) |
| Clef Flash              |     34/100 (34.0) |  4/29 (13.8) |    44/72 (61.1) | 11/61 (18.0) |          26/173 (15.0) |
| Clef Omni               |     64/100 (64.0) | 11/29 (37.9) |    60/72 (83.3) | 10/61 (16.4) |          82/173 (47.4) |
| GPT-6 Luna              |     80/100 (80.0) | 14/29 (48.3) |    58/72 (80.6) | 31/61 (50.8) |          67/173 (38.7) |
| Decision-1              |     87/100 (87.0) | 10/29 (34.5) |    69/72 (95.8) | 32/61 (52.5) |          83/173 (48.0) |
| Pplx Decider v1.2       |     95/100 (95.0) |  8/29 (27.6) |    64/72 (88.9) | 16/61 (26.2) |          95/173 (54.9) |
| Pplx Decider Flash v1.2 |     79/100 (79.0) |  4/29 (13.8) |    58/72 (80.6) |  9/61 (14.8) |          46/173 (26.6) |
| GLiDE 27B               |     96/100 (96.0) | 14/29 (48.3) |    67/72 (93.1) | 43/61 (70.5) |         123/173 (71.1) |

GLiDE and Jev each clear 43/61 MNLI-neutral pairs. Of Decider’s 44 uncertain neutral responses, 33 favor `consistent`, eight favor `insufficient_context`, and three favor `contradiction`. Most of those abstentions therefore reflect inadequate confidence in the leading consistent answer, rather than a different leading category. ContractNLI’s selected negatives are all entailments: GLiDE clears 123 versus Decider’s 95. The [full native-label table](eval/results/hosted-models-analysis-2026-11-05/README.md#negative-coverage-by-native-label) includes science, finance, errors and false positives.

### Study limitations and dataset reuse

- **Repeatedly examined data:** VitaminC, SciFact, ContractNLI and MultiNLI are development samples. Prior prompt/quality experiments inspected development data; they are not fresh test evidence. FinDVer’s public testmini cohort was already scored with Jev, Clef, Decider and DeBERTa on November 4 and remained untuned. Its original protocol value `purpose: locked-test` is preserved as historical metadata, not a fresh-holdout claim.
- **Staged model addition:** the eight-model protocol was recorded at 19:33 UTC and its analysis provenance at 20:11 UTC on November 5. The Fastino protocol followed at 20:15 UTC, before its scored inference but after the eight-model results were available. This is a disclosed extension, not one prospectively specified nine-model study.
- **Single pass:** original presentation only, without claim/evidence reversal or option-order robustness tests in this comparison. Earlier Jev repeats showed output variation despite identical payload hashes; this run does not measure that variation for all models.
- **Training exposure:** these are public corpora, including widely used NLI/fact-verification benchmarks. Exposure in provider training is unknown; unseen-to-model generalization is not claimed. DeBERTa’s disclosed MultiNLI training is reported separately.
- **Prompt development:** the initial five-arm prompt-ablation study used Jev only. Later quality iterations also explored Decider prompts and composition. A shared compiler and fixed policy do not establish best achievable provider performance or isolate the causal effect of prompt format.
- **Task and selection:** native labels, oracle rationale/excerpt adaptations, source-group sampling and length-conditioned finance coverage limit generalization. ContractNLI has 20 recorded source groups and VitaminC 25. The service still needs human-adjudicated pairs matching its four-way contract.

The next prospective comparison should allocate comparable model-adaptation budgets, fit thresholds only on development groups, freeze choices, and evaluate disjoint untouched groups with paired repeats and order perturbations. It must track precision, recall, false clears, negative coverage, errors and operational limits together. The existing retrospective threshold frontier is not that validation.

## Run a new evaluation

### 1. Prepare and pin the inputs

With Node/pnpm installed, these commands download public sources and prepare data; they do not call models:

```sh
pnpm eval:prepare --dataset vitaminc --variant combined --download --split dev \
  --max-pairs 200 --out eval/data/vitaminc-combined-dev-200.json
pnpm eval:prepare --dataset scifact --download --split dev \
  --max-pairs 200 --out eval/data/scifact-dev-200.json
```

Use the [business preparation commands](eval/business/README.md#prepare-pinned-inputs) for ContractNLI, MultiNLI and FinDVer. Data stays in ignored `eval/data/`. Outputs are exclusive: use a new path if a manifest already exists. Upstream URLs can change; compare reconstructed manifest/source hashes with the published protocol before calling a rerun an exact reproduction. Keep whole related groups together when making train/validation/test splits.

The frozen full-matrix runner expects the filenames listed in its protocol, including all business inputs. A single-dataset run can use any valid manifest path. Preparing a new manifest or changing its cap is a different input cohort; report its achieved size and exclusions.

### 2. Supply your own provider credential

| Runner selection                                          | Credential/configuration                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `--backend hosted --model jev-1.14.0`                     | `TYPESAFE_API_KEY`                                                         |
| `--backend hosted --model gpt-6-luna`                     | `OPENAI_API_KEY`                                                           |
| `--backend hosted --model microsoft/microsoft-decision-1` | `OPENROUTER_API_KEY`                                                       |
| Either Pplx ID with `--backend hosted --model …`          | `OPENROUTER_API_KEY`                                                       |
| Any Clef ID with `--backend hosted --model …`             | Your Cloudflare account, named Wrangler auth profile, and the `AI` binding |
| `--backend fastino`                                       | `FASTINO_API_KEY`; pins `fastino/GLiDE`                                    |

HTTPS-provider evaluation does not require the Countercheck dashboard, invitation, D1 database, email service, or a Nicia account. Keep credentials in your environment or secret manager, not command arguments, source, predictions or reports. A provider credential is different from a Countercheck API key.

For Clef, a fork must configure its own Cloudflare account in `wrangler.jsonc` and activate its own Wrangler profile. The checked-in account/resources belong to the maintainer deployment. The native `AI` binding accesses remote resources and can incur usage charges even in local development. The legacy `clef` backend instead uses REST with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; do not equate its transport timing with the measured native-binding route.

### 3. Make a bounded live run

After setting the relevant environment credential:

```sh
pnpm eval:run --backend hosted --model jev-1.14.0 \
  --manifest eval/data/scifact-dev-200.json --profile balanced-v1 --live \
  --max-calls 199 --cost-per-call-usd .002 --max-spend-usd .398 \
  --out eval/reports/my-jev-scifact
```

The dollar figures are illustrative **operator reservations**, not a quoted Jev price. The runner checks planned calls and reservation totals before dispatch. Every failure still consumes an attempted call. Select a fresh output prefix; existing checkpoints block overwrite and accidental repeat spending.

For the existing eight exposed models, after preparing every required manifest and configuring each provider:

```sh
pnpm exec tsx scripts/run-hosted-matrix.ts --live --max-calls 7360 \
  --cost-per-call-usd .002 --max-spend-usd 15 --out eval/reports/my-hosted-matrix
```

For the separate hosted GLiDE phase on the same published inputs:

```sh
pnpm exec tsx scripts/run-fastino-benchmark.ts --live \
  --baseline eval/results/hosted-models-2026-11-05 \
  --max-calls 920 --cost-per-call-usd .002 --max-spend-usd 2 \
  --out eval/reports/my-glide-matrix
```

`--prior-probes` defaults to zero. Set it only for integration probes actually performed and increase the call cap accordingly. The published Fastino run records three earlier probes; it does not repeat them in its quality denominators.

The runner writes and syncs predictions after each completed batch, before the next request. Interrupted output remains available but is not silently retried or resumed. A complete checkpoint can be replayed. An incomplete checkpoint fails exact-coverage validation; repair or identify a separate cohort explicitly rather than dropping hard cases.

`--passes`, `--presentation` and `--batch-size` support repeated, order and bundle experiments. The reported nine-model table used one pass, original presentation and batch size one. Bundles contain identical claims and are atomic submissions; an oversized member or compiled body excludes the whole submitted batch, without repacking. These are separate robustness/coverage experiments, not interchangeable isolated-pair scores. See [`pnpm eval:run --help`](eval/README.md) and [the runner guide](eval/README.md).

## Evaluate your own model

### Bring a scorer through replay

You can first exercise export and replay with committed synthetic data and no model calls:

```sh
pnpm eval:run --backend fake --manifest eval/fixtures/synthetic-smoke.json \
  --out eval/reports/my-format-demo
pnpm eval:run --backend replay --manifest eval/fixtures/synthetic-smoke.json \
  --predictions eval/reports/my-format-demo.predictions.jsonl \
  --out eval/reports/my-format-demo-replay
```

This is a format demonstration, not a model result. Both prefixes must be fresh. For a real scorer, replace the predictions with your measured outputs and retain exact pair/pass coverage and provenance.

A scorer can use a different vendor API, an open-weight model, a local classifier, or a new decision composition. Write one prediction per manifest pair and pass, and bind the file to the exact input manifest hash. The runner accepts JSONL or a JSON array.

An illustrative native four-way prediction is:

```json
{
  "pair_id": "your-exact-manifest-pair-id",
  "pass": 1,
  "status": "ok",
  "verdict": "contradiction",
  "raw_scores": {
    "contradiction": 0.9,
    "consistent": 0.08,
    "different_scope": 0.01,
    "insufficient_context": 0.01
  },
  "probabilities": {
    "contradiction": 0.9,
    "no_contradiction": 0.09,
    "insufficient_context": 0.01
  },
  "latency_ms": 12.3,
  "model": "your-model-and-checkpoint"
}
```

Those numbers illustrate the format; they are not measured output. Probabilities must be finite, normalized and agree with their native projection. Preserve actual question/pair identities and supply the verdict policy actually used. Measure latency and record its scope: offline batch-forward timing is not hosted request latency. Omit unavailable token/cost fields rather than writing zero.

Create `my-predictions.jsonl.metadata.json` with the exact manifest SHA-256 and descriptive provenance. `manifest_sha256` is required for public-data replay; add model/checkpoint, training exposure, source protocol, device/runtime and the decision rule so another evaluator can interpret the result.

```sh
pnpm eval:run --backend replay --manifest eval/data/scifact-dev-200.json \
  --predictions my-predictions.jsonl --out eval/reports/my-model-scifact
```

An error row has `status: "error"`, a measured `latency_ms`, and optionally a stable `error_code`; it has **no verdict or probability fields**. An unsupported input uses `status: "excluded"`. Preserve both in the cohort. Duplicate, missing, extra or mismatched pair/pass identities fail replay validation.

For a three-way NLI model, retain `nli_probabilities` for contradiction/entailment/neutral and the scorer's native argmax separately. The binary projection may merge entailment and neutral for contradiction-vs-rest scoring; do not relabel neutral as the service's `insufficient_context` or fabricate a four-way distribution. The [pinned local DeBERTa scorer](eval/deberta.py) demonstrates this path. Its disclosed SNLI/MultiNLI training makes MultiNLI an in-domain reference, not evidence of zero-shot transfer.

### Add a live provider or composition

Implement [the small `DecisionProvider` interface](src/providers/types.ts), then connect it through [evaluation providers](eval/providers.ts). Use the bounded [transport](src/providers/transport.ts) and [response validators](src/providers/response.ts) where applicable. Adapters must preserve the full task, validate answer names and labels, reject malformed/incomplete responses, retain native model identity when supplied, and avoid retries, fallback or truncation. If native conversion changes body size, preflight the actual wire representation through `validateInput`.

The kernel is independent of Cloudflare, database and account code. The evaluation-only adapter path does not require adding a model to the public API's closed request enum. GLiDE and offline DeBERTa are examples of evaluation comparators, not public service models.

To make a model or prompt result useful to others, report the exact source and model revisions, input selection and exclusions, training exposure, prompt and threshold policy, errors, abstention, probability-metric denominators, and latency scope. Freeze choices before inference. If tuning, split by shared source/template groups, tune only on development groups, and keep validation and locked test use distinct. Retain failed experiments alongside successful ones.

## Evidence, limitations, and data terms

The [eight-model archive](eval/results/hosted-models-2026-11-05/README.md) preserves its pre-inference protocol, sources, hashes, native-label slices and detailed metrics. The [Fastino extension](eval/results/hosted-models-with-glide-2026-11-05/README.md) preserves a separate pre-inference protocol and the identical shared inputs. Execution code is snapshotted at its measured version; post-inference analysis source provenance is recorded separately. The offline verifier checks committed calculations without requiring ignored raw reports. Repeating vendor inference additionally requires reconstructed original inputs and provider access, and mutable upstream models need not return identical results.

All claim/evidence text is removed from the newest scoring archives and replaced with hashes/byte lengths. Original finance reports and raw pair-containing reports stay in ignored local storage; all 164 distinct finance claim/evidence strings were checked against the published archive files and none was present. Redacted scoring rows support metric verification, not reconstruction of withheld text or a new canonical input manifest. Older archives can contain permitted non-finance public text and original third-party terms.

Dataset code licenses, data terms, model weights and repository code are separate concerns:

- VitaminC: retain Schuster, Fisch and Barzilay's attribution and the [data terms](https://github.com/TalSchuster/VitaminC/blob/eb532922b88b199df68ed26afeb58dca5501b52f/DATA_LICENSE), including Wikipedia/FEVER provenance.
- SciFact: attribute Wadden and colleagues; [claims/annotations and abstract terms differ](https://github.com/allenai/scifact/blob/68b98a56d93e0f9da0d2aab4e6c3294699a0f72e/LICENSE.md).
- ContractNLI: retain the dataset's CC BY 4.0 terms and [archived license](eval/results/business-2026-11-04/licenses/contractnli/LICENSE).
- MultiNLI: attribute Williams, Nangia and Bowman. The selected OANC-derived genres have [documented permissions](https://cims.nyu.edu/~sbowman/multinli/); do not generalize that to every genre in the full archive.
- FinDVer: the repository declares MIT, while separate redistribution terms for the underlying issuer-report text have not been established here. This release does not redistribute that text.

Exact source/terms URLs and hashes are in [data provenance](eval/results/hosted-models-2026-11-05/data-provenance.json); [the dataset landscape](docs/evaluations/business-dataset-landscape.md) explains the adaptations and deferred sources. The project's original code and documentation are licensed under [Apache 2.0](LICENSE); see [DATA_NOTICE.md](DATA_NOTICE.md) for the separate third-party data and model terms.

Public native labels, oracle excerpts, a length-conditioned finance subset, synthetic fixtures, possible upstream training exposure, and one repeated-policy pass do not establish general business accuracy or production readiness. A human-adjudicated pair corpus matching the service contract, disjoint validation, and deployed capacity/reliability measurements remain separate qualification work. This repository makes those boundaries visible so evaluators and model builders can improve the system without moving the goalposts.

For a related task, [admission-decision-eval](https://github.com/nicia-ai/admission-decision-eval) measures request-level admission decisions, including restatement and prior-edit effects. Its aggregate labels are not pair-level contradiction gold and its scores should not be combined with the scorecards here.
