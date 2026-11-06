# Decision-engineering evaluation

This is an executable development workflow for `balanced-v1`, `semantic-v2`, and `structured-value-v1`. It does not promote a profile, change the Worker, or establish production qualification. The required 500 human-adjudicated pairs and locked 200-pair gate remain **unmet**. The existing public development measurements and AI-authored synthetic contract fixture do not satisfy them.

Use Node 24 and the repository's installed dependencies. No additional package is needed:

```sh
pnpm exec tsx scripts/engineering-eval.ts --help
```

## Split and freeze before inference

```sh
pnpm exec tsx scripts/engineering-eval.ts split \
  --manifests eval/engineering/synthetic-workflow.json \
  --dir eval/data/engineering-splits --seed engineering-2026-11-03

pnpm exec tsx scripts/engineering-eval.ts freeze \
  --index eval/data/engineering-splits/split-lock.json \
  --profiles balanced-v1,semantic-v2,structured-value-v1 \
  --backend fake --out eval/data/engineering-freeze.json

pnpm exec tsx scripts/engineering-eval.ts run \
  --index eval/data/engineering-splits/split-lock.json \
  --freeze eval/data/engineering-freeze.json --role dev \
  --probes clean,repeat,distractor,order,hostile,criteria-order,field-order \
  --out eval/reports/engineering-fake-dev \
  --max-calls 10000 --cost-per-call-usd 0.01 --max-spend-usd 100
```

The tutorial fixture contains twelve AI-authored transport cases in six groups, with one positive and one negative per group so small dev folds exercise both classes without searching seeds. It is not model-quality evidence, a public dataset, or human adjudication.

The fake backend is restricted to explicitly synthetic fixtures; public dataset runs must select an explicit live provider. It makes zero network calls and returns uniform choice distributions through the real kernel and response parser. Its probabilities/latency are transport diagnostics, never model performance. Choose fresh directories and output prefixes; artifacts are created exclusively. The example reservation covers at most 10,000 requests, not a claimed monetary charge. Every planned profile × case × probe counts toward the call limit, including repeated inputs. A single sequential queue has a 3,000 ms direct/kernel deadline per request; no retries, fallback, truncation, or automatic resume occurs. This differs from the deployed service's nested provider budget and says nothing about its SLA.

The split algorithm assigns roughly 60%/20%/20% of **groups**, not pairs, deterministically by seed. At least five independent groups are required. All source-group IDs remain together; identical content, including case/whitespace normalization, joins groups into connected components. Dev groups are divided again into tuning and validation. The lock rejects repeated IDs, source/content overlap across partitions, and dev-fold leakage. It does not detect all paraphrases or discover organizational/template overlap automatically: source manifests must encode those relationships in `group_id` before splitting. Seed selection after looking at labels is tuning; do not search seeds for better results.

Each case retains its upstream dataset, original split, native label, source manifest hash, rationale set, group identity, and exact claim/evidence content hash. Public `test` manifests are refused as inputs to this optimization split. Repartitioning previously examined public **dev** examples does not turn them into a new independent test: original splits remain recorded, and prior exposure is not reset. These commands provide workflow locks, **not cryptographic access control**: an operator can read or edit local files. Keep holdout files inaccessible to optimization agents through separate operational access controls if that boundary is required.

Freeze binds the split-lock bytes, selected profiles, requested provider/model, entire portable source graph, evaluator/CLI code, package manifest, and dependency lockfile. Run verifies the fingerprint before importing execution and again after import; changes require a new experiment. Keep sources fixed while a run executes. Output metadata binds the freeze and split hashes; every prediction includes the actual compiled payload hash after any probe transformation. Provider adapters may add their documented routing envelope; this compiler hash is not a claim to hash private HTTP headers or the full wire envelope.

## Separate targets and annotation provenance

Native dataset truth is one target. Service-contract truth is a different target. Missing contract annotations remain unscored; they are never copied from native labels. Optional `split --contract-labels labels.json` accepts:

```json
{
  "schema_version": 1,
  "labels": [
    {
      "pair_id": "EXACT_PAIR_ID",
      "content_sha256": "EXACT_64_CHARACTER_SHA256_OF_JSON_ARRAY_CLAIM_EVIDENCE",
      "verdict": "uncertain",
      "provenance": {
        "kind": "synthetic",
        "source": "AI-authored local boundary case",
        "method": "Explicit service-contract diagnostic; not human adjudication",
        "annotators": [],
        "adjudicator": null,
        "real_source": false,
        "authorization": "State the actual license or authorization"
      }
    }
  ]
}
```

`content_sha256` is SHA-256 of the UTF-8 bytes of `JSON.stringify([claim, evidence])`, with submitted text preserved. Supported verdicts are `contradiction`, `no_contradiction`, and `uncertain`. A `human-adjudicated` provenance assertion requires two distinct annotator identifiers and an adjudicator identifier. This is recorded operator provenance, not automatic verification that people performed the work. Synthetic annotations cannot assert the real-source gate. Content mismatch, duplicate annotation IDs, and unknown annotation IDs are rejected. Licensing/authorization must be supplied by the operator; the tool grants none.

Report native and service-contract targets separately. Explicit contract-uncertain cases contribute to completion and expected-verdict accuracy, and are excluded from binary precision/recall, clear-negative coverage and probability metrics. For public labels, literal compatibility and fact-verification labels can differ; do not rewrite historical labels or call native evaluation human adjudication. The existing 32-case synthetic contract fixture has four native `uncertain` labels with matching `expected_verdict` metadata and legacy non-contradiction proxy gold. Native fixture scoring preserves those four uncertain targets and excludes them from binary counts and calibration; it does not treat their proxies as clear negatives. Public native labels are unchanged. Synthetic labels are not independent human truth.

## Paired variation probes

Only the original claim/evidence pair receives a quality label. Added comparisons have no assigned semantic gold. Every answer is still required by the kernel, and distractor outputs remain in the checkpoint for attribution diagnostics.

| Probe            | Paired reference | Controlled variation                                                                         |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| `clean`          | none             | Isolated original pair                                                                       |
| `repeat`         | `clean`          | Exact same payload again, fresh provider request                                             |
| `distractor`     | `clean`          | Two fixed invented comparisons share the claim                                               |
| `order`          | `distractor`     | Same comparisons, reversed provider presentation                                             |
| `hostile`        | `clean`          | One ordinary and one quoted hostile instruction comparison                                   |
| `criteria-order` | `clean`          | Reverse choice criterion insertion order only                                                |
| `field-order`    | `clean`          | Reverse state and structured-instruction object field order; preserve array order and values |

Paired denominators contain only two completed target outputs; failures/missing pairs are reported separately. Repeated outcomes are repeated measurements of the same case, not additional independent truth samples. Variant outputs are not pooled into accuracy denominators. Public fixture text can coincide with a distractor accidentally; the original pair alone is scored, and the probe is sensitivity evidence, not a guaranteed semantically neutral new assertion.

## Dev-only joint composition and heldout evaluation

```sh
pnpm exec tsx scripts/engineering-eval.ts calibrate \
  --index eval/data/engineering-splits/split-lock.json \
  --freeze eval/data/engineering-freeze.json \
  --run eval/reports/engineering-fake-dev.json \
  --profile structured-value-v1 --semantic-profile semantic-v2 \
  --label-space native --out eval/data/engineering-composition.json

pnpm exec tsx scripts/engineering-eval.ts holdout \
  --index eval/data/engineering-splits/split-lock.json \
  --freeze eval/data/engineering-freeze.json \
  --calibration eval/data/engineering-composition.json \
  --out eval/reports/engineering-fake-holdout \
  --max-calls 10000 --cost-per-call-usd 0.01 --max-spend-usd 100
```

Choose `--label-space service-contract` only when explicit annotations exist. Calibration rejects incomplete/mismatched clean predictions, a non-dev report, or a report from another source/split freeze. Its tuning fold must contain both binary classes; an insufficiently small or unlabeled split fails explicitly. Do not repeatedly inspect validation and revise until it passes: that consumes it for optimization and requires new independent validation/holdout data.

The frozen 48-policy grid varies positive threshold (0.5/0.65/0.8/0.9), negative semantic support (0.5/0.8/0.9), maximum unknown mass (0.2/0.5), and an optional numeric-positive override. Selection maximizes **tuning** recall at point precision >= 0.95, then F1 and fixed grid order; if none qualifies it records an exploratory best-F1 fallback. Confidence intervals do not become stronger by searching this grid. The selected policy is reported once on the disjoint validation fold without reselection.

Signals remain separate: semantic choice probabilities, selected candidate-pair probability, deterministic interval relation, unknown mass, and extraction coverage. An optional explicitly requested semantic profile supplies a matched second distribution; its calls already count in the frozen run plan. Numeric-positive overrides require a selected pair, recognized spans on both sides, no unsupported spans, and no overflow. Structured unknown/incomplete extraction remains uncertain. Numeric interval overlap **never** proves whole-pair consistency and cannot trigger a negative override. This is an evaluation experiment, not a second hidden production call or an approved composition policy.

The tool also fits three binary joint-feature cells on tuning only, using Laplace(1) empirical frequencies and 0.5 for unseen cells; it reports validation/holdout Brier denominators and unseen cells. These small-sample empirical estimates are explicitly derived calibration diagnostics. No independence assumption, multiplication of marginal probabilities, invented three-way distribution, or provider-calibration claim is made. Structured predictions preserve raw `structured_signals`; they have no probability projection or raw-score AUROC/Brier unless an actual scored probability exists. The composition's decision outputs and empirical-calibration Brier are separate reports.

`holdout` verifies the frozen dev calibration, restricts inference to its required profiles and clean probe, and creates `split-lock.json.holdout-opened.json` exclusively before dispatch. A second opening is refused even with another output prefix. Interrupted checkpoints remain; do not delete the consumed marker to tune or rerun secretly. No command calibrates on holdout. Local files remain readable, so the marker is a workflow guard, not tamper-proof certification. Once viewed, holdout results may motivate a new study, but the same cases cannot support an untuned validation claim for the revised candidate.

## Explicit provider experiments

Freeze each provider experiment separately with `--backend jev`, `clef`, or `decider`; use `--live` plus call and conservative spend caps for run/holdout. Credentials are environment-only: `TYPESAFE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`, or `OPENROUTER_API_KEY`. Never place tokens in commands, manifests, checkpoints, or this guide. No fallback route is used. Price reservations are operator bounds, not measured billing.

| Candidate experiment                               | Protocol compatibility                                                                                                         | Interpretation                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Pinned Jev 1.14 + semantic/structured profiles     | Same typed choice protocol; structured criteria expose candidate spans                                                         | Candidate, not a qualified replacement                         |
| Cloudflare Clef + the same frozen profiles         | Native state/choice schema through existing REST adapter; complete answer coverage required                                    | Provider-compatible starting experiment; not claimed optimized |
| Perplexity Decider v1.2 + the same frozen profiles | Existing OpenRouter decision adapter, Perplexity-only routing without fallback; criteria and structured instructions preserved | Provider-compatible starting experiment; not claimed optimized |

Freeze model-specific prompt/schema variants in a new source version before comparing them. A schema/permission error is an unavailable experiment, not zero semantic quality. Keep model-reported identity and missing revision explicit. Development selection, synthetic contract success, and workflow-heldout reports do not replace the design's human-adjudication, real-source, operational concurrency, and deployed-service gates.
