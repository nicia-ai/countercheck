# Measured Jev 1.14 development baseline, 2026-11-03

These actual hosted runs used the Countercheck kernel and direct TypeSafe HTTPS adapter. The requested and returned model identities were **`jev-1.14.0` on all 399 pairs**; no separate model revision was reported. The fixed supplied-evidence manifests are exactly the VitaminC combined 200 and SciFact complete gold-rationale 199 development pairs used by the [DeBERTa](../deberta-dev-2026-11-03/README.md) and [Decider](../decider-dev-2026-11-03/README.md) baselines.

Each dataset ran one original-order pass, one pair per request, sequential dispatch, a 3,000 ms kernel operation deadline and no retries. The two dataset jobs ran concurrently. The decision thresholds were unchanged: contradiction at least 0.8; definitive negative only when contradiction is at most 0.2 and either consistent or different-scope is at least 0.8; uncertainty otherwise. No prompt or threshold tuning followed these results. These are public development measurements, with production qualification explicitly not assessed.

| Development track                    | Pairs (positive / negative) | Precision | Recall |    F1 | AUROC | PR-AUC (AP) | Brier | Definitive coverage | Errors / exclusions |
| ------------------------------------ | --------------------------: | --------: | -----: | ----: | ----: | ----------: | ----: | ------------------: | ------------------: |
| VitaminC combined                    |              200 (71 / 129) |     0.903 |  0.394 | 0.549 | 0.865 |       0.810 | 0.153 |               0.710 |               0 / 0 |
| SciFact complete gold rationale sets |              199 (71 / 128) |     0.944 |  0.479 | 0.636 | 0.966 |       0.922 | 0.114 |               0.744 |               0 / 0 |

All 399 requests completed, including 109 uncertain results; uncertainty remains a miss in positive recall. VitaminC had 28 true positives and 3 false positives, with 58 uncertain pairs; SciFact had 34 true positives and 2 false positives, with 51 uncertain pairs. Clear-negative coverage was 0.791 and 0.852 respectively. The precision Wilson 95% intervals were [0.751, 0.967] and [0.819, 0.985]; recall intervals were [0.289, 0.511] and [0.367, 0.593]. Complete reports include cluster-bootstrap intervals, native negative slices, reliability bins, risk/coverage and full raw distributions.

## Same-input development comparisons

| Track / model       | Precision | Recall |    F1 | AUROC | Definitive coverage | Errors |
| ------------------- | --------: | -----: | ----: | ----: | ------------------: | -----: |
| VitaminC / Jev 1.14 |     0.903 |  0.394 | 0.549 | 0.865 |               0.710 |      0 |
| VitaminC / Decider  |     0.946 |  0.493 | 0.648 | 0.927 |               0.715 |      1 |
| VitaminC / DeBERTa  |     0.667 |  0.366 | 0.473 | 0.737 |               1.000 |      0 |
| SciFact / Jev 1.14  |     0.944 |  0.479 | 0.636 | 0.966 |               0.744 |      0 |
| SciFact / Decider   |     0.943 |  0.465 | 0.623 | 0.957 |               0.513 |      1 |
| SciFact / DeBERTa   |     0.922 |  0.662 | 0.770 | 0.924 |               1.000 |      0 |

Jev and Decider use the same abstaining policy, but their achieved coverage differs. DeBERTa uses native forced three-way argmax mapped to contradiction versus rest and never abstains. These F1 values therefore compare different decision behavior, not matched-coverage policies. Jev's SciFact ranking/discrimination was stronger than its definitive recall under the current conservative threshold; the same pattern appears in Decider. No overall model winner, held-out test result or production threshold follows from these small development samples. Decider ranking/calibration uses the 397 pairs with distributions because one request failed per dataset; its recall and coverage retain both failures. All 399 Jev and DeBERTa pairs have distributions.

The [sampling diagnostics](../sampling-diagnostics-2026-11-03.json) show these are greedy label-proportion development samples, not uniform or population-representative group samples. VitaminC includes 25 revision/contrast groups averaging eight pairs; SciFact includes 151 claim groups averaging 1.32. SciFact uses complete oracle rationale sets and does not measure retrieval or full-abstract verification. The combined VitaminC development release is not a pure real-source test track.

## Measured timing and input-price arithmetic

The local client-to-kernel successful-response p95 was **92.18 ms for VitaminC** and **98.69 ms for SciFact**, with p99 of 139.40 and 132.08 ms. These include the direct hosted provider round trip and local kernel work. The two jobs overlapped, with each dispatching sequentially; they are not a controlled production-capacity experiment. These measurements do not describe a deployed Cloudflare Worker, its authentication/database path, its nested 2,500 ms provider budget, cold starts, or a service SLA.

Reported input usage was 138,012 tokens for VitaminC and 140,505 for SciFact, totaling **278,517 input tokens** across 399 known observations. Output-token usage and billed dollar cost were not returned and remain unknown. At the inspected [TypeSafe model input list price](https://docs.typesafe.ai/models.md) of $0.042 per million input tokens, the arithmetic estimate is **$0.011697714** (`278517 × 0.042 / 1000000`). That is an input-token estimate, not an invoice or measured charge, and excludes other infrastructure/network costs. Per-call reservations in the raw protocol were planning caps rather than measured prices.

## Exact evidence and reproduction

The self-contained artifact set preserves the source bytes. [artifact-sha256.json](artifact-sha256.json) pins every copied manifest, report, prediction JSONL and metadata file; its hashes exclude the inventory and this explanatory README. Prediction and metadata hashes also match each original report's `prediction_artifact`. No earlier model's saved results were modified.

- VitaminC manifest SHA-256: `982a5dc43919853176d372c53bf90bc98d4bc49e56d8703165feb14345aff0ff`, [exact manifest](vitaminc-combined-dev.manifest).
- SciFact manifest SHA-256: `d598943442b541f93f0eeaeeea7889470ebebb8715b213608c2f86e1fb90892c`, [exact manifest](scifact-dev.manifest).

To regenerate metrics from the archived predictions without another hosted call:

```sh
pnpm eval:run --backend replay --manifest eval/results/jev-dev-2026-11-03/scifact-dev.manifest --predictions eval/results/jev-dev-2026-11-03/scifact-dev.predictions.jsonl --out eval/reports/scifact-jev-replay
```

Use a fresh output prefix. The harness validates complete pair/pass coverage and the manifest-bound metadata before reporting. The run's original dispatch settings remain in `prediction_metadata`; a new replay correctly has no dispatch timeout, batch size, presentation or transport route of its own. The separate ten-pair credential probe is not included in the 399-pair result or its cost estimate. Three unchanged passes, perturbations, locked tests, matched-coverage threshold work, human adjudication and deployed capacity/privacy qualification remain separate release gates.

Data attribution and license terms apply to text reproduced here. VitaminC incorporates Wikipedia and FEVER-derived material under its [article-specific / CC BY-SA 3.0 fallback terms](https://github.com/TalSchuster/VitaminC/blob/eb532922b88b199df68ed26afeb58dca5501b52f/DATA_LICENSE). SciFact [claims and annotations are CC BY 4.0; abstracts are ODC-By 1.0](https://github.com/allenai/scifact/blob/68b98a56d93e0f9da0d2aab4e6c3294699a0f72e/LICENSE.md). Attribute Schuster, Fisch and Barzilay, _Get Your Vitamin C! Robust Fact Verification with Contrastive Evidence_ (NAACL 2021), and Wadden et al., _Fact or Fiction: Verifying Scientific Claims_ (EMNLP 2020). The manifests retain source repositories/revisions, URLs, input/archive hashes, original splits, native labels, complete group IDs and SciFact rationale indices. See [the evaluation guide](../../README.md) for adapter boundaries.
