# Business contradiction evaluation

This track measures supplied-evidence business cases separately from SciFact and VitaminC. It does not change the Worker, its default profile or its input limits. [The source research](../../docs/evaluations/business-dataset-landscape.md) records primary links, label provenance, licenses and deferred datasets. [Measured first-pass results](../results/business-2026-11-04/README.md) retain fixed inputs, failures and abstentions.

## Included tracks

| Track                      | Source and adaptation                                                                               | Limits                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commercial obligations     | ContractNLI: one hypothesis against **all** annotated evidence spans, joined in document order      | Oracle-excerpt adaptation of full-NDA labels; missing surrounding definitions/exceptions can matter. NotMentioned has no evidence and is excluded, so negatives here are entailed hypotheses. |
| Financial assertions       | FinDVer testmini information extraction: a statement against every annotated report paragraph/table | Original public evaluation variant; no tuning. Preserve headers, units and markup. No explanations enter inference. Most complete evidence exceeds the current 2 KB limit.                    |
| Business-adjacent language | MultiNLI government, telephone and Slate genres, original premise–hypothesis pairs                  | Government documents, general conversations and journalism, rather than workplace-native policy or CRM data. Other genres are excluded.                                                       |

These are separate scorecards. Do not pool them into a universal business accuracy, equate native labels with independently adjudicated service-contract labels, or claim the original full-document/genre leaderboard score. The research found promising requirements data, but [its grouping, provenance and label problems](../../docs/evaluations/requirements-dataset-audit.md) make it unsuitable for the first bounded phase.

## Prepare pinned inputs

Use Node 24 and pnpm. These commands fetch public data only; they make no model calls. Data and derived text manifests stay under ignored `eval/data/`. Cache files are verified against pinned bytes; incompatible cache contents fail rather than being silently replaced.

```sh
# Only ContractNLI train/dev and license/terms ZIP members are fetched. Test gold stays unopened.
python3 eval/business/fetch-contractnli.py
pnpm exec tsx scripts/prepare-business.ts --dataset contractnli \
  --input eval/data/business/contractnli/dev.json --split dev \
  --max-pairs 200 --out eval/data/business/contractnli-dev-200.json

# Official MultiNLI archive; extract only the requested JSONL member (default: dev_matched).
python3 eval/business/fetch-mnli.py --download
pnpm exec tsx scripts/prepare-business.ts --dataset mnli \
  --input eval/data/business/multinli_1.0_dev_matched.jsonl --split dev --variant dev_matched \
  --max-pairs 200 --out eval/data/business/mnli-nonfiction-dev-200.json

# Selective FinDVer report downloads; no whole-corpus download or external-knowledge subset.
pnpm exec tsx scripts/prepare-finance-business.ts --download --subset ie \
  --max-pairs 200 --out eval/data/business/findver-testmini-ie-23.json

# Complementary pair-length cohort: keep every complete supported pair, even if a sibling is too long.
pnpm exec tsx scripts/prepare-finance-business.ts --subset ie --envelope-policy individual-pairs \
  --max-pairs 200 --out eval/data/business/findver-testmini-ie-individual-82.json
```

All output paths are exclusive. Choose a fresh path on repetition. The default seed is `business-v1`. Selection orders source groups by a seeded hash without looking at labels. The pair cap can therefore undershoot. Default envelope filtering excludes an entire document/prompt/report group if any complete pair is oversized. The explicit `individual-pairs` finance option instead excludes only unsupported pairs, then samples whole remaining eligible report groups. It retains the original group identities and reports partial groups. Neither policy truncates a pair's evidence or manufactures missing negatives. Original IDs, splits, gold labels, annotation indices and source hashes remain available.

The initial strict finance cohort has 23 pairs; all 23 also occur unchanged in the 82-pair individual-length cohort. The latter adds 59 distinct cases. Report these as overlapping cohorts rather than 105 independent finance examples. The models and thresholds were frozen for both; the second cohort was selected from the byte audit, not model predictions.

The ContractNLI and MultiNLI adapters support original training data for future development, with development inputs kept distinct. MultiNLI's three selected genres all belong to its matched split; its mismatched development set yields no eligible rows. Duplicate native train pair IDs are disambiguated by original source row without dropping the underlying human examples. ContractNLI offsets are Unicode code points, preserving Python-style slicing. FinDVer deduplicates repeated references to the **same** paragraph index and records original indices; it retains all distinct referenced contexts.

The finance preparer accepts `--subset numeric` for a separately reported numerical-reasoning research track. The first measured business run uses IE only. Knowledge-intensive rows require outside regulations/domain knowledge and are excluded from the supplied-text core. Preserve report/issuer/content groups before any future train/validation split; do not use public evaluation variants for tuning.

## Run fixed baselines

The existing runner accepts all three new dataset identities. Supply credentials through the environment as described in [the evaluation guide](../README.md). Explicit live opt-in and call/spend caps are required; cost reservations are not measured invoices.

```sh
pnpm eval:run --manifest eval/data/business/contractnli-dev-200.json \
  --backend jev --profile balanced-v1 --live --max-calls 199 \
  --cost-per-call-usd .001 --max-spend-usd .20 --out eval/reports/business-contractnli-jev
```

Use `--backend clef` or `--backend decider` for the existing pinned routes. Jev remains 1.14. Run one hosted CLI at a time; an iteration CLI can make two requests concurrently. The first-pass protocol fixes thresholds and profiles before inference. Do not import the old science/Wikipedia-fitted scalar thresholds as if they were business calibration.

The evaluation-only `literal-contract` and `evidence-refutation` formulations run through `scripts/iterate.ts --purpose regression` on public development inputs. They retain their actual composition and raw signals; they are not deployed profiles. The iteration guard deliberately refuses unassigned locked-test inputs, including the finance evaluation manifest. The initial finance run therefore compares the three balanced baselines and local DeBERTa only.

The local DeBERTa scorer is the existing pinned `eval/deberta.py`. Use an output filename different from the replay report's checkpoint prefix, for example `model-output.jsonl` and `model-report`. Its native argmax has no abstention, unlike the hosted policies. It was trained on SNLI/MultiNLI; the MultiNLI result is an in-domain reference. Generic legacy metadata saying “zero-shot on this adaptation” must not override that training disclosure.

## Report coverage and provenance

Report contradiction precision/recall, false clears, native-negative coverage, uncertainty, errors, probability-metric denominators and source-group intervals. Keep entailment and neutral negatives separate where both exist. Also retain genre/hypothesis/report slices and the entire data funnel: original native rows, unavailable rationale labels, complete-evidence envelope exclusions, eligible groups and selected rows.

ContractNLI data is CC BY 4.0. The selected MultiNLI OANC genres have the permissions documented by the authors; this is not a blanket license claim for all fiction in the full archive. FinDVer declares MIT for repository artifacts, but the underlying issuer-report text has no separately verified redistribution terms. Consequently its full text and pair-containing reports remain local. Committed finance evidence contains hashes, IDs, labels, predictions and reconstruction code, with redacted reports explicitly identified as transformations rather than exact raw files. Never include gold explanations in model state.
