# Countercheck model comparison — November 5, 2026

Status: original November 5 measurements independently verified; interpretation updated with the November 6 calibration follow-up. Evaluation only; service defaults and the exposed model catalog are unchanged.

**GLiDE’s large negative-coverage lead over full Decider is a shipped-threshold finding that largely closes under model-specific policies.** The original shared policy gives GLiDE leads of 22.6 percentage points on MultiNLI and 16.2 on ContractNLI, with paired intervals excluding zero. Under the separately fitted, post-hoc primary, those archived leads shrink to 3.8 and 6.4 points; validation point differences favor Decider by 2.2 and 2.4 points. This illustrates [ranking versus operating-point behavior](../../EVALUATION.md#finding-2-operating-points), not a threshold-independent model advantage. The original intervals apply only to the shared policy. Finance F1 versus Decider remains inconclusive. **Jev 1.14 remains the latency-oriented default**: it was the fastest route in the original pass and completed every public pair.

The [post-hoc analysis supplement](../../eval/results/hosted-models-analysis-2026-11-05/README.md) adds metric-specific paired intervals, native-label coverage, AUROC/AP and explicitly retrospective recall at ≥95% observed precision. The [standalone evaluation guide](../../EVALUATION.md#november-5-nine-model-comparison) leads with the findings and the dataset-reuse disclosures.

No model met all three proposed quality targets together on any of the five public scorecards: contradiction precision at least 95%, recall at least 90%, and clear-negative coverage at least 85%.

We ran **8,280 scored evaluations**: nine models, each on 880 existing frozen public pairs and 40 synthetic diagnostic cases. The original eight-model phase completed first; GLiDE was appended with the same input hashes, kernel, prompt, threshold policy and metrics. Three Fastino integration probes are recorded separately. There were ten execution errors in the scored runs, zero envelope exclusions, no retries and no truncated evidence.

Later evidence: the [five-model Nace extension](../../eval/results/nace-2026-11-06/README.md) and [Max/Finance calibration follow-up](../../eval/results/nace-calibration-2026-11-06/README.md) append separate measurements. This dated report retains the original nine-model scope; see [the current evaluation guide](../../EVALUATION.md) for the combined findings.

## Results under the shipped policy

All models use `balanced-v1`: flag contradiction at a contradiction probability of at least 0.8; clear a comparison only when contradiction probability is at most 0.2 and one negative-relation label has at least 0.8 probability; otherwise abstain. This measures the policy shipped in the API; GLiDE uses that policy through its evaluation-only adapter. It is not the best achievable prompt or calibration for each model.

F1 below is a percentage and counts positive uncertainty and execution errors as missed contradictions. Latency is the 95th percentile of successful **provider/kernel** calls, not the full authenticated API. Each domain stays separate.

| Model                   | Wikipedia (200) | Science (199) | Contracts (199) | Business-adjacent (200) | Finance (82) | p95 latency |
| ----------------------- | --------------: | ------------: | --------------: | ----------------------: | -----------: | ----------: |
| Jev 1.14                |            54.9 |          64.8 |            63.4 |                    73.6 |         90.0 |      107 ms |
| Clef                    |            54.9 |          52.5 |            47.1 |                    57.4 |         42.9 |      787 ms |
| Clef Flash              |            27.0 |          59.6 |            51.4 |                    63.3 |         40.0 |      261 ms |
| Clef Omni               |            40.8 |          66.1 |            65.0 |                    70.5 |         30.8 |      694 ms |
| GPT-6 Luna Decisions    |            34.1 |          40.9 |            51.3 |                    49.4 |         85.7 |      534 ms |
| Decision-1              |            62.6 |          63.0 |            61.8 |                    77.9 |         69.6 |      403 ms |
| Pplx Decider v1.2       |            64.8 |          59.6 |            68.3 |                    79.6 |         92.7 |      865 ms |
| Pplx Decider Flash v1.2 |            62.5 |          54.0 |            42.4 |                    75.2 |         72.5 |      258 ms |
| GLiDE 27B (Fastino)     |            64.2 |          55.4 |            68.3 |                    76.4 |         95.2 |      242 ms |

## What matters for business use

Each cell below is **precision / recall / clear-negative coverage**, in percent. High precision with low recall or low negative coverage means a model is being selective, not that it answers most inputs correctly and definitively.

| Model                   |           Contracts |   Business-adjacent |             Finance |
| ----------------------- | ------------------: | ------------------: | ------------------: |
| Jev 1.14                |  86.7 / 50.0 / 64.2 | 100.0 / 58.2 / 81.2 | 100.0 / 81.8 / 71.1 |
| Clef                    | 100.0 / 30.8 / 34.1 | 100.0 / 40.3 / 56.4 | 100.0 / 27.3 / 55.3 |
| Clef Flash              | 100.0 / 34.6 / 15.0 | 100.0 / 46.3 / 41.4 | 100.0 / 25.0 / 36.8 |
| Clef Omni               |  92.9 / 50.0 / 47.4 |  97.4 / 55.2 / 52.6 | 100.0 / 18.2 / 76.3 |
| GPT-6 Luna Decisions    |  76.9 / 38.5 / 38.7 | 100.0 / 32.8 / 66.9 | 100.0 / 75.0 / 78.9 |
| Decision-1              |  58.6 / 65.4 / 48.0 |  95.7 / 65.7 / 75.9 |  96.0 / 54.5 / 65.8 |
| Pplx Decider v1.2       |  93.3 / 53.8 / 54.9 |  97.8 / 67.2 / 60.2 | 100.0 / 86.4 / 81.6 |
| Pplx Decider Flash v1.2 | 100.0 / 26.9 / 26.6 |  97.6 / 61.2 / 50.4 | 100.0 / 56.8 / 76.3 |
| GLiDE 27B (Fastino)     |  93.3 / 53.8 / 71.1 |  97.7 / 62.7 / 82.7 | 100.0 / 90.9 / 81.6 |

GLiDE detected **40 of 44 finance contradictions**, with zero false positives, and cleared **31 of 38 native negatives**. That meets the precision and recall point targets on this small cohort, but its 81.6% negative coverage misses the 85% target. It tied full Decider's contract detection (14 true positives, one false positive), while clearing 71.1% of contract negatives versus Decider's 54.9%.

Under the shared shipped policy, full Decider caught more MultiNLI contradictions than GLiDE (45 versus 42), while GLiDE cleared more native negatives (110 versus 80). The [model-specific comparison](#model-specific-policy-follow-up) substantially narrows the negative-coverage gap; this tradeoff depends on the operating policy. Jev remained competitive while materially faster, with a 107 ms successful-call p95 versus GLiDE's 242 ms and full Decider's 865 ms on these routes.

Decision-1 had the highest contract recall, 65.4%, but produced 12 false positives, leaving precision at 58.6%. GPT-6 Luna Decisions did not improve on Jev in any of these five F1 scorecards with the current formulation. Clef Flash abstained on 164 of 199 contract cases; its perfect observed contradiction precision reflects only nine positive detections. The Clef variants' good ranking metrics on some slices do not translate into sufficient definitive-answer coverage under the shared thresholds.

## Model-specific policy follow-up

Each cell is **GLiDE / full Decider** native-negative coverage, in percent. The primary uses frozen per-model positive cutoffs and negative rules fitted to each model’s shipped-fit false-clear count budget. The primary criterion was chosen after viewing the zero-budget validation; this is post-hoc exploratory sensitivity, not matched-risk or confirmatory evidence.

| Cohort                  | Shared shipped thresholds | Model-specific primary |
| ----------------------- | ------------------------: | ---------------------: |
| MultiNLI, archive       |               82.7 / 60.2 |            83.5 / 79.7 |
| ContractNLI, archive    |               71.1 / 54.9 |            71.1 / 64.7 |
| MultiNLI, validation    |               66.9 / 60.3 |            68.4 / 70.6 |
| ContractNLI, validation |               70.1 / 62.2 |            68.5 / 70.9 |

Most of the large shipped-policy gap closes under these model-specific rules. Decider’s leading `consistent` scores below the original gate are consistent with this operating-policy effect. The point estimates do not establish model equivalence or a statistically demonstrated reversal. See the [full follow-up metrics and within-model paired intervals](../../eval/results/calibration-followup-2026-11-06/README.md); the original between-model intervals below remain specific to the shipped policy.

## Paired evidence and native-label coverage

For the original **shared shipped policy**, the supplementary analysis resamples complete recorded source groups and both models together, with 20,000 deterministic resamples. Differences below are percentage points, with exploratory pointwise 95% percentile intervals and no multiplicity correction:

| Comparison                   | Metric                  | Difference [95% interval] |
| ---------------------------- | ----------------------- | ------------------------: |
| GLiDE − Decider, MultiNLI    | Clear-negative coverage |      +22.6 [+15.8, +29.5] |
| GLiDE − Decider, ContractNLI | Clear-negative coverage |      +16.2 [+10.5, +22.1] |
| GLiDE − Decider, finance     | F1                      |          +2.6 [0.0, +6.4] |
| GLiDE − Jev, finance         | F1                      |        +5.2 [+1.1, +11.6] |
| Decider − Jev, VitaminC      | F1                      |        +9.9 [+2.4, +20.5] |

These intervals are conditional on the selected groups and one inference pass. A positive-only paired test evaluates recall, not F1; it cannot replace the corresponding F1 interval. Equal observed detections do not establish population equivalence.

GLiDE and Jev each clear 43/61 MultiNLI-neutral cases, versus Decider’s 16/61. Of Decider’s 44 uncertain neutral responses, 33 favor `consistent` and eight favor `insufficient_context`; most fail the confidence gate rather than choosing a different leading category. All 173 selected ContractNLI negatives are entailments, and GLiDE clears 123 versus Decider’s 95. Clef Flash clears 44/72 MultiNLI entailments (61.1%), so high entailment coverage is not universal. Full native-label and ranking/threshold tables remain in the linked supplement and main guide.

## Interpretation and next experiment

Model selection alone does not close the quality gap. Many missed positives are abstentions. For example, Jev's contract misses comprise 11 uncertain positives and two false clears; GLiDE's comprise 12 uncertain positives and no false clears. These are different failure modes from Decision-1's false-positive problem. Ranking quality and calibrated operating points need separate treatment: Clef Omni's contract AUROC is 0.980, despite only 50% recall at the shipped cutoff.

The [separate-group calibration study and follow-up](../../eval/results/calibration-followup-2026-11-06/README.md) have now fitted model-specific operating policies and assessed disjoint validation groups, preserving the four-way outputs. Positive thresholds were frozen before validation; the later shipped-relative negative-budget primary was chosen post hoc. The resulting coverage comparison demonstrates the cost of reading a shared-policy difference as an intrinsic model advantage. Prompt or composition changes should be evaluated separately from threshold changes. The original measured pass did not fit thresholds. The original supplement computes an optimistic same-sample threshold frontier, including finance, purely as a post-hoc sensitivity diagnostic; those cutoffs are not validated deployment recommendations. A lower cutoff is not established as a sufficient fix. A human-adjudicated pair dataset matching the API's contract is still required for release qualification.

Jev remains the latency-oriented default in the evaluation preview. The shared-policy negative-coverage gap alone does not support promoting GLiDE over full Decider; the comparison depends on operating policies, false-clear budgets and deadlines. No default or model promotion is performed by this benchmark work.

## Scope, evidence, and reproduction

Four public scorecards reuse development samples. Finance is a previously scored, untuned public cohort: Jev, Clef, Decider and DeBERTa scored it on November 4. The original `locked-test` protocol field is historical metadata, not evidence of a fresh holdout. The Fastino protocol followed the available eight-model results; each phase was declared before its own scored inference, rather than as one prospective nine-model protocol. These public corpora may have appeared in model training. The initial five-arm prompt-ablation study used Jev only; later quality iterations also explored Decider. No provider-optimized comparison or input-order robustness test was performed here.

The suite contains VitaminC combined development pairs, SciFact complete gold rationale sets, ContractNLI complete annotated excerpts, MultiNLI government/telephone/Slate, and the 82 FinDVer testmini IE pairs that fit the current evidence limit. It does not run every row of every original corpus. The old 23-pair finance cohort is a subset of the 82 and is reported without duplicate calls. The finance cohort covers only 32.8% of the 250 IE cases, without truncation. Full-contract labels transferred to rationale excerpts can omit definitions or exceptions; business-adjacent MultiNLI is not workplace-native policy or CRM data. These are supplied-evidence adaptations and public native labels, not official retrieval scores or new adjudication of the service contract.

Timing includes local network/provider routes and the native Cloudflare binding through Wrangler's remote proxy. The 3,000 ms evaluation deadline differs from the deployed API's nested 2,500 ms provider budget. Model order was fixed; one pass cannot establish repeat stability, capacity or an SLA. Costs are not measured invoices; known input-token subtotals and unknown usage observations are preserved.

Fastino was requested as `fastino/GLiDE`; the catalog describes GLiDE v2.3 in NVFP4 on a B200, and inference reports `glide_v2`. Its immutable checkpoint revision is unknown. Requests disable retention with `store:false`, with a `not-stored` response header observed in the integration probe. GLiDE is an evaluation-only comparator. Its smaller 0.4B, 0.8B, 2B and 9B sizes remain pending as requested; no hosting or model scores are invented for them.

The [nine-model archive](../../eval/results/hosted-models-with-glide-2026-11-05/README.md) contains detailed scorecards, summary JSON, redacted scoring rows, model identities, original-artifact hashes, the Fastino protocol and source snapshot. Its parent [eight-model archive](../../eval/results/hosted-models-2026-11-05/README.md) retains the original protocol, source snapshots, native-label/genre/clause slices, Wilson and source-group bootstrap intervals, calibration and risk/coverage diagnostics. Both have independent metric checks. All 164 distinct finance claim/evidence strings were checked against decompressed archive files; none is present. Raw reports stay in ignored local storage.

See the [evaluation guide](../../eval/README.md) for commands. The added Fastino phase is bounded to 920 scored attempts plus three integration probes, with a separate $2 operator reservation. Combined with the original $15 reservation, this is accounting for the run, not a provider-enforced spending cap or a statement of actual charges.

After the measured run, review tightened the Fastino adapter to reject a missing reported model name. Every measured successful response had a valid identity, so this guard change affects none of the reported scores. The exact measured implementation is retained in the execution-source snapshot; the reproduction command can use that snapshot after later code changes.
