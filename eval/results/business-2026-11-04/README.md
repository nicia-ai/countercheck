# Business baseline results, 2026-11-04

Status: **completed, with no production/default change or deployment**. Twenty configurations/cohorts produce **2,310 hosted attempts** (2,308 successful pair responses, two deadline errors) and **504 local DeBERTa pair observations**. There are **481 distinct input pairs** across the domains. No prompt, threshold or model was fitted to these business labels; no old R4 fitted policy is applied. Domains and finance cohorts are reported separately, with no universal pooled business score.

Hosted results use pinned Jev `jev-1.14.0`, full Cloudflare `clef`, and Perplexity-only `perplexity/pplx-decider-v1.2`. Balanced-v1 uses its unchanged 0.8/0.2 rules. Literal/refutation are the existing evaluation-only formulations at fixed defaults. The local model is [`cross-encoder/nli-deberta-v3-base@6c749ce3425cd33b46d187e45b92bbf96ee12ec7`](https://huggingface.co/cross-encoder/nli-deberta-v3-base/blob/6c749ce3425cd33b46d187e45b92bbf96ee12ec7/README.md), forced NLI argmax with no abstention, no truncation, and a 512-token ceiling. Its model card reports SNLI/MultiNLI training: MultiNLI is an **in-domain reference**, not unseen transfer. These policies have different abstention behavior.

## Input coverage and task meaning

| Domain                               | Native source and adaptation                                                                                                                                |                                                      Measured sample | Coverage and limits                                                                                                                                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contracts                            | [ContractNLI](https://github.com/stanfordnlp/contract-nli), development full-contract labels transferred unchanged to complete annotated rationale excerpts |           199 pairs, 20 documents; 26 contradiction / 173 entailment | Of 614 binary pairs, 561 fit the strict whole-document group rule; 53 are excluded with four document groups. 423 NotMentioned cases lack positive evidence and are excluded. Native label scope remains the full contract; excerpt truth is not newly adjudicated.            |
| Business-adjacent language           | [MultiNLI](https://cims.nyu.edu/~sbowman/multinli/), complete government/telephone/slate development-matched pairs                                          | 200 pairs, 69 prompts; 67 contradiction / 72 entailment / 61 neutral | 5,866 labeled selected-genre pairs available; 134 unlabeled and 4,000 other-genre rows excluded; no envelope exclusions. Selected genres: government 62, slate 61, telephone 77. General nonfiction/dialogue is not workplace-native traffic.                                  |
| Finance, primary conservative cohort | [FinDVer](https://github.com/yilunzhao/FinDVer), testmini IE, all annotated paragraphs/tables                                                               |                 23 pairs, 16 report groups; 13 refuted / 10 entailed | All 250 IE claims retain complete gold support. 168 are individually too large at 2 KiB; a further 59 individually supported pairs are removed only by the strict unsupported-sibling rule. Thus 227 are excluded by the combined rule; they are not all oversized themselves. |
| Finance, final broader cohort        | Same complete evidence and native labels, with individual complete-pair envelope eligibility                                                                |                 82 pairs, 59 report groups; 44 refuted / 38 entailed | All 82 individually supported pairs retained; report IDs remain clustering/sampling groups. 168 oversized pairs excluded, without shortening support. Coverage is 32.8% of IE, still strongly length/source conditioned.                                                       |

Finance's broader eligibility rule was recorded before its inference as a label-blind coverage follow-up. It does not change the API limit, models or thresholds. It includes all original 23 pairs plus 59 new pairs: **23 + 82 is not 105 independent examples**. Input text hashes/native labels agree for all shared pairs; all three hosted backends have identical payload hashes on 23/23 shared pairs. The final distinct input count is 199 + 200 + 82 = 481. Prior locked evaluation files remain unopened; public finance testmini is used only as the declared published evaluation variant.

## Contracts: 199 pairs

| Configuration             | TP / FP | Precision | Recall | Clear negatives | Positive false clears | Uncertain / error / excluded |
| ------------------------- | ------: | --------: | -----: | --------------: | --------------------: | ---------------------------: |
| Jev balanced              |  12 / 2 |     85.7% |  46.2% | 115/173 = 66.5% |                     2 |                   68 / 0 / 0 |
| Clef balanced             |   8 / 0 |    100.0% |  30.8% |  59/173 = 34.1% |                     0 |                  132 / 0 / 0 |
| Decider balanced          |  14 / 1 |     93.3% |  53.8% |  96/173 = 55.5% |                     0 |                   88 / 0 / 0 |
| DeBERTa forced            | 13 / 14 |     48.1% |  50.0% | 159/173 = 91.9% |                    13 |                    0 / 0 / 0 |
| Jev literal (eval)        |  16 / 3 |     84.2% |  61.5% | 148/173 = 85.5% |                     3 |                   29 / 0 / 0 |
| Decider refutation (eval) |  11 / 0 |    100.0% |  42.3% | 109/173 = 63.0% |                     0 |                   79 / 0 / 0 |

No hosted configuration meets the three point targets jointly. Jev literal finds more native contradictions than balanced here, with additional false positives. This is an oracle gold-rationale excerpt task; definitions, exceptions or cross-references outside the excerpt can still matter. It is not the official full-document ContractNLI score or independently human-adjudicated service-contract accuracy. Per-hypothesis-ID results are retained in `summary.json`.

## Business-adjacent MultiNLI: 200 pairs

| Configuration             | TP / FP | Precision | Recall | Clear negatives | Positive false clears | Uncertain / error / excluded |
| ------------------------- | ------: | --------: | -----: | --------------: | --------------------: | ---------------------------: |
| Jev balanced              |  38 / 0 |    100.0% |  56.7% | 107/133 = 80.5% |                     3 |                   52 / 0 / 0 |
| Clef balanced             |  27 / 0 |    100.0% |  40.3% |  75/133 = 56.4% |                     1 |                   97 / 0 / 0 |
| Decider balanced          |  45 / 1 |     97.8% |  67.2% |  81/133 = 60.9% |                     0 |                   72 / 1 / 0 |
| DeBERTa forced            |  62 / 3 |     95.4% |  92.5% | 130/133 = 97.7% |                     5 |                    0 / 0 / 0 |
| Jev literal (eval)        |  43 / 1 |     97.7% |  64.2% | 101/133 = 75.9% |                     1 |                   54 / 0 / 0 |
| Decider refutation (eval) |  54 / 1 |     98.2% |  80.6% |  95/133 = 71.4% |                     0 |                   49 / 1 / 0 |

The forced local NLI reference meets the three point targets on this sample, with known MultiNLI training exposure and five positive false clears. It does not establish a general business or hosted API result. Hosted refutation reaches 80.6% recall; neither hosted prompt family reaches 90%. Each Decider configuration has one timeout, kept in the 200-pair denominators. Entailment and neutral are both native binary non-contradiction for these metrics; that projection does not turn neutral into service-contract evidence of consistency. Genre slices and original native-label slices remain separate in the source reports/derived summary.

## Finance: all 82 individually supported pairs

| Configuration    | TP / FP | Precision | Recall | Clear negatives | Positive false clears | Uncertain / error / excluded |
| ---------------- | ------: | --------: | -----: | --------------: | --------------------: | ---------------------------: |
| Jev balanced     |  37 / 0 |    100.0% |  84.1% |   27/38 = 71.1% |                     1 |                   17 / 0 / 0 |
| Clef balanced    |  12 / 0 |    100.0% |  27.3% |   21/38 = 55.3% |                     2 |                   47 / 0 / 0 |
| Decider balanced |  39 / 0 |    100.0% |  88.6% |   31/38 = 81.6% |                     2 |                   10 / 0 / 0 |
| DeBERTa forced   |  19 / 1 |     95.0% |  43.2% |   33/38 = 86.8% |                    22 |                    0 / 0 / 7 |

The strongest hosted point is Decider at 39/44 positives, 88.6% recall, and 31/38 negatives cleared (81.6%). Both recall and negative coverage remain below target; zero observed false positives in this small cohort is not a reliability guarantee. DeBERTa excludes seven complete inputs that exceed its token budget: probability metrics use 75 observed distributions, while recall and coverage retain all 82 cases. It falsely clears 22 native positives. No evidence is truncated to rescue inputs.

### Preserved conservative finance cohort: 23 pairs

| Configuration    | TP / FP | Precision | Recall | Clear negatives | Positive false clears | Uncertain / error / excluded |
| ---------------- | ------: | --------: | -----: | --------------: | --------------------: | ---------------------------: |
| Jev balanced     |  10 / 0 |    100.0% |  76.9% |    7/10 = 70.0% |                     1 |                    5 / 0 / 0 |
| Clef balanced    |   5 / 0 |    100.0% |  38.5% |    5/10 = 50.0% |                     0 |                   13 / 0 / 0 |
| Decider balanced |  11 / 0 |    100.0% |  84.6% |    7/10 = 70.0% |                     1 |                    4 / 0 / 0 |
| DeBERTa forced   |   4 / 1 |     80.0% |  30.8% |    7/10 = 70.0% |                     8 |                    0 / 0 / 3 |

These four earlier runs remain preserved rather than replaced by the broader cohort. The local model has three token exclusions here, all shared with its later seven exclusions. Across both finance runs that is ten exclusion observations but seven distinct excluded pairs. Hosted finance has no observed errors. Both cohorts are supplied-evidence adaptations of the authors' native `entailed`/`refuted` annotations, not full-report retrieval, official leaderboard equivalence, or new service-contract adjudication.

## Length sensitivity, without API or model changes

An offline audit preserves all annotated evidence and applies hypothetical raw evidence-byte ceilings with the strict whole-source grouping rule:

|           Raw evidence ceiling | ContractNLI binary pairs retained, of 614 | FinDVer IE pairs retained, of 250 |
| -----------------------------: | ----------------------------------------: | --------------------------------: |
| 2,048 bytes (actual API limit) |                                       561 |                                23 |
|     4,096 bytes (hypothetical) |                                       614 |                               152 |
|     8,192 bytes (hypothetical) |                                       614 |                               212 |
|    12,288 bytes (hypothetical) |                                       614 |                               227 |

The 2 KiB evidence limit constrains business coverage, especially report/table evidence. These larger values do **not** establish compiled-request acceptance, tokenizer acceptance or model quality, and the API limit is unchanged. An accompanying individual-pair audit retains 82/202/234/242 finance pairs at these ceilings; the gap distinguishes actual oversized pairs from supported siblings dropped by strict source-group eligibility. Exact scripts and JSON are archived under `audits/`; no extra model calls were used for these audits.

## Execution, usage and provenance

The preregistered cap is 3,000 hosted attempts with a $3 conservative reservation. Actual billing is unknown. Jobs run one hosted CLI at a time, at most two concurrent requests within a CLI, with a 3,000 ms evaluation deadline, no retries/fallbacks and no truncation. This is direct kernel/provider evaluation, not the authenticated deployed Worker or a service SLA.

The first 995 contract hosted attempts use Node v26.13.0 from the initial launcher; the next 1,000 MultiNLI attempts and 315 finance attempts use pinned Node v24.22.2. Runtime variation is preserved without rerunning paid calls. One ordinary timeout lacks a provider request ID/explicit dispatch receipt; its unique pass/pair attempt journal is used locally, never an invented upstream ID. The iteration timeout records one dispatch. Thus 2,310 is an operational hosted-attempt count, not proof of that many completed upstream inferences or charges.

An initial DeBERTa replay report prefix collided with its already written predictions and stopped in preflight, with no new model/provider calls. The fresh `-deberta-replay` report prefix resolves it; original predictions remain unchanged. Local CPU batch-forward time excludes load/tokenization and is not compared with hosted request latency. Metadata/runtime/model revision are retained.

| Backend | Hosted attempts | Reported input tokens | Unknown input attempts | Reported output subtotal | Unknown output attempts |
| ------- | --------------: | --------------------: | ---------------------: | -----------------------: | ----------------------: |
| Jev     |             903 |               638,685 |                      0 |                   22,144 |                     504 |
| Clef    |             504 |               285,838 |                      0 |                        0 |                     504 |
| Decider |             903 |               570,683 |                      2 |                      796 |                     505 |

Known input subtotal is 1,495,206 tokens; output subtotal is 22,940. Unknown usage is not imputed as measured zero. Exact model-returned identities and calibration/risk/latency data remain in reports. Failure/exclusion rows stay in confusion, recall and coverage denominators; AUROC/AP/Brier use only rows with observed probabilities, with their own denominator.

## Archive, licenses and offline reproduction

`artifact-sha256.json` pins original, stored and transformed-content bytes. Selected ContractNLI/MultiNLI manifests and non-finance reports/checkpoints are byte-exact; original license/terms bytes are never formatted. ContractNLI uses CC BY 4.0 with the supplied terms and citation; selected MultiNLI nonfiction genres follow the authors' OANC terms. See the [dataset landscape](../../../docs/evaluations/business-dataset-landscape.md) and [preparation guide](../../business/README.md).

FinDVer's repository declares MIT, while separate underlying issuer-text redistribution terms are not established. **No finance claim, evidence or full report text is included here.** Finance manifests/reports are explicitly transformed: each removed claim/evidence has SHA-256 and byte count, and native labels, IDs, report/group identity, source URLs/revision and all source report SHA remain. Checkpoints contain typed distributions, not issuer text. The ledger records original raw hashes but the default reproducer cannot recreate those withheld originals from redacted bytes. It verifies stored/transformed hashes and reproduces all metrics without accessing issuer text.

To reconstruct finance locally in an ignored cache, use the archived supporting preparation versions and pinned sources:

```sh
pnpm exec tsx scripts/prepare-finance-business.ts --download --subset ie --max-pairs 200 --seed business-v1 --out eval/data/business/rebuilt-strict.json
pnpm exec tsx scripts/prepare-finance-business.ts --subset ie --envelope-policy individual-pairs --max-pairs 200 --seed business-v1 --out eval/data/business/rebuilt-individual.json
```

Measured strict input SHA: `94cc439d2373a9feefad3e6ab3ed17a20565b1272cc1e44a23e41d88d58192dc`. Measured individual input SHA: `3e3f6515bdf307c218dbdac18c280188d9c36a9cf21a843e349fc4d4b368ae12`. The earlier `-ie-200` finance preparation file was unscored and is not archived as measured input. Cached downloads are bounded and verified; no model call is part of preparation. Preparation-source versions captured after generation are supporting provenance, not retroactive inference freezes.

Phase 1 has a pre-call snapshot of 38 TS/package files. Phase 2 and phase 3 snapshots include Python as a 39th file. Original/resume/finance launchers, protocols and completion receipts are preserved. The current scorer's training-metadata wording was corrected only after the first two phases; measured original metadata and snapshot source remain untouched. Its weights, inference and returned predictions were not changed. MultiNLI's streamed-preparation rebuild receipt verifies the original measured manifest SHA remained unchanged.

```sh
python3 -B eval/results/business-2026-11-04/aggregate.py
python3 -B eval/results/business-2026-11-04/test_reproduction.py
```

The standard-library reproducer verifies artifact/source/checkpoint hashes, native-label mapping, exact pair coverage, default decisions, confusion, precision/recall/F1/coverage, probability denominators and tie-aware AUROC/AP/Brier. It reports genre/clause slices and verifies finance cohort overlap. Three focused regressions cover partial/error probability subsets and the actual affected runs. It makes no network/model calls, fits nothing, opens no prior locked manifests and creates no artifact import caches. No stage qualifies a universal business score or meets the independent human 500 / locked 200 service-contract release gate.

Final verification: **119 inventoried artifacts, 20 runs**; all independent checks and three denominator regressions pass. A second rebuild produces byte-identical summary JSON/CSV. Both measured finance input hashes remain unchanged; a full archive scan found none of the 82 finance claims/evidence strings, and the unscored old finance input is absent. No artifact `__pycache__` is created.
