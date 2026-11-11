# Decision-model viability screen

Status: post-hoc analysis of committed observations. No new model calls. This narrows where evaluation effort goes; it changes no API catalog entry, default, prompt or threshold and qualifies no model for production.

## Rule

- **Quality:** paired source-group bootstrap of macro average precision across the cohort scorecards; the challenger interval must exclude zero and the candidate may not be significantly better on any scorecard.
- **Screened out:** quality-dominated in every shared cohort (at least 2) by a challenger whose successful p95 latency is no higher in each.
- **Deprioritized:** quality-dominated in every shared cohort without a consistent latency advantage, but unreplicated or with inconsistent latency ordering.
- **Viable:** not dominated, or consistently faster than every model that dominates it on quality.

Average precision ranks native contradictions by the raw contradiction score, so it does not depend on the shared 0.8/0.2 cutoff. It still depends on the shared `balanced-v1` prompt and on native labels that differ from the service contract. Latency is one sequential pass per route and varied severalfold between cohorts; it is used only as an ordering. The rule was written after these results were visible.

## Result

| Model | Status | archive-880: macro AP / p95 ms / errors | validation-688: macro AP / p95 ms / errors | Dominated by |
| --- | --- | ---: | ---: | --- |
| `drex-max-finance` | viable | 0.926 / 305 / 5 | 0.958 / 314 / 1 | — |
| `drex-max-v1.1` | viable | 0.918 / 332 / 1 | — | — |
| `fastino/GLiDE` | viable | 0.934 / 242 / 1 | 0.947 / 2129 / 75 ⚠ | — |
| `jev-1.14.0` | viable | 0.883 / 107 / 0 | 0.918 / 180 / 0 | — |
| `perplexity/pplx-decider-v1.2` | viable | 0.925 / 865 / 3 | 0.950 / 688 / 0 | — |
| `clef-flash` | deprioritized | 0.848 / 261 / 0 | 0.880 / 520 / 0 | `drex-max`, `drex-max-finance`, `fastino/GLiDE` |
| `clef-omni` | deprioritized | 0.885 / 694 / 1 | 0.911 / 146 / 0 | `drex-max-finance`, `drex-max-v1.1`, `fastino/GLiDE` |
| `drex-max` | deprioritized | 0.908 / 199 / 1 | 0.940 / 1515 / 3 | `drex-max-finance` |
| `drex-v1.5` | deprioritized | 0.871 / 249 / 0 | — | `drex-max`, `fastino/GLiDE` |
| `drex-v2.0` | deprioritized | 0.869 / 288 / 2 | — | `drex-max`, `fastino/GLiDE` |
| `perplexity/pplx-decider-flash-v1.2` | deprioritized | 0.886 / 258 / 2 | 0.909 / 240 / 0 | `drex-max`, `fastino/GLiDE` |
| `clef` | screened out | 0.866 / 787 / 1 | 0.896 / 579 / 0 | `drex-max-finance` |
| `google/gemini-decision-1` | screened out | 0.894 / 541 / 1 | 0.918 / 509 / 1 | `drex-max-finance` |
| `gpt-6-luna` | screened out | 0.795 / 534 / 2 | 0.797 / 412 / 0 | `drex-max-finance`, `jev-1.14.0`, `perplexity/pplx-decider-flash-v1.2` |
| `microsoft/microsoft-decision-1` | screened out | 0.852 / 403 / 0 | 0.842 / 334 / 0 | `drex-max-finance`, `perplexity/pplx-decider-flash-v1.2` |

⚠ marks an error rate of at least 2% in that cohort. Errors are excluded from average precision and reported here instead, so a reliability problem is not mistaken for a ranking problem.

## Re-measuring or adding a model

A status describes the measured model version under the current prompt, not the vendor. To add a model or revisit a status: measure it on a cohort's frozen inputs with `pnpm eval:measure`, archive the run with `scripts/archive-measurement.py`, append the archive's redacted observations to the cohort's `sources` in `eval/model-screen.json`, and write a new dated screen with `python3 -B scripts/screen-models.py --out NEW_ARCHIVE`. A later source replaces the same model ID; a new version under a new ID is screened beside the old one. A model measured on one cohort can be deprioritized but not screened out. Each screen keeps its own `cohorts.json`, so earlier screens remain verifiable.

Verify this archive offline with `python3 -B scripts/screen-models.py --verify` followed by its directory.
