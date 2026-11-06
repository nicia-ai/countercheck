# Contradiction quality experiments

These are offline research tools, outside the Worker import graph. No candidate here changes the API default. Measured results, native-label limitations and failed experiments are preserved in [the iteration archive](../results/quality-iterations-2026-11-03/README.md). The original profile regression diagnosis is [here](../../docs/evaluations/profile-regression-diagnosis.md).

Use Node 24 and pnpm. Obtain official public releases with the existing `scripts/prepare-eval.ts` commands; the preparer below requires the pinned cached VitaminC combined and SciFact release archives. It makes no network or model calls.

```sh
pnpm exec tsx eval/iteration/prepare.ts --prefix eval/data/iteration
```

This creates screen, fit, validation and locked manifests. Source components, normalized unordered text duplicates and the complete original public development sources are separated before selection. Screen is intentionally a subset of fit. Native upstream labels and original `train` split remain unchanged. The locked manifest must stay unopened while optimizing; its index contains the source-component hashes needed for exclusion.

Run one live CLI at a time: each executor permits two concurrent requests. Never overlap live jobs if the global budget is two. Supply credentials through the process environment; the CLI does not load files or substitute another backend. Explicit `--live`, call cap and cost reservation are mandatory. Reservations are operator budgets, not measured vendor charges.

```sh
pnpm exec tsx scripts/iterate.ts \
  --manifest eval/data/iteration-fit.json \
  --profiles nli-three-way,evidence-refutation \
  --backend decider --bundle --purpose tune \
  --out eval/reports/my-fit --live \
  --max-calls 400 --cost-per-call-usd .001 --max-spend-usd .41
```

`--bundle` makes one actual provider request containing independent questions for the selected heads. It does not reuse isolated outputs. One malformed or missing answer fails the entire bundled observation. Every request has a 3,000 ms deadline, no retry/fallback, exact model/response checks and a 16 KiB complete wire-body limit. Multiple head rows share one request ID and one usage observation. This currently evaluates **one comparison per request**; it does not establish twenty-comparison API quality.

Without `--bundle`, each profile/case gets its own request. Every mode records the manifest, complete runtime source graph, compiler mode, backend/model, raw answers, numeric features, actual request hash, latency and usage. Sources are snapshotted before inference and checked again afterward. Keep all checkpoint and freeze files. Output paths are exclusive. Fake mode is limited to synthetic transport diagnostics and is never semantic evidence.

Fit a scalar policy or train-only group-CV logistic fusion:

```sh
pnpm exec tsx scripts/calibrate-iteration.ts --mode fit \
  --run eval/reports/my-fit.json --manifest eval/data/iteration-fit.json \
  --seed my-scalar --out eval/reports/my-scalar.json
pnpm exec tsx scripts/fuse-iteration.ts --mode fit --regularization group-cv \
  --run eval/reports/my-fit.json --manifest eval/data/iteration-fit.json \
  --seed my-fusion --out eval/reports/my-fusion.json
```

Fit accepts only the training role. Thresholds use the actual composition gates. Fusion selects L2 regularization using source-group folds and chooses thresholds from out-of-fold scores. Positive precision and negative safety/coverage are separate measurements. A policy that emits no positives has undefined precision and zero recall; good ranking alone is insufficient.

Run the validation manifest with the same profiles/backend/mode, `--purpose validation` and a fresh prefix, then evaluate the frozen policy:

```sh
pnpm exec tsx scripts/calibrate-iteration.ts --mode evaluate \
  --run eval/reports/my-validation.json --manifest eval/data/iteration-validation.json \
  --model eval/reports/my-scalar.json --out eval/reports/my-scalar-validation.json
pnpm exec tsx scripts/fuse-iteration.ts --mode evaluate \
  --run eval/reports/my-validation.json --manifest eval/data/iteration-validation.json \
  --model eval/reports/my-fusion.json --out eval/reports/my-fusion-validation.json
```

The fitted model must match the run's inference sources and execution identity; source groups and text content cannot overlap training. Repeated validation becomes development monitoring. Do not select thresholds on validation, turn repeated cases into a larger sample, or silently change native labels to match the service contract.

The locked role additionally requires `--locked-policy FROZEN.json`, a matching candidate/model and a one-shot consumed marker. Local files provide workflow guards rather than an access-control boundary. Public native-label holdout results still cannot replace the independently human-adjudicated service-contract release gate in [the design](../../docs/design.md).

Numeric candidates are optional evidence. The independent semantic lane is not vetoed for incidental digits; a separate question identifies decisive quantities. Unsupported decisive arithmetic remains uncertain. Numeric interval overlap cannot establish whole-text compatibility. Strong negative refutation alone cannot certify a clear negative when decisive meaning is missing.
