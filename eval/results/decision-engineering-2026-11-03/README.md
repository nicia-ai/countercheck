# Decision-engineering development measurements, 2026-11-03

The frozen `semantic-v2` and `structured-value-v1` candidates did not improve contradiction recall over a fresh `balanced-v1` baseline on the previously examined public development pairs. These are actual pinned Jev 1.14 measurements, with no threshold tuning, production promotion, or deployment. The human-adjudicated 500-pair / locked 200-pair release gate remains **unmet**.

The **initial source** matrix contains **1,299 provider calls**, all completed with zero reported errors/exclusions: three profiles × 431 isolated pairs, plus six actual requests with twenty comparisons each. The 431 cases comprise 200 VitaminC, 199 SciFact and 32 AI-authored contract diagnostics. Batched outputs add 120 comparison observations, not 120 provider calls or independent new truth cases. Two global workers each processed their assigned requests sequentially. This archive concerns direct kernel/provider execution, not the deployed Cloudflare service's latency SLA.

## Reviewed-source follow-up: latest structured measurements

After independent review found comparator/range extraction gaps, the operator froze the final reviewed source separately and reran the **entire** structured profile: 431 isolated pairs plus two twenty-comparison requests, **433 calls**. The initial outputs above remain immutable. The source repair and a fresh provider pass both changed, so before/after differences cannot be attributed purely to the repair.

| Dataset  | Initial structured TP / FP | Reviewed structured TP / FP | Reviewed precision | Reviewed recall | Reviewed clear-negative coverage |
| -------- | -------------------------: | --------------------------: | -----------------: | --------------: | -------------------------------: |
| VitaminC |                      2 / 1 |                       0 / 1 |                 0% |              0% |                    10/129 = 7.8% |
| SciFact  |                      9 / 0 |                       8 / 0 |               100% |    8/71 = 11.3% |                     8/128 = 6.3% |

Reviewed structured contract accuracy is **17/32**: eight true positives, five clear negatives and all four expected-uncertain targets correct; four uncertain proxy rows remain excluded from binary metrics. Reviewed batch positives are **13/19 original** and **15/19 reversed**; the compatible target remains uncertain in both. Every request completed without reported errors/exclusions. These are regressions or continued misses against the task, not a promoted model.

The reviewed guard records incomplete candidate coverage on **170/200 VitaminC** and **130/199 SciFact** pairs; no reviewed single-pair or batch output selected a numeric candidate pair. The numeric lane is therefore not demonstrated as an effective general benchmark solution by these measurements. The default and semantic profiles were **not rerun**: an independent offline compiler check verifies all **942** of their original isolated/batched comparison payload hashes remain unchanged under final source. They remain earlier single-pass evidence, not contemporaneous repeat confirmation.

There were 68 changed compiled payloads among the 200 structured VitaminC cases and 59 among 199 SciFact cases. Contract and batch payloads stayed identical, yet their verdicts also varied across passes. This further limits causal conclusions about repair effects. `followup-summary.json` preserves each dataset separately and never pools initial and reviewed labels as independent cases.

## Separate toy development/calibration/holdout workflow

The operator also executed the new engineering workflow on twelve explicitly **AI-authored toy transport cases** in six paired groups. Six cases remained in train, four in dev (one two-case tuning group and one two-case validation group), and two in the workflow holdout. All native fixture labels remain separate from service-contract annotations; no human annotations were supplied. This demonstrates executable boundaries and diagnostics, not an independent human release test.

The dev run made **84 calls** (three profiles × four cases × seven probes). Holdout made **four calls** (the selected structured profile plus its semantic reference × two cases). All completed, with zero reported errors/exclusions. Repeats used identical compiled payloads on all four cases per profile. The sole verdict variation in paired toy probes was **semantic-v2 field order, 1/4 cases**; its other probes and every other profile/probe reported 0/4 changes. Four cases cannot establish immunity or isolate order effects from provider variation.

The 48-policy search found no eligible tuning positive at precision >=95%, so it recorded the explicit exploratory fallback: positive threshold 0.5, negative support 0.5, maximum unknown 0.2, numeric override false. Forced extraction uncertainty prevailed. The selected composition returned **uncertain on both tuning cases, both validation cases, and both heldout cases**: heldout TP=FP=TN=0, recall 0/1, clear-negative coverage 0/1, precision undefined. This is successful workflow execution, **not successful semantic quality**.

The two-cell Laplace empirical calibrator has Brier 0.1111 on each two-case fold. This tiny, invented demonstration cannot establish real calibration. The dev-run hash, calibration bytes, selected policy, split/fold hashes, final source freeze and exclusive holdout consumed marker are all retained. The holdout calibration is evaluation-only; no tuning on heldout output or production promotion occurred.

Follow-up cost accounting is separate: the reviewed structured rerun used **595,336 input tokens**, toy dev **99,348**, and toy holdout **4,850**. Total follow-up: **521 calls / 699,534 input tokens**. Combined execution accounting, without pooling quality cases: **1,820 calls / 2,104,873 input tokens**, input list-price estimate **$0.088404666** at the stated $0.042/M. Actual billing and reported output-token totals remain unknown. The call reservation was $1.82 cumulative, not a billed amount.

Final-source snapshot hashes and checkpoint hashes are verified. Captured local timestamps show the final reviewed freeze predates creation of all five rerun and both workflow checkpoint metadata files; the workflow's own freeze also predates its metadata, and calibration precedes the consumed marker. Together with the exact orchestrator preflight code, these are local provenance checks, not an external timestamp attestation.

## Initial-source public development results

Each public dataset has 71 native positive pairs. VitaminC has 129 native negatives and SciFact 128. All profiles use the same frozen pair texts and native labels; those fact-verification labels are not new service-contract adjudication. Public inputs had already been inspected during earlier work, so none is a new heldout sample.

| Profile             | Dataset  | TP / FP | Precision | Recall |    F1 | Clear-negative coverage |
| ------------------- | -------- | ------: | --------: | -----: | ----: | ----------------------: |
| balanced-v1         | VitaminC |  27 / 2 |     93.1% |  38.0% | 54.0% |                   76.7% |
| semantic-v2         | VitaminC |  27 / 2 |     93.1% |  38.0% | 54.0% |                   79.8% |
| structured-value-v1 | VitaminC |   2 / 1 |     66.7% |   2.8% |  5.4% |                    9.3% |
| balanced-v1         | SciFact  |  32 / 2 |     94.1% |  45.1% | 61.0% |                   81.3% |
| semantic-v2         | SciFact  |  28 / 2 |     93.3% |  39.4% | 55.4% |                   81.3% |
| structured-value-v1 | SciFact  |   9 / 0 |    100.0% |  12.7% | 22.5% |                   10.9% |

Uncertain positives remain recall misses. Structured outputs preserve their native choice/candidate distributions and deterministic diagnostics, with **zero** verdict-probability denominator: their AUROC/Brier are null, not invented from selection confidence. Full report JSON retains confidence intervals, calibration/risk curves where actual probabilities exist, errors, exclusions, native slices and timing. The compact summary independently recomputes confusion counts, precision/recall/F1, clear-negative coverage, AUROC, average precision and Brier from the archived rows.

The structured lane was especially restrictive. Incomplete candidate coverage occurred on 160/200 VitaminC and 89/199 SciFact pairs; unsupported spans occurred on 142/200 and 66/199 respectively. VitaminC decision bases were 185 uncertain, 13 semantic and two deterministic numeric; SciFact had 176 uncertain, 23 semantic and zero numeric. Only eight VitaminC rows selected a numeric candidate pair at all; six overlapped and two were disjoint. These recorded diagnostics explain a substantial abstention bottleneck, without attributing every remaining error to extraction or asserting that relaxing safety checks would improve correctness.

**Known defect in the evaluated parser:** independent review after main inference found that comparator expressions with unsupported unit suffixes could be interpreted as dimensionless quantities (for example, Fahrenheit versus Celsius). The original evaluated source is preserved byte-for-byte in the snapshot. Subsequent repairs and any affected-case reruns belong to separate provenance; this archive does not certify the old source as clean or relabel its measurements. No profile is production-qualified.

## Synthetic contract and batching diagnostics

The contract fixture is AI-authored, not independently human-adjudicated or representative of customer cases. Its four explicitly expected-uncertain cases have schema-only negative proxy gold; those four are excluded from binary precision/recall, clear-negative coverage, probability calibration and paired binary changes. All 32 remain in completion and expected-verdict accuracy.

| Profile             | Exact expected verdict | Expected-uncertain correct | Binary TP / FP / clear TN | Binary precision / recall |
| ------------------- | ---------------------: | -------------------------: | ------------------------: | ------------------------: |
| balanced-v1         |                28 / 32 |                      2 / 4 |               12 / 0 / 14 |               100% / 100% |
| semantic-v2         |                28 / 32 |                      2 / 4 |               12 / 0 / 14 |               100% / 100% |
| structured-value-v1 |                18 / 32 |                      4 / 4 |                 8 / 0 / 6 |              100% / 66.7% |

Each actual twenty-comparison request contained nineteen invented contradictory weights and one compatible weight. Every request returned all twenty correctly identified case IDs; the archive verifies original pair texts and any selected candidate spans against their corresponding submitted snippets. This establishes structural coverage of these requests, not semantic immunity from distractors.

| Profile             | Positive detections, original / reversed | Target verdict changes | Compatible target   |
| ------------------- | ---------------------------------------: | ---------------------: | ------------------- |
| balanced-v1         |                            18/19 → 19/19 |                   1/20 | clear negative both |
| semantic-v2         |                            19/19 → 19/19 |                   0/20 | clear negative both |
| structured-value-v1 |                            19/19 → 16/19 |                   3/20 | uncertain both      |

The structured batch model selected semantic labels rather than numeric pair options. Compatible numeric overlap alone cannot establish whole-pair consistency. Reversal and repeat executions also include provider run variation; two requests do not isolate order as the cause of changes or establish capacity. The exact claim/comparison manifest and compiled hashes are retained.

## Reproducibility, variation and cost

All 399 fresh baseline payload hashes match the corresponding earlier Jev archive exactly. Nevertheless, twelve VitaminC and nine SciFact verdicts changed. This is observed variation on identical compiled inputs; no cause or statistical significance is inferred. Three profiles on the same cases are paired measurements, not a larger independent test set.

Usage is deduplicated by **run identity plus pass/request ID**. There are 1,299 run-scoped requests but only 432 bare request IDs, so globally deduplicating IDs would discard real work. Main-matrix input usage is **1,405,339 tokens**, with no unknown input-token requests. Output-token usage is unknown for all 1,299 through this kernel reporting route. At the $0.042 per million input-token list price verified by the operator from [TypeSafe model documentation](https://docs.typesafe.ai/models.md), the input estimate is **$0.059024238**. Actual billed cost is unknown. The conservative reservation was a separate execution limit, not a measured charge.

## Archive layout and verification

- `protocol.json`, `probe-protocol.json`, `source-freeze.json` and `source-snapshot.json.gz`: original pre-inference protocol and exact source for all 41 frozen files. The evaluated source and the later working tree must not be conflated.
- `inputs/*.manifest` and `batch20.manifest`: exact public/synthetic input bytes. Public manifests retain source URLs, commit revisions, file hashes, original splits, rationale sets, sampling/group diagnostics and licenses. Their data terms remain applicable; archiving grants no new rights.
- `runs/PROFILE/*`: all fifteen reports, incremental predictions, metadata and Markdown reports. JSON/JSONL are gzip-compressed with empty filename and `mtime=0`; decompression reproduces original bytes.
- `post-review/structured-value-v1/*`: five complete reviewed-source report bundles, kept separate from the initial matrix.
- `source-freeze-final-reviewed.json`, `source-snapshot-final-reviewed.json.gz`, `post-review-protocol.json`: final source and pre-follow-up protocol.
- `workflow/*`: exact synthetic input, all role manifests and locks, the used `freeze-final-reviewed.json`, calibration, consumed marker and dev/holdout report bundles. The earlier unused workflow freeze is retained as setup provenance and is not the inference freeze.
- `followup-aggregate.py`, `followup-summary.json`, `followup-summary.csv`: separate standard-library verifier and reviewed-source/toy summaries.
- `references/*`: exact earlier baseline reports used only for payload-identity/variation checks. Historical archives are unchanged.
- `provenance/run-decision-engineering.mjs.txt`: the exact operator orchestrator, archived as text rather than adding executable result code. It contains environment variable names, never credential values.
- `artifact-sha256.json`: original-source and stored-byte sizes/hashes for every measured artifact; explanatory README, reproducer and derived summaries are outside that measured-artifact inventory.
- `aggregate.py`, `summary.json`, `summary.csv`: standard-library offline verifier/reproducer and derived summaries. Repeated rebuilds produce byte-identical JSON/CSV. The initial matrix comprised 71 measured artifacts; the appended inventory now verifies **116** artifacts, including both source snapshots and the complete follow-up workflow; selected candidate evidence spans are checked using UTF-16 offsets.

```sh
python3 eval/results/decision-engineering-2026-11-03/aggregate.py
python3 eval/results/decision-engineering-2026-11-03/followup-aggregate.py
# Extract any exact original report, then compare its SHA with the inventory:
gzip -dc eval/results/decision-engineering-2026-11-03/runs/semantic-v2/scifact-dev.report.json.gz > /tmp/scifact-semantic.report.json
```

`aggregate.py --capture` is an explicit local append operation for completed report bundles; it refuses to change existing archived bytes. It performs no model calls or network requests. The main summary remains separate from the reviewed-source rerun and the toy workflow's development probes, dev-only calibration and workflow-heldout evaluation. Both rebuilders verify the shared immutable inventory. These operational artifacts cannot convert already inspected public or invented cases into an independent human heldout gate. The human 500 / locked 200 requirement remains unmet.
