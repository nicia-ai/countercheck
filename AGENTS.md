# Countercheck

Standalone Cloudflare Workers contradiction-checking API. The approved scope and evaluation protocol are in `docs/design.md`. No stored customer corpus. Start with pinned Jev 1.14; never silently truncate input, conflate outages with clean results, or reuse admission labels as pair-level contradiction truth.

Hosted model selection is a closed request enum: `jev-1.14.0` (default), `clef`, `clef-flash`,
`clef-omni`, `gpt-6-luna`, `microsoft/microsoft-decision-1`, `perplexity/pplx-decider-v1.2`, and
`perplexity/pplx-decider-flash-v1.2`. Keep the catalog in `src/contracts/models.ts`, request schema,
public `/v1/models`, dashboard and `docs/models.md` aligned. The public catalog's
`configured` flag means only that the provider credential or Workers AI binding is present; it does
not report credential validity or provider health. `OPENAI_API_KEY` and `OPENROUTER_API_KEY` are
optional runtime secrets for their hosted routes. Models share admission budgets; never add a
fallback, self-hosted model, or revive the old deployment-wide `PROVIDER` override. DeBERTa remains
an evaluation-only comparator.

Use Node 24 and pnpm. Keep the kernel independent of Cloudflare, storage, and Nicia workspace packages. Never log customer text, caller IDs, keys, upstream error bodies, or model outputs. Avoid printing secret values during development.

Run typecheck, lint, formatting, tests, and Worker dry-run before completion. Public synthetic test fixtures may be recorded; model calls must be explicitly selected. Report measured results separately from unrun release gates. Only the root agent manages dependencies and shared package configuration during parallel work.

Cloudflare operations must use the new Wrangler named auth profile `nicia-ai`. Bind this directory with `pnpm exec wrangler auth activate nicia-ai .` before resource commands; verify `Active profile: nicia-ai` and the configured Nicia AI account. Do not bypass this with the default profile or print OAuth credentials. Live credentials in ignored `.env` stay private; this checkout currently names the TypeSafe key `TYPESAFE_AI_KEY`, which operator launchers map to the provider's `TYPESAFE_API_KEY` process/secret name.

`balanced-v1` remains the default. The opt-in `semantic-v2` and `structured-value-v1` profiles are experiments that regressed on measured development quality; do not promote them from their version names or synthetic test results. Read `docs/decision-engineering.md` and the initial versus corrected evidence in `eval/results/decision-engineering-2026-11-03/`. Preserve native labels separately from contract annotations; synthetic uncertain fixtures have binary proxy labels that must not enter binary quality or calibration. Numeric overlap never proves whole-pair consistency, and incomplete critical extraction must not become a clean answer. New calibration consumes dev tuning groups only, reports disjoint validation, and opens held-out groups through the explicit one-shot workflow. Local split files are workflow guards, not an access-control boundary.

The business benchmark lives in `eval/business/README.md`; measured native-label results are in `eval/results/business-2026-11-04/`. Keep contracts, finance and business-adjacent language as separate scorecards. ContractNLI uses all gold evidence spans, not individual span labels or arbitrary NotMentioned negatives. FinDVer must retain every distinct annotated context and table, exclude the gold explanation, and preserve public testmini as evaluation rather than tuning. Its whole-source 23-pair and individual-length 82-pair cohorts overlap on 23 cases; never count them as 105 independent examples. Financial report text and full pair-containing reports stay in ignored local cache; commit only explicit redacted derivatives, hashes, labels, predictions and reconstruction code. MultiNLI is an in-domain reference for the pretrained DeBERTa comparator. The requirements-data audit documents contradictory release labels and grouping limits; do not silently repair those labels or reuse them as reliable pair gold.

The latest full comparison is `docs/evaluations/hosted-model-comparison-2026-11-05.md`: eight exposed models plus evaluation-only hosted Fastino GLiDE 27B, 8,280 scored observations. Fastino inference uses `FASTINO_API_KEY` in evaluation tooling only (the production credential may be preprovisioned without an exposed route); do not add it to the API catalog from benchmark results alone. Its smaller four released sizes remain pending by owner direction. Execution snapshots preserve the exact measured implementation even after later defensive fixes; use the archived snapshot for metric reproduction. Raw finance text stays in the ignored cache.

The self-service dashboard uses Better Auth with native D1 and verified, invitation-only accounts.
Read `docs/self-service-beta.md` before changing account policy or limits. API keys and the cookie
playground share one tenant admission budget, enforced by the single SQLite `AdmissionDO` instance
`global-v1`; never replace it with per-key, per-isolate or approximate native rate-limit counters.
Authenticated control-plane reads use primary D1 sessions. Store key hashes only; no browser storage
for keys, customer text or results. Keep a dedicated Countercheck auth secret and explicit admin
allowlist. The compiled Worker test and account tests exercise actual workerd/D1 behavior; maintain
these when changing auth dependencies, migrations, RPC or runtime compatibility. Apply D1 migrations
before deploying code that reads the new columns. Model-quality qualification remains separate.

Authentication must establish mailbox possession before creating an account/session. Use Better Auth
magic links; do not re-enable password signup that can preserve an attacker-chosen password after
an invited or bootstrap-admin mailbox owner clicks verification. Invitations are checked at send
and session creation. `pnpm test` generates ignored dashboard assets before compiling Worker fixtures.
Keep auth cookies in Countercheck's own host-only namespace. The main Nicia app sets parent-domain
Better Auth cookies; using Better Auth's default cookie names makes valid Countercheck sessions fail.
Access requests are unverified contact information, never permission. Keep their optional notes out
of logs and model inputs. Only administrator approval creates a permission entry; it sends no email.
Unlisted magic-link requests return ACCESS_REQUIRED before token creation; approval does not bypass
mailbox verification, invitation expiry at activation, or pilot admission limits.
