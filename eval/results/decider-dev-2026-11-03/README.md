# Measured Decider development baseline, 2026-11-03

These actual live runs used the Countercheck kernel and OpenRouter adapter with requested model `perplexity/pplx-decider-v1.2`. The returned model identity was `perplexity/pplx-decider-v1.2-20261016`. Each dataset used sequential single-pair requests, one pass, a 3,000 ms timeout, no retries, and the unchanged evaluation thresholds of positive >= 0.8 and clear negative <= 0.2 with a consistent/different-scope option >= 0.8. The two dataset processes ran concurrently, so this is not a controlled single-client capacity or latency comparison.

Accounting erratum: saved token totals include only reported usage; missing usage was treated as zero. The input figures are known subtotals, and zero output-token totals mean unavailable usage. Historical report/prediction files remain unchanged; current replay reports mark incomplete totals `null` with known subtotals and observation counts. Quality scores and intervals are unaffected by this accounting correction.

The exact input manifests are shared with the [DeBERTa baseline](../deberta-dev-2026-11-03/README.md). Both runs retained failures and uncertainty in operational recall and coverage denominators. They are development samples, not locked-test results or production qualification. No prompt or threshold tuning followed these measurements.

| Supplied-evidence development track  | Pairs | Precision | Recall |    F1 | AUROC | Definitive coverage | Errors |
| ------------------------------------ | ----: | --------: | -----: | ----: | ----: | ------------------: | -----: |
| VitaminC combined                    |   200 |     0.946 |  0.493 | 0.648 | 0.927 |               0.715 |      1 |
| SciFact complete gold rationale sets |   199 |     0.943 |  0.465 | 0.623 | 0.957 |               0.513 |      1 |

There were no input-envelope exclusions. Each report contains full distributions, native negative slices, confidence intervals and the error code for the failed request. The small ten-pair initial probe is not used to choose the sample or replace a failed full-run result. Model costs were not returned as measured charges; per-call spend reservations were only planning bounds, not invoices or provider-enforced caps.

The high ranking scores alongside lower definitive recall are a useful baseline for future development-set threshold work, not evidence that the current policy meets its release gates. DeBERTa uses native forced argmax and has 100% definitive coverage; comparing its F1 directly with this abstaining policy does not establish a model winner. The same-input probability metrics and a future matched-coverage comparison are more appropriate.

Manifests and licenses:

- VitaminC: `982a5dc43919853176d372c53bf90bc98d4bc49e56d8703165feb14345aff0ff`, [exact manifest](../deberta-dev-2026-11-03/vitaminc-combined-dev.manifest). Wikipedia/FEVER-derived data terms remain applicable.
- SciFact: `d598943442b541f93f0eeaeeea7889470ebebb8715b213608c2f86e1fb90892c`, [exact manifest](../deberta-dev-2026-11-03/scifact-dev.manifest). Claims/annotations CC BY 4.0; abstracts ODC-By 1.0.

Attribute Schuster, Fisch and Barzilay, _Get Your Vitamin C! Robust Fact Verification with Contrastive Evidence_ (NAACL 2021), and Wadden et al., _Fact or Fiction: Verifying Scientific Claims_ (EMNLP 2020). Source revisions, URLs, archive/input hashes, original splits, full-group sampling and rationale indices remain in the exact manifests. See [the evaluation guide](../../README.md) for reproduction and adapter limitations.

No Jev performance run was performed because a TypeSafe credential was unavailable in the scoped local configuration. The API and harness remain pinned to Jev 1.14; a different provider's results do not qualify that route.
