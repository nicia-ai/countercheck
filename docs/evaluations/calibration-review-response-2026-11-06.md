# Calibration review: corrections and follow-up

Status: **measured follow-up; post-hoc exploratory analysis**. November 6, 2026.

The review correctly separated positive-threshold fitting from the choice of negative false-clear budget. The follow-up is in the [versioned results](../../eval/results/calibration-followup-2026-11-06/README.md). The [original zero-budget study](../../eval/results/separate-calibration-2026-11-05/README.md), its 688 failed Jev validation records and every original scorecard remain unchanged.

## Jev validation restored

After the owner reported adding TypeSafe credits, a separately authorized run made only Jev's 688 validation calls, with a $1.38 reservation, the original manifest, prompts, 3,000 ms deadline and frozen positive/negative thresholds. All 688 succeeded; all recorded upstream statuses were HTTP 200. Measured billing is unknown. There were no further model calls or automatic retries.

The new evaluation observer records only request ordinal and numeric HTTP status, or null when no HTTP response exists. It does not read or retain request text, authorization headers or response bodies. Production service source is unchanged. See [status diagnostics](../../eval/README.md#upstream-http-status-diagnostics) for using the observer in subsequent Jev evaluations.

The restored run supports the billing explanation. It cannot retrospectively prove that the earlier errors were HTTP 402: those records lack the upstream status. The historical cause remains unconfirmed; the failed run is not a model-quality result.

## Negative coverage: policy choice, not evidence of bad labels

Zero permitted fit false clears was a deliberately strict proposed constraint, not a requirement of threshold calibration. Under the owner's replacement primary, each model may make no more fit false clears than its shipped balanced-v1 policy made on the same 771 selected native-positive fit pairs. All supplied counts were recomputed and confirmed.

Positive cutoffs remain frozen. The negative rule maximizes fit true negatives with that absolute per-model cap, using the original cutoff/support grid and tie order. The fixed 0%, 0.5%, 1%, 2% and 5% grid is also published. The primary formula was selected **after seeing the original zero-budget validation**; parameters are fitted on fit outputs only, with no subsequent validation-driven grid winner or reselection. This is exploratory sensitivity, not fresh confirmatory evidence. Finance is transfer only.

Pooled validation negative coverage rises from 0–30.0% under the zero budget to **36.1–79.4%** under the primary. Precision and positive recall are unchanged by this negative-only refit. The fit bound does not protect unseen groups or the same individual cases: validation false clears can exceed the shipped count. For example, Jev's primary has 18 versus 17 shipped false clears, while GLiDE has 10 versus 15. Full domain counts and paired intervals are published, including adverse results.

This demonstrates that our zero-budget setup caused the coverage collapse. It does **not** establish that the native labels responsible for false clears are noisy: a genuine model mistake and a label/contract mismatch remain different possible causes. The 204-item blinded packet is prepared, not yet labelled; no AI adjudication was added.

## Positive thresholds: useful but incomplete

On disjoint validation, full Decider gains 9.9 recall points (57.5→67.5%) at 96.0% observed precision; GLiDE gains 15.1 points (46.7→61.8%) at 97.0%; Decider Flash gains 6.6 points (53.3→59.9%) at 96.9%. The restored Jev run gains 4.2 points and reaches 54.2% recall at 96.6% precision. These are point estimates, not confidence-bound guarantees.

The archived loss accounting is also correct: higher positive cutoffs cost Clef 26 detections, Clef Omni 24, Decision-1 53 and Luna two, totaling 105. Their separately fitted precision constraint required more conservative positive decisions. Positive cutoffs and these archived detection counts do not change under any negative budget.

No primary validation or archived model/domain scorecard meets all three point targets. Remaining error is not exhausted by the labels-versus-models distinction: prompting, decision representation, evidence adaptation, source mix and global-versus-domain operating policies remain possible harness factors that this experiment did not test.

## GLiDE timeouts: retain the metric, show sensitivity

GLiDE had 75/688 validation deadline failures versus one failure in the original 920-call comparison. The two cohorts differ, and the original includes 40 synthetic diagnostics. Serial run timing and provider load are also uncontrolled. These observations do not establish that Fastino became slower.

With the frozen positive gate, deadline-inclusive recall is **61.8%**. Recall on successful native-positive assessments alone is **67.9%**, which changes the selected population and may favor easier inputs. Nineteen failed cases are native positives. Holding all completed answers fixed, detecting none/all of those would give **61.8–70.8%** recall. These are bounds, not imputed predictions. Even the optimistic bound remains below 90%.

## Suggested thread wording

> Is it the models or our setup? We checked the operating points. Model-specific positive thresholds recovered about 4–15 recall points for four models and reduced recall for four others. A separate, post-hoc negative policy restored coverage lost to our zero-error constraint. The joint targets are still unmet in these public cohorts. We've prepared blinded human review to separate label/contract mismatches from model mistakes; other harness improvements remain untested here.
