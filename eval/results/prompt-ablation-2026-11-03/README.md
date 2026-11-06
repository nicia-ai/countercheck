# Jev 1.14 decision-model engineering ablation, 2026-11-03

This experiment tested instruction placement, richer typed criteria, illustrative examples and a two-Noul composition against a **fresh baseline**. The initial five-arm run completed 2,155 calls; two unchanged repeatability runs added 1,293 calls each. All **4,741 calls completed with zero errors or exclusions**, requested and reported `jev-1.14.0`, and used one call per pair/profile, a 3,000 ms deadline, no retries and no truncation. No production runtime, model route, thresholds or deployment was changed by this experiment.

The unique input set remains **431 cases**: the previously examined 399 public development pairs plus a 32-case AI-authored and independently AI-reviewed contract diagnostic. Repeating them does not create new independent labeled cases. The follow-up profiles were selected **after observing variation in the first run**, as recorded in [the replication protocol](protocols/replication.json); they are not a preregistered held-out confirmation. Three passes and this synthetic suite do not establish statistical significance, generalization or a model-capability ceiling.

The observed result is specific: the richer criteria improved the SciFact point estimates relative to the fresh baseline in these passes. Adding eight examples to those criteria brought the contract diagnostic to 32/32 on every pass, while the public precision/recall changes were small and mixed. **Prompt/decision engineering matters; these observations do not show that the current service is production-qualified or that examples solve the public benchmark.**

## Frozen arms and interpretation

| Arm                      | Change from the shared literal-compatibility contract                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `baseline`               | Fresh execution of the current compiler, including its unchanged `q_000` question                                                 |
| `inline-policy`          | Moves the same definition into the typed-question instruction                                                                     |
| `rich-criteria`          | Elaborates the instruction and structured criteria, without examples                                                              |
| `rich-criteria-examples` | The same rich criteria with eight invented examples added; this is the audited examples-only contrast                             |
| `dual-noul`              | Two typed Noul questions for conflict and determinability, with a composed gate; this changes primitive/policy as well as wording |

The examples are not copies of evaluated input/gold labels. The literal submitted-text compatibility contract was held fixed rather than rewritten to optimize native fact-verification labels. Public labels can disagree with that task boundary; this experiment does not relabel them or estimate a label-noise rate. [Initial protocol](protocols/initial.json), exact input manifests and source snapshots retain the pre-inference choices. The frozen protocol's planning status predates runner unit verification; the actual runs subsequently completed successfully.

All choice arms retain the original policy: positive at contradiction probability at least 0.8, definitive negative only when contradiction is at most 0.2 and one consistent/different-scope component is at least 0.8; otherwise uncertain. No threshold tuning was performed. Dual Noul additionally requires determinability at least 0.8 for either definitive verdict.

## Initial five-arm pass

P/R/F1 below are contradiction-versus-rest point estimates with uncertainty retained as positive misses. Clear-negative coverage uses only the native labeled negative pairs. Full distributions, confidence intervals, reliability/risk tables, errors and paired changes remain in each original report.

| Arm                    | VitaminC P |     R |    F1 | Clear-negative coverage | SciFact P |     R |    F1 | Clear-negative coverage |
| ---------------------- | ---------: | ----: | ----: | ----------------------: | --------: | ----: | ----: | ----------------------: |
| baseline               |      0.935 | 0.408 | 0.569 |                   0.767 |     0.943 | 0.465 | 0.623 |                   0.828 |
| inline-policy          |      0.886 | 0.437 | 0.585 |                   0.767 |     0.950 | 0.535 | 0.685 |                   0.875 |
| rich-criteria          |      0.933 | 0.394 | 0.554 |                   0.760 |     0.950 | 0.535 | 0.685 |                   0.844 |
| rich-criteria-examples |      0.906 | 0.408 | 0.563 |                   0.775 |     0.950 | 0.535 | 0.685 |                   0.859 |
| dual-noul              |      0.952 | 0.282 | 0.435 |                   0.760 |     0.968 | 0.423 | 0.588 |                   0.625 |

VitaminC has 200 pairs including 71 annotated positives; SciFact has 199 pairs including 71 annotated positives and complete supplied gold rationale sets. These are the same exact public inputs used by the earlier comparator runs. VitaminC is the combined release; SciFact is an oracle-rationale adaptation, not a retrieval score. The [existing sampling diagnostics](../sampling-diagnostics-2026-11-03.json) quantify the non-uniform greedy group selection.

### Separate 32-case contract diagnostic

The suite has 12 positive, 16 clearly negative and **four explicitly expected-uncertain cases**. Those four cases carry a binary proxy only to fit the canonical manifest format; they are excluded from binary precision/recall, clear-negative coverage, ranking and calibration. All 32 remain in execution and explicit expected-verdict scoring.

| Arm                    | Exact expected verdicts / 32 | Expected uncertainty / 4 | Binary positive TP / 12 | Binary FP | Clear negative TN / 16 |
| ---------------------- | ---------------------------: | -----------------------: | ----------------------: | --------: | ---------------------: |
| baseline               |                           28 |                        2 |                      12 |         0 |                     14 |
| inline-policy          |                           26 |                        2 |                      12 |         0 |                     12 |
| rich-criteria          |                           29 |                        3 |                      12 |         0 |                     14 |
| rich-criteria-examples |                           32 |                        4 |                      12 |         0 |                     16 |
| dual-noul              |                           25 |                        3 |                      11 |         0 |                     11 |

The choice arms all achieved P=R=1 on the 28 binary cases in this pass, yet differed in clear-negative completion and appropriate uncertainty. Binary F1 alone would hide these differences. The 32/32 example-arm result is evidence of conformance on this small AI-authored suite, not independent human adjudication or broad domain accuracy.

## Three unchanged passes of the common arms

The initial run used global concurrency two with one sequential queue per profile/dataset. Each repeat ran at concurrency one; the two repeat processes overlapped, for aggregate concurrency two. No prompt, example, model pin, threshold or case changed between passes. The topology and post-discovery selection are retained in the protocols.

These are descriptive minima/maxima over three executions of the **same cases**. Quality was not pooled into a larger sample or a more favorable confidence interval.

| Arm                    | VitaminC precision range | Recall range | SciFact precision range | Recall range | Contract exact verdicts, runs 1 / 2 / 3 |
| ---------------------- | -----------------------: | -----------: | ----------------------: | -----------: | --------------------------------------- |
| baseline               |              0.900–0.935 |  0.380–0.408 |             0.943–0.944 |  0.465–0.479 | 28 / 28 / 28 of 32                      |
| rich-criteria          |              0.931–0.935 |  0.380–0.408 |             0.950–0.951 |  0.535–0.549 | 29 / 29 / 30 of 32                      |
| rich-criteria-examples |              0.903–0.933 |  0.394–0.408 |             0.950–0.950 |  0.535–0.535 | 32 / 32 / 32 of 32                      |

Relative to rich criteria alone, examples produced no additional SciFact P/R gain in these passes; rich criteria alone reached 39 true positives in one pass while examples had 38 in all three. On VitaminC the examples arm recovered one positive while adding one false positive in each of the first two comparisons, then lost one positive without changing false positives in the third. The 32-case contract outcome improved consistently. These finite observations warrant further aligned evaluation, not a claim that examples never help public tasks or that these differences are statistically established.

## Observed baseline variation

All **399 fresh baseline payload hashes exactly match** the earlier archived Jev baseline payloads. Nevertheless, **12 of 200 VitaminC verdicts and six of 199 SciFact verdicts changed** between that earlier execution and run 1. The earlier source reports are archived under `references/`; both comparisons retained the same input/gold pairs and reported model pin. This records observed variation and does not identify its cause.

The three new unchanged baseline passes also differed pairwise: 7–9 VitaminC verdicts and 4–8 SciFact verdicts changed per comparison. The synthetic baseline's 28/32 outcome was unchanged. [summary.json](summary.json) records exact score changes, payload identity and paired counts per run; small single-pass deltas should be read alongside this variability.

## Post-hoc dual-Noul gate diagnostic

The canonical projection `{contradiction: p_conflict, no_contradiction: 1-p_conflict, insufficient_context: 0}` is **only a binary marginal for ranking/calibration**. The separate determinability score controls abstention. These are not joint or calibrated three-way verdict probabilities, and no stochastic independence between the two questions is assumed. Native outputs remain in `raw_noul`.

The following counterfactual holds the saved two-question outputs fixed and merely omits the determinability condition from the positive decision at conflict >= 0.8. It is not a new inference run, a single-Noul experiment, a deployed change or threshold selection.

| Dataset  | Without determinability gate: TP / FP | With recorded gate: TP / FP | Gold positives suppressed by gate | False positives suppressed |
| -------- | ------------------------------------: | --------------------------: | --------------------------------: | -------------------------: |
| VitaminC |                                29 / 1 |                      20 / 1 |                                 9 |                          0 |
| SciFact  |                                33 / 2 |                      30 / 1 |                                 3 |                          1 |

The gate traded away recall, particularly on VitaminC; removing it in this post-hoc calculation does not establish an appropriate production policy. Changing or removing the question from the actual model input could also change its conflict scores and was not tested here.

## Request and token accounting

Usage is summed across **all cases**, including the four expected-uncertain diagnostics, using `(run_id, request_id)` as identity. Reused request IDs across runs must not suppress billed-work accounting. There are 4,741 run-qualified request observations but only 3,017 distinct bare request IDs: globally deduplicating them would discard 1,724 repeated request observations.

| Run                             | Profiles                        | Calls | Reported input tokens | Input list-price estimate |
| ------------------------------- | ------------------------------- | ----: | --------------------: | ------------------------: |
| run 1                           | all five                        | 2,155 |             2,064,212 |              $0.086696904 |
| run 2                           | baseline, rich, rich + examples | 1,293 |             1,390,153 |              $0.058386426 |
| run 3                           | baseline, rich, rich + examples | 1,293 |             1,390,153 |              $0.058386426 |
| Total execution accounting only | not a pooled quality set        | 4,741 |             4,844,518 |              $0.203469756 |

These estimates apply the previously inspected [Jev input list rate](https://docs.typesafe.ai/models.md) of $0.042 per million input tokens. Actual billed dollar cost is unknown; this is not an invoice and excludes infrastructure/network costs. Reported output counts are retained per run in the summary without inferring an output charge. Reservations are planning limits, not measured prices.

## Exact archive and offline reproduction

[artifact-sha256.json](artifact-sha256.json) records original source SHA-256 and byte count, archived SHA-256 and byte count, and compression for **22 source artifacts**. Compressed reports/checkpoints use built-in gzip with `mtime=0` and no embedded filename. The archive contains approximately 2.11 MB representing 18.86 MB of original bytes:

- Three exact manifests under `inputs/`, including the synthetic expected-verdict metadata.
- Frozen profiles, runner and CLI snapshots under `source/`; `.source` suffixes preserve the TypeScript bytes without turning archived copies into live imported modules.
- The initial and post-discovery replication protocols under `protocols/`. The replication snapshot retains its captured pre-format bytes; the working copy was subsequently reformatted only, with identical parsed JSON. The archived original SHA remains authoritative.
- Each original report, JSONL checkpoint, metadata and report Markdown under `runs/`.
- The earlier Jev reference reports used for the identical-payload comparison under `references/`.

To extract a report exactly, use `gzip -dc runs/run-1.report.json.gz > /tmp/prompt-ablation-run-1.json` from this directory. Its SHA-256 must equal the inventory's `source_sha256`; the compressed file must match `archived_sha256`. The metadata hashes and checkpoint hashes are also checked against the original reports. Do not run a formatter over measured artifacts.

Rebuild the derived [33-row CSV](summary.csv) and [summary JSON](summary.json) offline with the standard-library script:

```sh
python3 eval/results/prompt-ablation-2026-11-03/aggregate.py
```

The script verifies every archive/source hash, frozen profiles/protocols, all evaluated pair objects against the manifests, model identity, request counts and binary-versus-uncertain denominators before writing summaries. It makes no model, network or service calls. The original per-run reports remain unchanged, including their uncertainty, calibration, intervals and fresh-baseline paired comparisons.

This is exploratory development evidence: all public pairs were already available for inspection; the 32 new cases are AI-authored and AI-reviewed; only three selected arms were repeated after the initial discovery. No held-out generalization, human-adjudicated release gate, twenty-comparison envelope, deployed capacity or production promotion is established. The public data retains the [VitaminC Wikipedia/FEVER-derived terms](https://github.com/TalSchuster/VitaminC/blob/eb532922b88b199df68ed26afeb58dca5501b52f/DATA_LICENSE) and [SciFact CC BY 4.0 claims/annotations and ODC-By 1.0 abstracts](https://github.com/allenai/scifact/blob/68b98a56d93e0f9da0d2aab4e6c3294699a0f72e/LICENSE.md). Attribute Schuster, Fisch and Barzilay, _Get Your Vitamin C! Robust Fact Verification with Contrastive Evidence_ (NAACL 2021), and Wadden et al., _Fact or Fiction: Verifying Scientific Claims_ (EMNLP 2020). The manifests retain their original dataset provenance and hashes.
