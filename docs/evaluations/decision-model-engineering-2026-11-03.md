# Decision-model engineering: instructions, examples and composition

Status: measured development experiment, 2026-11-03. The deployed `balanced-v1` profile is unchanged. This study concerns Jev 1.14; it does not establish optimized Clef/Decider performance or a production quality ceiling.

The initial implementation had a tested transport and evaluation system, but its decision formulation was still a baseline: one short instruction to apply a policy stored in state, four terse option descriptions, no examples, and untuned 0.8/0.2 cutoffs. The earlier threshold frontier describes those saved scores, not all scores the underlying model could produce under better engineering.

Examples are a supported way to define decision boundaries. TypeSafe's [building guide](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) and [structured criteria reference](https://docs.typesafe.ai/primitives/advanced) recommend direct questions, structured definitions and examples. Zero-shot capability does not prohibit adding illustrative cases. The [jaggedness guide](https://docs.typesafe.ai/model-jaggedness) also warns about indirection, irrelevant state, arithmetic/date reasoning, conflicting criteria and option-order sensitivity.

## Controlled experiment

Five profiles were frozen before inference: current baseline; the same policy directly in instructions; richer structured instructions/criteria; exactly that richer rubric plus eight invented examples; and two independent Nouls for conflict and determinability. The last arm changes representation and composition, so it is not an isolated wording experiment. No threshold was tuned.

All five ran on the unchanged 399 public development pairs and 32 synthetic contract diagnostics, giving 2,155 calls. After detecting run variation in the fresh baseline, baseline/rich/rich-with-examples were repeated twice unchanged, adding 2,586 calls. All **4,741 calls completed without errors or exclusions**, requested/reported `jev-1.14.0`, with no retries, a three-second deadline and a maximum global concurrency of two.

The examples were invented rather than copied from benchmark pairs. An independent agent audited and corrected three ambiguous example/fixture cases before calls began. These are AI-authored and AI-reviewed diagnostics, not independently human-adjudicated release data. Four explicit expected-uncertain cases use a schema-only binary proxy and are excluded from binary quality metrics; all 32 remain in contract accuracy and execution metrics.

| Profile, three unchanged runs     | VitaminC precision | VitaminC recall | SciFact precision | SciFact recall | Contract verdicts correct, runs 1 / 2 / 3 |
| --------------------------------- | -----------------: | --------------: | ----------------: | -------------: | ----------------------------------------- |
| Current baseline                  |         90.0–93.5% |      38.0–40.8% |        94.3–94.4% |     46.5–47.9% | 28/32 / 28/32 / 28/32                     |
| Rich rubric, no examples          |         93.1–93.5% |      38.0–40.8% |        95.0–95.1% |     53.5–54.9% | 29/32 / 29/32 / 30/32                     |
| Same rich rubric + eight examples |         90.3–93.3% |      39.4–40.8% |             95.0% |          53.5% | 32/32 / 32/32 / 32/32                     |

These are per-run ranges, not confidence intervals. Repeating the same 32 labeled cases does not create 96 independent test cases. Public development data had already been examined; none of these scores is held out.

The richer rubric recovered four or five additional SciFact positives per run with two false positives in every run. Examples added no SciFact precision/recall gain over that rubric, though they changed negative coverage and individual probabilities. VitaminC example effects were mixed: versus the no-example rubric, two runs gained one true positive and one false positive; the third lost one true positive with the same false-positive count.

Examples reliably improved these specific synthetic boundaries. In the first pass they corrected the rule-versus-observed-violation distinction, disjoint software versions, an illegible outcome and unresolved referents. That supports further example engineering, not a claim of general accuracy or solved public benchmarks.

Moving the policy into instructions alone also had mixed effects in its single exploratory pass: SciFact precision/recall rose from 94.3%/46.5% to 95.0%/53.5%; VitaminC changed from 93.5%/40.8% to 88.6%/43.7%. Directness is worth testing rather than assuming a universal improvement.

## Composition and repeatability findings

The two-Noul arm used conflict probability ≥0.8 **and** determinability probability ≥0.8 for a positive result. On VitaminC, conflict alone at 0.8 would produce 29 true positives and one false positive; adding the determinability gate reduced that to 20 true positives and the same one false positive. On SciFact it changed 33 true positives/two false positives to 30/one. Additional judgments need validated joint composition; an arbitrary AND of conservative thresholds can suppress useful signal.

Noul's stored `[p_conflict, 1-p_conflict, 0]` projection is a binary marginal for ranking/calibration. Determinability remains a separate raw judgment and gate. This is not a joint calibrated three-way probability distribution or evidence that the Noul primitive itself performs worse than Choice.

The initial fresh baseline had 12 VitaminC and six SciFact verdict differences versus the earlier archive despite identical input payload hashes on all 399 pairs and the same reported model name. This establishes observed run variation; it does not identify its backend cause. Small candidate improvements require paired repeats and held-out validation. The original archives were preserved.

## Production implications

All actual single-pair experimental payloads fit 16 KiB; the largest was 5,466 bytes. Independently simulated naive 20-comparison payloads did not: approximately 28.8 KiB for inline policy, 58.4 KiB for richer criteria, 90.2 KiB with examples, and 51.3 KiB for dual Noul. This is not evidence that an efficient compiler is impossible. It shows that copying every definition/example into every question cannot be promoted unchanged. A production compiler needs compact shared context, explicit per-question judgments, and measured 20-pair attribution/distractor/option-order tests.

The first full pass used 299,317 input tokens for baseline versus 654,461 for richer criteria with examples; examples were about 2.19 times the baseline input. Its observed hosted p95 rose from about 82 to 102 ms. These local provider measurements are not production latency or capacity guarantees.

The next engineering work should be:

1. Keep testing direct literal questions and contrastive criteria/examples on training/development groups, with frozen candidates and protected held-out groups. Maintain separate benchmark-native and service-contract labels rather than silently changing the task to improve a score.
2. Use decision models to identify semantic roles, applicability, asserted versus quoted status, and bounded value candidates; let code compare reliably extracted quantities, intervals, units and dates. Unknown extraction or identity must preserve uncertainty. This requires a separately versioned structured-value profile, not unvalidated regex guesses in the deployed path.
3. Calibrate composition from joint error patterns. Test context/scope judgments as signals and evaluate the false-clear/recall tradeoff; validate a gate rather than copying 0.8 onto each component.
4. Engineer the batched compiler for the actual envelope and test distractors, field/option order, adversarial text and unchanged repeated runs. Give Clef and Decider their own documented provider-compatible prompt experiments before drawing conclusions about optimized model quality.

The evidence supports more decision engineering before an architectural jump to a larger model. It does not show that examples alone will meet the 95% precision / 90% recall release targets. The richer formulation improves some measured behavior; all candidates still need human-adjudicated, held-out and operational qualification before promotion.

[Frozen profiles](../../eval/prompt-ablation/profiles.ts), [initial protocol](../../eval/prompt-ablation/protocol.json), [replication protocol](../../eval/prompt-ablation/replication-protocol.json), and [archived results](../../eval/results/prompt-ablation-2026-11-03/README.md) make the comparison inspectable. The runner's focused tests and the full project checks passed: 202 tests across 14 files, strict typecheck/lint/format and the Worker dry-run. The Worker bundle stayed unchanged at 865.54 KiB / 143.99 KiB gzip because experiment code is outside its import graph.
