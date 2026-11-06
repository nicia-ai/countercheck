# Quality iteration: native code review

Status: read-only final pass during R4 inference, 2026-11-03. No model calls, credential reads, dependency changes, inference-graph edits, or production changes by this reviewer in this pass.

Recommendation: proceed with the frozen development experiment and preserve its limitations. No unresolved P1/P2 defect was found after the concrete fixes below. This is not approval to promote a profile or a claim that R4 has completed.

## Scope and validation

Reviewed the current iteration compilers/rubrics, raw backend adapters, isolated and bundled execution, AST source fingerprint, role/locked-access guards, scalar and logistic group-CV fitting/evaluation, exploratory boosted fitting, cached source preparation and fit extension, their CLI entrypoints, relevant tests, the production count-alias diff, and supporting offline diagnostic code. Raw archived results were not exhaustively re-audited in this code pass. No locked manifest labels were opened.

Checked semantic/native-label separation, unknown extraction, normalized projections, exact question/head attribution, joint versus marginal score provenance, train-only optimization, group/content disjointness, actual request hashes/bytes, one-call accounting, usage deduplication, cancellation, fixed routes, response limits, safe errors and exclusive checkpoints. Count nouns remain bounded literal candidates; semantic selection must establish the same counted property. Numeric overlap cannot certify whole-text compatibility.

The final focused command passed **226 tests across 12 suites**:

```sh
pnpm exec vitest run --project unit tests/iteration*.test.ts tests/values.test.ts tests/kernel-profiles.test.ts
```

Strict TypeScript also passed. Earlier adapter/bundle handoff included scoped ESLint/format checks. These are focused checks, not a replacement for the root agent's full repository checks and Worker dry-run.

## Concrete findings addressed

**P2 — preserve canonical source components across datasets.** Preparation joins normalized unordered duplicate pairs across datasets and assigns a shared `iteration:<hash>` component. The former fitting group key added a dataset prefix again. A deterministic mixed VitaminC/SciFact fixture could therefore split reversed copies of the same component between fit/check; forward copies could instead be rejected as different groups. The kernel owner changed `groupKey` to validate and preserve the globally scoped prepared component, with the previous dataset namespace retained for raw inputs. Forward/reversed cross-dataset and malformed-metadata regressions pass.

The saved screen (160), fit (400), and validation (200) manifests contain **zero cross-dataset components**. This defect therefore does not invalidate their saved quality counts. The new canonical group strings still change seeded fold assignments even for single-dataset components. R4 also expands training coverage and uses the corrected source, so it must not be described as a controlled estimate of training size alone.

**P2 — use the same content-leakage rule in all evaluators.** Locked access already rejected normalized reversed training pairs; scalar/fusion evaluation duplicated the check but recognized only the original orientation. The kernel owner extracted `assertDisjointFromTraining` and reused it in access, scalar evaluation and logistic evaluation. It checks canonical groups, source IDs and both normalized text orientations. The new reversed-evaluation regressions pass. This is a real reduction in duplicated policy, rather than a cosmetic abstraction.

**P3 — extra-only manifest metadata.** Parallel preparation review identified `screen_subset_of_fit: true` on both extension outputs. It is correct for the combined fit and false for the extra-only manifest, whose selected components deliberately exclude the original fit/screen. Make that flag conditional or omit it on the extra-only output; explain the old field in archive errata rather than rewriting historical bytes. It does not change the combined 800-pair input or its labels, disjointness, calls or scores. This is the sole remaining provenance-only correction noted at report time.

Post-review resolution: the root changed the generator to `screen_subset_of_fit: name === "fit"`. Historical extra-only bytes remain unchanged with an archive erratum; the combined 800-pair measured input is unchanged. No outstanding correction remains from this finding.

## Quality recommendations deliberately skipped

`runPair` and `runBundle` retain both a required legacy `apiKey` parameter and optional `BackendConfig`, which already owns the credential. Prefer one explicit backend configuration in a later cleanup, with an explicit fake factory if needed. Current callers pass consistent values, so this is ignored-parameter ambiguity rather than a demonstrated correctness failure. Changing these internal APIs and their fixtures immediately before the next freeze is unnecessary.

No broader refactor of the research compilers or fitting algorithms is recommended here. Repeated diagnostic projections in historical scripts preserve their particular frozen experiments; they should not be replaced with current composition merely for consistency. Failed boosted experiments should remain inspectable in the archive without being treated as a supported production route.

## Binding and practical limits

The R4 receipt binds **31 runtime/dependency files**, plus execution identity `{compiler_mode: "bundle", backend: "decider", model: "perplexity/pplx-decider-v1.2"}`. Its `candidateSourceHash` is:

```text
6814835e16915213fd9822e078762608b8e51a8cd66ec0eb579bff2a99922955
```

Every source hash in `eval/reports/quality-r4-decider-fit.freeze.json` matched the current file at this pass, with no missing files. Prompt imports, backend transport, feature extraction, validators and scalar/logistic policy semantics are included. Bundle head ordering is canonical, and mode/backend/model changes invalidate fitted-policy binding. Actual routed request bodies are separately hashed and bounded, including Decider routing fields.

Preparation/extension are outside that inference graph. Their source/input/component hashes and original-fit preservation are separately recorded. The reviewed extension uses the shared original source closure, verifies the original source/fit hashes, excludes original fit/validation/locked component hashes without opening locked labels, and preserves original pairs and native train splits. Its tests cover selection exclusion and exact original-pair retention.

Local metadata, source hashes and consumed markers enforce workflow/provenance, not access control against someone forging local artifacts. Provider responses may omit usage or identity; unknown stays unknown. One request containing multiple heads does not make the heads independent, and one comparison per bundled request does not qualify twenty-comparison API behavior.

The public native-label validation set has been repeatedly examined and is a development monitor. The separate native-label holdout is not a human service-contract release corpus. R4 changes fold identities as well as training coverage; repeated observations are not additional independent truth. Human-adjudicated quality, locked evaluation, provider privacy/capacity and production operational gates remain unfulfilled unless separately demonstrated. The default `balanced-v1` remains unchanged.
