# Measured DeBERTa development baseline, 2026-11-03

These are actual local runs of `cross-encoder/nli-deberta-v3-base`, revision `6c749ce3425cd33b46d187e45b92bbf96ee12ec7`, on the prepared public development samples. The scorer verified the checkpoint's native output order: contradiction, entailment, neutral. It used evidence as premise, claim as hypothesis, native three-way argmax mapped to contradiction versus rest, with no abstention. No prompts or thresholds were tuned on these runs.

Accounting erratum: the saved reports' zero output-token total represents unavailable usage, not measured zero. Input token counts describe tokenized pairs, not billed tokens. Historical reports and predictions remain unchanged; current replay reports mark incomplete token totals `null` with known subtotals and observation counts. All saved quality metrics and intervals still reproduce exactly.

| Adapted development track            | Pairs (positive / negative) | Contradiction precision | Recall |    F1 | AUROC | PR-AUC (AP) | Brier |
| ------------------------------------ | --------------------------: | ----------------------: | -----: | ----: | ----: | ----------: | ----: |
| VitaminC combined                    |              200 (71 / 129) |                   0.667 |  0.366 | 0.473 | 0.737 |       0.580 | 0.281 |
| SciFact complete gold rationale sets |              199 (71 / 128) |                   0.922 |  0.662 | 0.770 | 0.924 |       0.901 | 0.129 |

All 399 pairs completed. There were **zero errors, zero token-envelope exclusions, and no truncation**; maximum accepted lengths were 144 and 243 tokens respectively, below the explicit 512-token limit. Coverage was 100% because this is a forced-decision comparator. Wilson 95% precision/recall intervals and claim-group bootstrap intervals are in the complete reports; precision's interval was [0.510, 0.794] for VitaminC and [0.815, 0.969] for SciFact. Small development samples and correlated groups limit conclusions. No model ranking, held-out test result or service release qualification follows from these measurements.

The route was **local PyTorch CPU** on an Apple M4 Pro, macOS arm64, Python 3.12.16, four intra-op threads; torch 2.9.0, transformers 4.57.1 and sentencepiece 0.2.1. All installed packages are frozen in [installed-requirements.txt](installed-requirements.txt). The original safetensors checkpoint was 737,726,552 bytes, SHA-256 `d8148c6d49e0a7925134294c56326c71fe0ab1dc390e37355e00c7efbb488afa`; [checkpoint-hashes.json](checkpoint-hashes.json) also pins tokenizer/config bytes.

After a ten-pair SciFact validation passed, the full VitaminC run took 5.90 seconds wall time including imports/loading; its inference loop took 3.48 seconds. SciFact took 7.39 seconds total, with a 4.88-second inference loop. The warm model load was approximately 0.2 seconds per full run. Metadata separates model-forward time, batch tokenization and loading; the initial validation included downloading and took 31.12 seconds total. These are local machine measurements, **not hosted request latency, network availability, a production capacity test or a billing comparison**. No hosted inference API or API key was used. Local compute cost is unknown, rather than assumed zero.

The `.manifest` files contain the exact original JSON bytes used for inference. Their extension keeps generic formatters from changing the byte hashes. They retain source URLs, archive/input-file hashes, original splits, native labels, revision/contrast groups, rationale sets and sampling procedure:

- VitaminC manifest SHA-256: `982a5dc43919853176d372c53bf90bc98d4bc49e56d8703165feb14345aff0ff`.
- SciFact manifest SHA-256: `d598943442b541f93f0eeaeeea7889470ebebb8715b213608c2f86e1fb90892c`.

The full report JSON contains every pair and probability distribution, native-negative slices, calibration bins, intervals, errors and exclusions. JSONL predictions and metadata permit independent metric replay:

```sh
pnpm eval:run --backend replay --manifest eval/results/deberta-dev-2026-11-03/scifact-dev.manifest --predictions eval/results/deberta-dev-2026-11-03/scifact-dev.predictions.jsonl --out eval/reports/scifact-deberta-replay
```

To rerun actual inference, create the project-local optional environment described in [the evaluation guide](../../README.md), then run `eval/deberta.py` on either manifest with a fresh output path. Explicitly permit the first model download with `--allow-download`; subsequent runs use the project-local checkpoint cache. The published package versions, checkpoint hashes, CPU route, thread count and batch size are recorded with the predictions. Full sets were run sequentially with batch size eight.

These are adapted supplied-evidence tasks. SciFact uses complete annotated rationale sets and never labels arbitrary unannotated abstracts as negative; this is not SciFact retrieval/full-abstract performance. VitaminC development is the combined release, not a pure real-source test track. Both use deterministic samples capped at 200 pairs, retaining complete groups, so SciFact contains 199. Development data may guide future work, but locked test evaluation, a development-tuned matched-coverage comparison, perturbation/capacity runs and the custom human-adjudicated release corpus remain separate work.

Dataset terms still apply to the text reproduced in manifests/reports: [VitaminC Wikipedia/FEVER-derived terms](https://github.com/TalSchuster/VitaminC/blob/eb532922b88b199df68ed26afeb58dca5501b52f/DATA_LICENSE); [SciFact claims/annotations CC BY 4.0 and abstracts ODC-By 1.0](https://github.com/allenai/scifact/blob/68b98a56d93e0f9da0d2aab4e6c3294699a0f72e/LICENSE.md). Attribute Schuster, Fisch and Barzilay, _Get Your Vitamin C! Robust Fact Verification with Contrastive Evidence_ (NAACL 2021), and Wadden et al., _Fact or Fiction: Verifying Scientific Claims_ (EMNLP 2020). See the manifests for exact provenance and the evaluation guide for adapter boundaries.
