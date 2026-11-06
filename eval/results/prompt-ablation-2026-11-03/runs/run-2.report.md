# Jev 1.14 prompt ablation

One fixed pass; no threshold tuning. The baseline is fresh. Dual-noul changes representation and determinability policy as well as wording; no isolated prompt-only conclusion follows from that arm.

| Profile | Dataset | Pairs | Precision | Recall | F1 | Clear-negative coverage | Uncertain | Errors | AUROC |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | scifact/gold-rationale-set/dev | 199 | 0.9444 | 0.4789 | 0.6355 | 0.8359 | 0.2663 | 0 | 0.9649 |
| baseline | synthetic-smoke/prompt-contract-diagnostic/synthetic | 28 | 1.0000 | 1.0000 | 1.0000 | 0.8750 | 0.0714 | 0 | 1.0000 |
| baseline | vitaminc/combined/dev | 200 | 0.9000 | 0.3803 | 0.5347 | 0.7984 | 0.2950 | 0 | 0.8687 |
| rich-criteria | scifact/gold-rationale-set/dev | 199 | 0.9512 | 0.5493 | 0.6964 | 0.8438 | 0.2261 | 0 | 0.9824 |
| rich-criteria | synthetic-smoke/prompt-contract-diagnostic/synthetic | 28 | 1.0000 | 1.0000 | 1.0000 | 0.8750 | 0.0714 | 0 | 1.0000 |
| rich-criteria | vitaminc/combined/dev | 200 | 0.9310 | 0.3803 | 0.5400 | 0.7442 | 0.3400 | 0 | 0.8860 |
| rich-criteria-examples | scifact/gold-rationale-set/dev | 199 | 0.9500 | 0.5352 | 0.6847 | 0.8750 | 0.2111 | 0 | 0.9809 |
| rich-criteria-examples | synthetic-smoke/prompt-contract-diagnostic/synthetic | 28 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0 | 1.0000 |
| rich-criteria-examples | vitaminc/combined/dev | 200 | 0.9032 | 0.3944 | 0.5490 | 0.7674 | 0.3050 | 0 | 0.8798 |

## All-case execution and explicit contract diagnostics

| Profile | Dataset | All cases | Completed | Errors | Expected-uncertain excluded from binary | Expected-verdict accuracy | Uncertain-target recall |
|---|---|---:|---:|---:|---:|---:|---:|
| baseline | vitaminc/combined/dev | 200 | 200 | 0 | 0 | n/a | n/a |
| baseline | scifact/gold-rationale-set/dev | 199 | 199 | 0 | 0 | n/a | n/a |
| baseline | synthetic-smoke/prompt-contract-diagnostic/synthetic | 32 | 32 | 0 | 4 | 0.8750 | 0.5000 |
| rich-criteria | vitaminc/combined/dev | 200 | 200 | 0 | 0 | n/a | n/a |
| rich-criteria | scifact/gold-rationale-set/dev | 199 | 199 | 0 | 0 | n/a | n/a |
| rich-criteria | synthetic-smoke/prompt-contract-diagnostic/synthetic | 32 | 32 | 0 | 4 | 0.9063 | 0.7500 |
| rich-criteria-examples | vitaminc/combined/dev | 200 | 200 | 0 | 0 | n/a | n/a |
| rich-criteria-examples | scifact/gold-rationale-set/dev | 199 | 199 | 0 | 0 | n/a | n/a |
| rich-criteria-examples | synthetic-smoke/prompt-contract-diagnostic/synthetic | 32 | 32 | 0 | 4 | 1.0000 | 1.0000 |

JSON preserves every probability, native Noul output, compiled payload hash/bytes, exact model identity, usage, source manifests, error/exclusion and paired changes against the fresh baseline. Synthetic fixtures are reported separately; explicit expected-uncertain cases are excluded from binary quality, ranking and calibration, retained in all-case completion and expected-verdict diagnostics. This is exploratory development evaluation, not held-out or production qualification; billing is unknown unless returned.
