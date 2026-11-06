# Measured full Clef development baseline, 2026-11-03

These actual hosted runs used the unchanged Countercheck kernel and Cloudflare Workers AI REST adapter, route **`@cf/cloudflare/clef`**, request selector **`clef`**. Every one of the 399 full-run responses reported model **`clef`**; no separate revision was returned. This is full Clef, without flash/omni substitution, retries or fallback. The same frozen VitaminC combined 200 and SciFact complete gold-rationale 199 development pairs were used by [Jev 1.14](../jev-dev-2026-11-03/README.md), [Decider](../decider-dev-2026-11-03/README.md) and [DeBERTa](../deberta-dev-2026-11-03/README.md).

One ten-pair SciFact probe first verified access, response validation, reported model and plausible usage; it completed with zero errors/exclusions. Both full dataset jobs then ran concurrently, with sequential single-pair dispatch within each job, one original-order pass and a 3,000 ms kernel operation deadline. Each job had an explicit maximum of 200 calls, $0.01 per-call reservation and $2 reservation cap. The reservations were planning bounds, not actual prices. No prompt, thresholds, adapter or sample was changed after the probe. Credentials stayed in child-process memory/environment and are absent from these artifacts.

The unchanged abstaining policy marks contradiction at probability at least 0.8, and definitive negative only when contradiction is at most 0.2 and either consistent or different-scope is at least 0.8. Other results are uncertain. These are development measurements, with production qualification explicitly not assessed.

| Development track                    | Pairs (positive / negative) | Precision | Recall |    F1 | AUROC | PR-AUC (AP) | Brier | Definitive coverage | Errors / exclusions |
| ------------------------------------ | --------------------------: | --------: | -----: | ----: | ----: | ----------: | ----: | ------------------: | ------------------: |
| VitaminC combined                    |              200 (71 / 129) |     0.738 |  0.437 | 0.549 | 0.761 |       0.691 | 0.195 |               0.670 |               0 / 0 |
| SciFact complete gold rationale sets |              199 (71 / 128) |     0.929 |  0.366 | 0.525 | 0.950 |       0.900 | 0.101 |               0.503 |               0 / 0 |

All 399 full-run requests completed; uncertainty still counts as a miss in positive recall. VitaminC had 31 true positives, 11 false positives, 77 true negatives and 66 uncertain pairs. SciFact had 26 true positives, 2 false positives, 71 true negatives and 99 uncertain pairs. Clear-negative coverage was 0.597 and 0.555. Precision Wilson 95% intervals were [0.589, 0.847] and [0.774, 0.980]; recall intervals were [0.327, 0.552] and [0.264, 0.482]. Full reports contain complete four-choice distributions, native-negative slices, calibration bins, cluster-bootstrap intervals and request observations.

## Same-input development comparison

| Track / model        | Precision | Recall |    F1 | AUROC | Definitive coverage | Errors |
| -------------------- | --------: | -----: | ----: | ----: | ------------------: | -----: |
| VitaminC / full Clef |     0.738 |  0.437 | 0.549 | 0.761 |               0.670 |      0 |
| VitaminC / Jev 1.14  |     0.903 |  0.394 | 0.549 | 0.865 |               0.710 |      0 |
| VitaminC / Decider   |     0.946 |  0.493 | 0.648 | 0.927 |               0.715 |      1 |
| VitaminC / DeBERTa   |     0.667 |  0.366 | 0.473 | 0.737 |               1.000 |      0 |
| SciFact / full Clef  |     0.929 |  0.366 | 0.525 | 0.950 |               0.503 |      0 |
| SciFact / Jev 1.14   |     0.944 |  0.479 | 0.636 | 0.966 |               0.744 |      0 |
| SciFact / Decider    |     0.943 |  0.465 | 0.623 | 0.957 |               0.513 |      1 |
| SciFact / DeBERTa    |     0.922 |  0.662 | 0.770 | 0.924 |               1.000 |      0 |

Clef, Jev and Decider use the same fixed abstaining policy but achieve different coverage. DeBERTa uses forced native argmax decisions, so its F1 is not a matched-coverage comparison. Decider ranking/calibration uses the 397 rows with distributions; recall and coverage retain its two failures. These measurements do not establish a general model ranking. In particular, historical success on the admission task does not establish success on pair-level contradiction detection. Full Clef's current point estimates do not meet the proposed contradiction recall or clear-negative coverage targets on these development samples.

The selected groups are [biased development diagnostics](../sampling-diagnostics-2026-11-03.json), not uniform full-split samples. VitaminC contains 25 revision/contrast groups, and its combined release is not a pure real-source test. SciFact contains 151 claim groups and supplies complete annotated rationale sets, not retrieval or full-abstract inputs. Confidence intervals and zero observed execution errors do not establish production quality or availability.

## Route, timing and price provenance

The [official Clef model page](https://developers.cloudflare.com/workers-ai/models/clef/) documents structured state and typed questions with per-option probabilities, the REST route, a 65,536-token context and $0.24 per million input tokens without an output-token charge. The [Workers AI pricing reference](https://developers.cloudflare.com/workers-ai/platform/pricing/) lists the same input rate and explains backend billing in neurons. The public references and inspected facts are recorded in [official-sources.json](official-sources.json); the actual REST adapter accepted every full-run response without modification.

Reported input usage was **94,221 tokens for VitaminC** and **96,550 for SciFact**, totaling **190,771**. At the published input rate, arithmetic estimates are $0.02261304 and $0.02317200, or **$0.04578504** for the full 399-pair comparison. The separate probe used 4,754 tokens, an additional $0.00114096 at list price; all 409 calls therefore imply $0.04692600 before any allowance or billing adjustments. Actual billed dollar cost was not returned and is unknown. Output usage is also unreported; the documented absence of an output-token charge is not a measured zero-token claim. Infrastructure/network costs and account allocation effects are outside these estimates.

Local client-to-kernel/provider successful-response p95 was **532.74 ms for VitaminC** and **504.58 ms for SciFact**; p99 was 635.98 and 577.75 ms. The two overlapping jobs prevent interpreting these as a controlled single-client capacity comparison. They measure the direct REST route and local kernel, not a deployed Countercheck Worker, its D1/authentication path, cold starts, nested 2,500 ms provider budget or an SLA. No Countercheck service API request was used for this comparison.

## Exact artifacts and reproduction

[artifact-sha256.json](artifact-sha256.json) pins all 15 byte-exact copied files, including the separately identified ten-pair probe under `probe/`. The inventory excludes this README, the inventory itself and the explanatory source-reference file. Full-run prediction and metadata hashes match the original reports' `prediction_artifact` records. No earlier model artifact was rewritten.

- VitaminC manifest SHA-256: `982a5dc43919853176d372c53bf90bc98d4bc49e56d8703165feb14345aff0ff`, [exact manifest](vitaminc-combined-dev.manifest).
- SciFact manifest SHA-256: `d598943442b541f93f0eeaeeea7889470ebebb8715b213608c2f86e1fb90892c`, [exact manifest](scifact-dev.manifest).

Replay the archived predictions without another hosted call:

```sh
pnpm eval:run --backend replay --manifest eval/results/clef-dev-2026-11-03/scifact-dev.manifest --predictions eval/results/clef-dev-2026-11-03/scifact-dev.predictions.jsonl --out eval/reports/scifact-clef-replay
```

Choose a fresh output prefix. Original execution settings remain in the source metadata; replay has no dispatch route or deadline of its own. Locked tests, unchanged repeats, perturbation/batching safety, matched-coverage development tuning, human-adjudicated real assertions, provider context/privacy checks and deployed capacity remain separate qualification work.

Dataset licenses and attribution continue to apply. VitaminC retains [Wikipedia/FEVER-derived article terms or the CC BY-SA 3.0 fallback](https://github.com/TalSchuster/VitaminC/blob/eb532922b88b199df68ed26afeb58dca5501b52f/DATA_LICENSE); SciFact [claims/annotations are CC BY 4.0 and abstracts ODC-By 1.0](https://github.com/allenai/scifact/blob/68b98a56d93e0f9da0d2aab4e6c3294699a0f72e/LICENSE.md). Attribute Schuster, Fisch and Barzilay, _Get Your Vitamin C! Robust Fact Verification with Contrastive Evidence_ (NAACL 2021), and Wadden et al., _Fact or Fiction: Verifying Scientific Claims_ (EMNLP 2020). Source revisions, URLs, file/archive hashes, original splits, native labels, group IDs and intact rationale indices remain in the manifests. See [the evaluation guide](../../README.md) for adapter boundaries.
