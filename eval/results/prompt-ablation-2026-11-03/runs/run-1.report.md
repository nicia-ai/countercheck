# Jev 1.14 prompt ablation

One fixed pass; no threshold tuning. The baseline is fresh. Dual-noul changes representation and determinability policy as well as wording; no isolated prompt-only conclusion follows from that arm.

| Profile | Dataset | Pairs | Precision | Recall | F1 | Clear-negative coverage | Uncertain | Errors | AUROC |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | scifact/gold-rationale-set/dev | 199 | 0.9429 | 0.4648 | 0.6226 | 0.8281 | 0.2764 | 0 | 0.9615 |
| baseline | synthetic-smoke/prompt-contract-diagnostic/synthetic | 28 | 1.0000 | 1.0000 | 1.0000 | 0.8750 | 0.0714 | 0 | 1.0000 |
| baseline | vitaminc/combined/dev | 200 | 0.9355 | 0.4085 | 0.5686 | 0.7674 | 0.3100 | 0 | 0.8623 |
| inline-policy | scifact/gold-rationale-set/dev | 199 | 0.9500 | 0.5352 | 0.6847 | 0.8750 | 0.2211 | 0 | 0.9799 |
| inline-policy | synthetic-smoke/prompt-contract-diagnostic/synthetic | 28 | 1.0000 | 1.0000 | 1.0000 | 0.7500 | 0.1429 | 0 | 1.0000 |
| inline-policy | vitaminc/combined/dev | 200 | 0.8857 | 0.4366 | 0.5849 | 0.7674 | 0.2900 | 0 | 0.8775 |
| rich-criteria | scifact/gold-rationale-set/dev | 199 | 0.9500 | 0.5352 | 0.6847 | 0.8438 | 0.2312 | 0 | 0.9819 |
| rich-criteria | synthetic-smoke/prompt-contract-diagnostic/synthetic | 28 | 1.0000 | 1.0000 | 1.0000 | 0.8750 | 0.0714 | 0 | 1.0000 |
| rich-criteria | vitaminc/combined/dev | 200 | 0.9333 | 0.3944 | 0.5545 | 0.7597 | 0.3250 | 0 | 0.8836 |
| rich-criteria-examples | scifact/gold-rationale-set/dev | 199 | 0.9500 | 0.5352 | 0.6847 | 0.8594 | 0.2211 | 0 | 0.9818 |
| rich-criteria-examples | synthetic-smoke/prompt-contract-diagnostic/synthetic | 28 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0 | 1.0000 |
| rich-criteria-examples | vitaminc/combined/dev | 200 | 0.9063 | 0.4085 | 0.5631 | 0.7752 | 0.3000 | 0 | 0.8824 |
| dual-noul | scifact/gold-rationale-set/dev | 199 | 0.9677 | 0.4225 | 0.5882 | 0.6250 | 0.4372 | 0 | 0.9769 |
| dual-noul | synthetic-smoke/prompt-contract-diagnostic/synthetic | 28 | 1.0000 | 0.9167 | 0.9565 | 0.6875 | 0.2143 | 0 | 1.0000 |
| dual-noul | vitaminc/combined/dev | 200 | 0.9524 | 0.2817 | 0.4348 | 0.7597 | 0.3700 | 0 | 0.9015 |

## All-case execution and explicit contract diagnostics

| Profile | Dataset | All cases | Completed | Errors | Expected-uncertain excluded from binary | Expected-verdict accuracy | Uncertain-target recall |
|---|---|---:|---:|---:|---:|---:|---:|
| baseline | vitaminc/combined/dev | 200 | 200 | 0 | 0 | n/a | n/a |
| baseline | scifact/gold-rationale-set/dev | 199 | 199 | 0 | 0 | n/a | n/a |
| baseline | synthetic-smoke/prompt-contract-diagnostic/synthetic | 32 | 32 | 0 | 4 | 0.8750 | 0.5000 |
| inline-policy | vitaminc/combined/dev | 200 | 200 | 0 | 0 | n/a | n/a |
| inline-policy | scifact/gold-rationale-set/dev | 199 | 199 | 0 | 0 | n/a | n/a |
| inline-policy | synthetic-smoke/prompt-contract-diagnostic/synthetic | 32 | 32 | 0 | 4 | 0.8125 | 0.5000 |
| rich-criteria | vitaminc/combined/dev | 200 | 200 | 0 | 0 | n/a | n/a |
| rich-criteria | scifact/gold-rationale-set/dev | 199 | 199 | 0 | 0 | n/a | n/a |
| rich-criteria | synthetic-smoke/prompt-contract-diagnostic/synthetic | 32 | 32 | 0 | 4 | 0.9063 | 0.7500 |
| rich-criteria-examples | vitaminc/combined/dev | 200 | 200 | 0 | 0 | n/a | n/a |
| rich-criteria-examples | scifact/gold-rationale-set/dev | 199 | 199 | 0 | 0 | n/a | n/a |
| rich-criteria-examples | synthetic-smoke/prompt-contract-diagnostic/synthetic | 32 | 32 | 0 | 4 | 1.0000 | 1.0000 |
| dual-noul | vitaminc/combined/dev | 200 | 200 | 0 | 0 | n/a | n/a |
| dual-noul | scifact/gold-rationale-set/dev | 199 | 199 | 0 | 0 | n/a | n/a |
| dual-noul | synthetic-smoke/prompt-contract-diagnostic/synthetic | 32 | 32 | 0 | 4 | 0.7813 | 0.7500 |

JSON preserves every probability, native Noul output, compiled payload hash/bytes, exact model identity, usage, source manifests, error/exclusion and paired changes against the fresh baseline. Synthetic fixtures are reported separately; explicit expected-uncertain cases are excluded from binary quality, ranking and calibration, retained in all-case completion and expected-verdict diagnostics. This is exploratory development evaluation, not held-out or production qualification; billing is unknown unless returned.
