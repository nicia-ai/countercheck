# Architecture and implementation reference

The service separates a pure decision kernel, provider adapters, HTTP/account controls and offline evaluation tooling. The canonical HTTP surface is [the OpenAPI document](https://countercheck.nicia.ai/openapi.json), generated in `src/http/openapi.ts`; request/response validation lives in `src/contracts/`.

## Decision path

`src/kernel/index.ts` compiles one typed question for each claim/comparison pair, validates provider output, and maps results back to caller-supplied IDs. It has no Cloudflare, database or account dependency. The HTTP layer owns deadlines and admission; the kernel does not retry or configure provider fallbacks.

`src/providers/catalog.ts` maps the closed model enum in `src/contracts/models.ts` to the hosted adapters. A provider may preflight its exact wire-envelope size before quota admission. The service accepts only the configured model and reviewed reported identities. `src/providers/response.ts` validates complete answer sets, probabilities and known metadata. The Fastino and DeBERTa evaluation paths do not add models to the public API catalog.

`src/http/app.ts` owns body/input limits, authentication, ingress controls, request completion, sanitized errors and the account routes. Verdicts exist only on comparisons; `status: completed` means every pair was assessed, including uncertain results. See [the design](design.md) for the contract and [supported models](models.md) for routing.

## State and account boundaries

`src/control/admission-do.ts` exposes the single SQLite-backed admission coordinator. Its stable `global-v1` identity owns enrollment, pause state and shared request/comparison/concurrency budgets. Native rate-limit bindings are additional approximate ingress controls, not that global budget.

D1 stores account/session and invitation/access-request records, API key hashes and metadata, and technical usage aggregates. It does not store submitted check text, provider findings or raw API keys. `migrations/` is the schema authority. `src/account/` implements invitation-only mailbox verification with Better Auth. [Self-service behavior](self-service-beta.md) documents permissions, key lifecycle and retention.

`src/env.ts` is the binding/type reference. Wrangler configures D1, the admission Durable Object, assets, rate limits, Workers AI and cron triggers. Runtime provider/account credentials are Worker secrets. [Deployment](deployment.md) describes the required secret names, named local profile and Cloudflare Workers Builds pipeline; CI credentials do not belong in browser code or checked-in files.

## Evaluation tooling

`eval/` and `scripts/` prepare supplied-evidence benchmarks, run bounded explicit inference, and score redacted observations. The [evaluation guide](../EVALUATION.md) distinguishes shipped operating points from ranking metrics, retrospective sensitivity and release qualification. Execution snapshots preserve the measured implementation independently of later fixes.

The [post-hoc analysis supplement](../eval/results/hosted-models-analysis-2026-11-05/README.md) is derived from the frozen observations. `scripts/verify-eval-release.py` verifies original aggregate metrics and replays the supplementary analysis without credentials, network access or original finance text. Generated dashboard assets and local datasets/reports remain ignored.
