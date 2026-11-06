# Public supplied-evidence evaluation

For a standalone overview, start with **[evaluation approach and results](../EVALUATION.md)**. It explains the task, datasets, fixed policy, the original nine models, the five-model Nace extension, and how to bring a scorer. To independently verify the published nine-model metrics from committed redacted files only, run `python3 -B scripts/verify-eval-release.py` (no credentials, raw dataset text, Node or network required). The rest of this file is the detailed runner and preparation reference.

The [post-hoc supplement](results/hosted-models-analysis-2026-11-05/README.md) adds source-group paired intervals, coverage by native label, AUROC/AP and retrospective recall at ≥95% observed precision. Four scorecards reuse development data; finance is previously scored and untuned. The [main findings and limitations](../EVALUATION.md#what-we-see) explain what these diagnostics support.

This directory contains executable VitaminC/SciFact benchmarks, a separate [business track](business/README.md), an offline DeBERTa baseline and an explicitly synthetic transport smoke test. Measured public baselines are saved under `results/`; they do not certify the production release gates. No older Jev version is evaluated. All model/network evaluation calls require explicit selection and budget reservations.

The measured development results use the same 399 frozen supplied-evidence pairs:

- [Jev 1.14](results/jev-dev-2026-11-03/README.md): actual direct hosted calls through the kernel, requested and returned `jev-1.14.0` on all pairs, zero errors/exclusions, fixed abstaining thresholds and preserved checkpoints.
- [Full Clef](results/clef-dev-2026-11-03/README.md): actual Cloudflare Workers AI REST calls through the unchanged kernel, returned `clef` on all 399 pairs, zero errors/exclusions and fixed abstaining thresholds.
- [Perplexity Decider](results/decider-dev-2026-11-03/README.md): actual hosted kernel calls, one error retained per dataset, the same abstaining thresholds.
- [DeBERTa NLI](results/deberta-dev-2026-11-03/README.md): pinned local CPU checkpoint, forced native argmax decisions, zero errors/exclusions.

The Clef and Jev results contain same-input comparisons across all four systems and explain their different abstention coverage. These are development diagnostics with documented group-selection bias; no model winner or production qualification is established. Earlier result notes record the circumstances at their original run time, including the then-unavailable TypeSafe credential; the later Jev result supersedes that availability note.

From the repository root with Node 24 and dependencies installed:

```sh
pnpm eval:smoke
pnpm eval:prepare --help
pnpm eval:run --help
```

The smoke transport returns the same uncertain distribution without consulting the fixture gold labels or a model. Its eight hand-authored examples and resulting metrics establish that report generation works, **not** contradiction quality. Report prefixes refuse overwrite; choose a fresh prefix for subsequent smoke runs with `pnpm eval:run --backend fake --manifest eval/fixtures/synthetic-smoke.json --out eval/reports/smoke-2`.

## Prepare the public datasets

Preparation makes no model calls. `--download` explicitly downloads the official archive; otherwise files must already exist locally. Python 3's standard library extracts only the requested members, without unpacking archive paths. Downloads are capped at 512 MiB, cached locally and hashed; partial downloads are never reused. The SciFact archive is small; the full VitaminC archive is approximately 22 MB compressed at inspection. Separate real/synthetic VitaminC archives contain **test only**.

```sh
# Development protocol: up to 200 pairs per dataset, complete contrast/rationale groups.
pnpm eval:prepare --dataset vitaminc --variant combined --download --split dev --max-pairs 200 --out eval/data/vitaminc-combined-dev-200.json
pnpm eval:prepare --dataset scifact --download --split dev --max-pairs 200 --out eval/data/scifact-dev-200.json

# Local files work without any downloads.
pnpm eval:prepare --dataset vitaminc --variant real --input /path/to/test.jsonl --split test --out /path/to/vitaminc-real-test.json
pnpm eval:prepare --dataset scifact --claims /path/to/claims_dev.jsonl --corpus /path/to/corpus.jsonl --split dev --out /path/to/scifact-dev.json

# After protocol/threshold freeze, prepare separately reported locked test tracks.
pnpm eval:prepare --dataset vitaminc --variant real --download --split test --out eval/data/vitaminc-real-test-200.json
pnpm eval:prepare --dataset vitaminc --variant synthetic --download --split test --out eval/data/vitaminc-synthetic-test-200.json
```

Create the output directory first for arbitrary destinations. The automatic cache directory is created by preparation. Increasing `--max-pairs` selects more data; the default is a quick development-sized sample, including when selecting a test file. An entire available labeled split can be selected with a cap larger than its row count. Selection preserves whole revision/claim groups, so the result may undershoot the requested cap. No group is partially included to fill the last slot. Same seed and input bytes produce the same pair set; a deterministic greedy procedure approximates native label proportions, with achieved strata recorded explicitly. Large revision groups can prevent very small caps from selecting any pair.

The greedy label-proportion sampler is **not a uniform or population-representative group sample**. Seeded hashes break ties; group size and label composition affect which groups are selected. New manifests record native population versus selected group-size histograms, means, maxima and mixed-label fractions. [Post-run diagnostics of the unchanged first samples](results/sampling-diagnostics-2026-11-03.json) quantify this: VitaminC selected 25 groups with mean size 8 versus 16,503 population groups with mean 3.82; SciFact selected 151 groups with mean size 1.32 versus 188 population groups with mean 1.80. The selected pairs and historical model outputs are unchanged. Interpret these runs as development diagnostics, not estimates of full-split model quality.

VitaminC accepts `unique_id`/`id`, `label`/`gold_label`, `claim` and `evidence`. It preserves original IDs and available case, Wikipedia revision, page and group metadata. Selection groups Wikipedia revisions when available, otherwise case IDs, otherwise identical claim hashes. REFUTES is positive; SUPPORTS and NOT ENOUGH INFO are separate native negative slices. Real and synthetic tests remain separate. The combined development release is labeled `combined`, not falsely presented as a pure real-source slice.

SciFact joins **each complete gold rationale set** in its annotated sentence order into one snippet and preserves all sentence indices. It does not assign the set's label to individual sentences, introduce arbitrary corpus negatives, or infer labels from `cited_doc_ids`. SUPPORT is negative and CONTRADICT positive. Claims without annotated evidence are counted as excluded unlabelled claims. Public SciFact test lacks gold rationale labels, so this adapter refuses to call it a scored test set. This is an **oracle gold-rationale supplied-evidence adaptation**, not the official retrieval or full-abstract task.

Every manifest records original splits, sampling seed, adapter version, input-file SHA-256, downloaded-archive SHA-256 when applicable, repository documentation revision, source URL and data-specific license. The official archive URLs can change: hashes pin the bytes actually used; the documentation commit does not falsely imply that the mutable archive is commit-versioned. `--source-url` and `--revision` can identify a separately obtained release. Keep a published run's exact manifest and cached files together.

| Source                                                                                                              | Pinned documentation revision              | Terms                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [VitaminC](https://github.com/TalSchuster/VitaminC)                                                                 | `eb532922b88b199df68ed26afeb58dca5501b52f` | [Wikipedia article terms / CC BY-SA 3.0 fallback; synthetic derives from FEVER](https://github.com/TalSchuster/VitaminC/blob/eb532922b88b199df68ed26afeb58dca5501b52f/DATA_LICENSE) |
| [SciFact data format](https://github.com/allenai/scifact/blob/68b98a56d93e0f9da0d2aab4e6c3294699a0f72e/doc/data.md) | `68b98a56d93e0f9da0d2aab4e6c3294699a0f72e` | [Claims/annotations CC BY 4.0; abstracts ODC-By 1.0](https://github.com/allenai/scifact/blob/68b98a56d93e0f9da0d2aab4e6c3294699a0f72e/LICENSE.md)                                   |

Attribute Schuster, Fisch and Barzilay, _Get Your Vitamin C! Robust Fact Verification with Contrastive Evidence_ (NAACL 2021), and Wadden et al., _Fact or Fiction: Verifying Scientific Claims_ (EMNLP 2020). Repository code licenses do not replace data terms. Synthetic smoke fixture texts alone are CC0-1.0; that designation is not a repository code license. ANLI and other conditional/adapted datasets are deliberately not auto-downloaded.

## Run bounded model comparisons

Set credentials in the shell environment without placing keys in commands or output. Jev requires `TYPESAFE_API_KEY`. Clef REST requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; Decider requires `OPENROUTER_API_KEY`. Service evaluation uses `COUNTERCHECK_API_KEY`. Provider adapters pin their model identifiers and do not retry or switch models. The service evaluation client requests manual redirect handling and rejects every 3xx without following it or consuming its body. Internal `ServiceError` codes retain separate provider outage, timeout and malformed-response outcomes without exposing provider messages.

```sh
# First run: at most 10 calls, sequential; kernel deadline 3 seconds, no retries.
# These dollar values are operator reservations, NOT measured vendor prices.
pnpm eval:run --manifest eval/data/scifact-dev-200.json --backend jev --live --limit 10 --max-calls 10 --cost-per-call-usd 0.10 --max-spend-usd 1 --out eval/reports/scifact-dev-jev-first

# Equivalent single-pair payload/compiler, direct classify/validate path bypassing evaluateCheck.
pnpm eval:run --manifest eval/data/scifact-dev-200.json --backend jev-direct --live --limit 10 --max-calls 10 --cost-per-call-usd 0.10 --max-spend-usd 1 --out eval/reports/scifact-dev-jev-direct-first

# Same manifest, actual deployed service pipeline; 6-second client transport deadline.
# URL must be HTTPS except loopback.
pnpm eval:run --manifest eval/data/scifact-dev-200.json --backend service --url https://YOUR_PREVIEW_ORIGIN --live --limit 10 --max-calls 10 --cost-per-call-usd 0.10 --max-spend-usd 1 --out eval/reports/scifact-dev-service-first
```

Use `--backend clef` and `--backend decider` with the same protocol and explicit budgets for full model comparisons. Planned pairs, passes and batching are checked against the call/spend reservation before any inference. Reservation values are supplied by the operator and are **not** a guaranteed vendor charge cap. Actual cost is unknown unless a replay explicitly supplies measured per-row cost. The reports keep unavailable usage unknown, rather than assuming zero cost. Excluded input bytes do not cause inference calls; provider failure and timeout count as errors, never clean negatives.

The default kernel/direct-provider deadline is 3,000 ms. The service route defaults to a separate **6,000 ms client transport deadline**: the server may spend up to 2,000 ms reading the body and then 3,000 ms in its application budget, with 1,000 ms allowed for transport overhead. The server's 2,500 ms provider deadline is contained within its application budget, not added to it. `--timeout-ms` explicitly overrides the selected route default, including shorter deadlines for intentional stress tests. Reports record the deadline scope, default/override policy and server budget components. Replay performs no inference: its dispatch route, presentation, batch size, concurrency and timeout fields are null. Source runtime settings remain in `prediction_metadata`, and `prediction_artifact` pins the exact prediction-file and available metadata-file SHA-256 hashes. The direct/kernel 3-second operation budget is a comparator protocol, not the deployed service's nested 2.5-second provider limit or authentication path; use the service route for operational completion measurements. These are protocol limits, not measured latency guarantees.

Before dispatch, the runner creates the output directory and exclusively opens `PREFIX.predictions.jsonl` plus its manifest-bound `.metadata.json` sidecar. Every completed batch is appended and synced before the next call. If summarization, final report writing, a later call or process execution fails, completed predictions remain available for inspection/replay; they are never deleted as failure cleanup. Existing checkpoints also block accidental reuse of the prefix. A complete checkpoint can be passed to `--backend replay`; an interrupted partial checkpoint still fails exact-coverage validation until the operator deliberately supplies the missing observations or prepares a separately identified smaller manifest. There is no automatic resume, retry or extra spend. Caller request timings exclude checkpoint disk I/O.

Token totals are `null` if any attempted usage observation is unknown. `cost.token_usage` retains known subtotals and known/unknown observation counts; request usage is deduplicated across bundled pairs, while older offline rows remain pair observations. `request_observations[].usage` preserves live request totals without allocating them to pairs. Raw native distributions remain unchanged; newly derived pooled probabilities are divided by the native distribution's actual sum to accommodate accepted rounding. Historical reports retain their original values.

Use `--passes 3` for unchanged repeats. Separately run `--presentation original`, `reversed`, and `shuffled` with the same frozen manifest and seed. Kernel modes permute the actual compiler state/questions while retaining pair identities. Public-service reversal changes caller array order and tests canonicalization only; service shuffle is rejected because it cannot control the private provider order. `--batch-size 1` is isolation; `--batch-size 20` bundles only identical claims, ensuring every comparison remains a valid labeled pair. Batches are fixed submissions, not greedy envelope packing. If one pair exceeds a per-text limit, the entire submitted batch is excluded before inference; if their combined compiled payload exceeds 16 KiB, every member receives a compiled-envelope exclusion. A pair that fits in isolation can therefore be excluded in a larger request. This deliberately exercises the endpoint's atomic request envelope; it never silently drops comparisons, repacks a failed batch or makes extra calls. The JSON and Markdown report identify `atomic_batch_envelope_stress`, the whole-batch exclusion policy and disabled automatic repacking. Compare isolation quality only with other isolation runs, and compare batching coverage only under the same submitted-batch/packing protocol. For a common-input quality comparison, select a fitting fixed input set in advance and report its exclusions separately. These natural bundles do not replace manually designed distractor-contamination fixtures or the required custom locked corpus. Caller-ID reassignment and capacity testing at concurrency 6/production load remain separate release qualifications; this runner records concurrency 1.

New reports use schema version 2. They distinguish `public_dataset` from `measurement_stage` (`public_development`, `public_locked_test`, or `synthetic_smoke`) and explicitly record `production_qualification: "not_assessed"`. The former `public_performance_claim` field was ambiguous and is no longer emitted. Immutable schema-version-1 results retain their original fields and must be interpreted with their recorded purpose and limitations; a historical true value does not certify production readiness.

Both JSON and Markdown reports are written. JSON includes full four-choice raw service distributions, derived binary/uncertainty probabilities, model/engine identity, compiled payload hash for kernel calls, order/pass, original native labels and rationale metadata, per-pair errors/exclusions and request observations. No keys, upstream error bodies or provider outputs outside the validated probability envelope are printed. Public data and gold labels are included in the report rows for reproducibility; do not use this public-report workflow for private customer text without explicit authorization.

## Offline DeBERTa and replay

Use a separate environment for optional Python dependencies:

```sh
python3.12 -m venv eval/data/venv-deberta
eval/data/venv-deberta/bin/pip install -r eval/requirements.txt
eval/data/venv-deberta/bin/python eval/deberta.py --help

# Explicitly allow the first checkpoint/tokenizer download; later runs use the local cache.
eval/data/venv-deberta/bin/python eval/deberta.py --manifest eval/data/scifact-dev-200.json --out eval/data/scifact-deberta.jsonl --allow-download
pnpm eval:run --manifest eval/data/scifact-dev-200.json --backend replay --predictions eval/data/scifact-deberta.jsonl --out eval/reports/scifact-dev-deberta
```

The checkpoint [cross-encoder/nli-deberta-v3-base](https://huggingface.co/cross-encoder/nli-deberta-v3-base) is pinned to `6c749ce3425cd33b46d187e45b92bbf96ee12ec7`. The scorer verifies its actual config's label order: **0 contradiction, 1 entailment, 2 neutral**. Evidence is the premise and claim the hypothesis. Its disclosed training is SNLI/MultiNLI; this is an off-the-shelf zero-shot comparator on these adapted datasets, not a dataset-finetuned verifier. Actual local CPU development baselines on VitaminC200 and SciFact199 are preserved in [the 2026-11-03 measured results](results/deberta-dev-2026-11-03/README.md); these are separate from transport smoke verification and are not hosted latency measurements.

Tokenization never truncates. Over-512-token pairs produce explicit exclusions, retained in total coverage and positive-recall denominators; no inference result is fabricated. Model-forward batch timing is copied to pair observations and clearly identified in metadata; it excludes loading/tokenization and must not be compared with deployed request latency. Model identity, checkpoint, package versions, device, batch size, policy, token cap and manifest hash accompany the JSONL. The default policy is forced three-way argmax mapped to contradiction-vs-rest; `--policy fixed-0.8` is only a fixed abstention diagnostic, **not** a development-tuned matched-coverage claim. No threshold tuning is performed on a locked test.

Replay requires every selected pair/pass exactly once, valid normalized probabilities, no verdict on errors and metadata binding the exact manifest hash for public datasets. Metadata defaults to `PREDICTIONS.metadata.json`; `--prediction-metadata` overrides it. This supports independent scorers without putting PyTorch in the Worker. Keep native NLI distributions in `nli_probabilities`; do not equate neutral with the service's insufficient-context category.

## Reading the metrics

Primary contradiction precision/recall/F1 uses definitive service verdicts. Positive uncertainty, failures and envelope exclusions remain misses in recall. Coverage and clear-negative coverage include all attempted/selected pair observations. A separate forced binary-at-0.5 view uses contradiction score for cross-system discrimination; the encoder's native forced argmax verdict is retained independently. Native negative slices and each dataset/variant/split are reported separately, preventing a large synthetic set from hiding a small real-source failure.

AUROC uses tie-aware ROC integration; PR-AUC is tie-aware average precision with prevalence shown. Calibration includes binary Brier, ten-bin reliability data and expected calibration error. Risk-versus-coverage uses confidence-ranked forced binary decisions. Ranking/calibration exclude missing distributions and state that denominator explicitly. Wilson intervals accompany rates; deterministic claim-group bootstrap intervals retain correlated rationale sets, contrast pairs and passes for F1/AUC/Brier and primary rates. Wilson's independent-observation assumption is stated and should not supersede the clustered interval for repeated/grouped observations.

For a common-input model comparison, freeze the intersection of service byte envelopes and every comparator's tokenizer envelope **before scoring**, publish all exclusions and keep the all-selected operational service view beside it. This runner preserves per-system exclusion/error denominators; it does not silently calculate a favorable common subset. Model selection requires a separate development-tuned matched-coverage abstention comparison, locked-test freeze, real human-adjudicated pairs and the safety/capacity gates in `docs/design.md`. A common-input gold-rationale score does not measure retrieval, whole-document consistency, or production readiness.

## Decision-model prompt engineering

The [Jev prompt study](../docs/evaluations/decision-model-engineering-2026-11-03.md) compares a fresh baseline, direct policy instructions, richer structured criteria, eight rubric examples and a two-Noul composition. The initial five arms and two unchanged repeats completed 4,741 requests without errors. Exact public/AI-authored diagnostic inputs, frozen profiles, compressed observations, reproduction commands and per-run metrics are in the [result archive](results/prompt-ablation-2026-11-03/README.md).

Run the explicit experimental CLI with `pnpm exec tsx scripts/prompt-ablation.ts --help`. It uses the pinned Jev 1.14 credential, fixed byte/deadline/call/spend limits and incremental checkpoints. It is outside the production import graph. The synthetic diagnostics are not human-adjudicated release truth; four context-uncertain cases stay outside binary quality metrics. Repeated runs are not independent new labeled examples, and Noul's scored binary marginal plus separate determinability gate is not a joint three-class distribution. Candidate selection and all 399 public pairs are development work; production promotion additionally needs an efficient 20-comparison compiler and held-out qualification.

## Compare every exposed hosted model

The generic `hosted` backend selects the same closed catalog and provider adapters as the API:

```sh
pnpm eval:run --backend hosted --model gpt-6-luna \
  --manifest eval/data/scifact-dev-200.json --live --max-calls 199 \
  --cost-per-call-usd .002 --max-spend-usd .398 --out eval/reports/luna-scifact-new
```

Jev requires `TYPESAFE_API_KEY`, OpenAI Decisions requires `OPENAI_API_KEY`, and the three
OpenRouter models require `OPENROUTER_API_KEY`. Clef variants use the native Workers AI binding
through Wrangler's remote proxy. Bind the checkout to your own named Wrangler profile and
configure your Cloudflare account; the published maintainer run used `nicia-ai`. No
credentials are loaded from a developer's other project by the committed runner. Configure them
in the calling environment without printing values. Existing `jev`, `clef` REST and `decider`
backends retain their original interfaces.

The full existing frozen scorecard matrix uses 880 distinct public pairs per model (VitaminC,
SciFact, ContractNLI, MultiNLI nonfiction and the 82-pair supported FinDVer cohort), plus two
synthetic diagnostics totaling 40 cases per model. It runs sequentially, one pass per model,
with fixed `balanced-v1` policy, original presentation and the existing 3,000ms kernel deadline.
It does not open the separate tuning program's locked holdout or fit prompts or thresholds.
The original 23-pair finance scorecard is derived as a subset, not run or counted twice.

```sh
pnpm exec tsx scripts/run-hosted-matrix.ts --live --max-calls 7360 \
  --cost-per-call-usd .002 --max-spend-usd 15 --out eval/reports/hosted-matrix-new
pnpm exec tsx scripts/summarize-hosted-matrix.ts \
  --in eval/reports/hosted-matrix-new --out eval/results/hosted-matrix-new
python3 -B scripts/check-hosted-matrix.py eval/results/hosted-matrix-new
```

Each matrix invocation requires a fresh directory. Inputs, execution source hashes and protocol
are recorded before inference; source/input drift stops final summarization. Completed prediction
checkpoints are synced per request; failed processes retain them and do not retry or resume.
The archive removes every claim and evidence text, preserving scoring metadata and text hashes;
raw finance report text stays in ignored local storage. The Python check independently recomputes
confusion, probability metrics, latency and usage from the redacted scoring rows without model
calls. Reservation checks are operator accounting, not vendor-enforced caps or measured invoices.
These provider/kernel timings do not measure authenticated production API latency, capacity,
repeat stability, or independently adjudicated service-contract quality.

The [November 5 nine-model comparison](../docs/evaluations/hosted-model-comparison-2026-11-05.md)
adds hosted Fastino GLiDE 27B as an **evaluation-only comparator**, leaving the exposed API catalog
unchanged. Fastino uses `FASTINO_API_KEY` from the calling environment, fixed `fastino/GLiDE`,
`store:false`, and `thinking:false`. The smaller family sizes remain pending, per owner direction.

```sh
pnpm eval:run --backend fastino --manifest eval/data/scifact-dev-200.json \
  --live --max-calls 199 --cost-per-call-usd .002 --max-spend-usd .398 \
  --out eval/reports/glide-scifact-new
```

The archived append phase records three prior integration probes separately from the 920 scored
cases and verifies the shared kernel and exact original inputs against the eight-model baseline.
`scripts/run-fastino-benchmark.ts` reproduces that declared append protocol with explicit live opt-in
and budget bounds. `scripts/compare-fastino.py` independently checks the extension, verifies the
parent archive and produces the combined nine-model report without additional model calls.

For a fresh Fastino phase, `--prior-probes` defaults to zero; set it only to the number of integration probes actually performed. The published run explicitly records its three earlier probes. After code changes, use `compare-fastino.py --executed-sources` with the archived source snapshot to reproduce the original metrics without requiring live inference code to remain frozen forever.

## Nace Drex evaluations

Max and Max Finance also have a [6,400-call separate calibration study](results/nace-calibration-2026-11-06/README.md), with the same fit/validation cohorts as the earlier nine-model study, all fit-derived policies frozen before Nace validation, shipped-relative false-clear allowances, and a fixed sensitivity grid. Verify offline with `python3 -B scripts/analyze-nace-calibration.py --archive eval/results/nace-calibration-2026-11-06`.

Measured November 6: [five-model Nace archive and fourteen-model comparison](results/nace-2026-11-06/README.md). Recompute its metrics offline with `python3 -B scripts/compare-nace.py --verify eval/results/nace-2026-11-06`.

The evaluation-only `nace` backend reads `NACE_API_KEY` from the calling environment. It requires an explicit active ID: `drex-v1.5`, `drex-v2.0`, `drex-max`, `drex-max-v1.1`, or `drex-max-finance`. Aliases and retired IDs are rejected; the reported model must match the request. The adapter sends the same structured state, instructions and criteria through Nace's native System One endpoint, with no prompt conversion, retries or fallback. This does not add a production route or require a production secret.

```sh
# Keep the key in ignored .env; Node loads it without printing it.
pnpm exec node --env-file=.env --import tsx scripts/eval.ts \
  --backend nace --model drex-max-v1.1 \
  --manifest eval/data/scifact-dev-200.json --live \
  --interval-ms 550 --max-calls 199 \
  --cost-per-call-usd 0.002 --max-spend-usd 1 \
  --out eval/reports/scifact-nace-FRESH
```

`--interval-ms` sets the minimum between batch starts within a runner process, outside measured latency and the operation deadline. At 550 ms, sequential starts stay below the documented free-tier 120 requests/minute limit; other account traffic can still consume that allowance. Each new process resets pacing. Consult [Nace's current limits](https://console.nace.ai/docs/drex/reference/limits) before running concurrent jobs.

`scripts/run-nace-benchmark.ts` runs all five active IDs on the frozen November 5 inputs. It checks input and shared-kernel hashes, snapshots execution sources before inference, records HTTP statuses separately, and stops between cohorts on account or rate rejections. It preserves partial checkpoints and never automatically retries. `scripts/compare-nace.py` creates a separate redacted archive and independently recomputes metrics; it requires the private probe-receipt file via `--probes FILE` if the protocol declares a nonzero prior-probe count. Fresh runs normally use `--prior-probes 0`.

## Upstream HTTP status diagnostics

For new Jev or Nace investigations, instrument the evaluation process so a billing rejection cannot be confused with an invalid successful response after the fact. The observer writes only request ordinal and numeric HTTP status (`null` if no HTTP response exists). It leaves the request, response body and provider validator untouched. It runs only in this evaluation process; it does not add production request logging.

Build the preload module, then run the existing bounded runner with a fresh output prefix and status-log path:

```sh
pnpm exec node --input-type=module <<'NODE'
import { build } from 'esbuild';
await build({
  entryPoints: ['eval/register-http-status.ts'],
  bundle: true, platform: 'node', format: 'esm',
  outfile: 'eval/reports/http-status-observer.mjs',
});
NODE
COUNTERCHECK_EVAL_HTTP_STATUS_PATH=eval/reports/example.http-status.jsonl \
  pnpm exec node --import ./eval/reports/http-status-observer.mjs --import tsx \
  scripts/eval.ts --backend hosted --model jev-1.14.0 \
  --manifest YOUR_MANIFEST.json --live --max-calls 1 \
  --cost-per-call-usd 0.002 --max-spend-usd 0.01 \
  --out eval/reports/example
```

Set your provider credential privately as described above. Adjust the call cap for your complete selected groups before dispatch. The log refuses overwrite, and the observer records only the TypeSafe and Nace inference endpoints, excluding unrelated fetches. Do not retain bodies, headers, keys or customer text as a diagnostic workaround. Preserve failed runs; any deliberate rerun needs a new prefix and explicit call/spend authorization.
