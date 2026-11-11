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

The original nine-model comparison is `docs/evaluations/hosted-model-comparison-2026-11-05.md`: eight exposed models plus evaluation-only hosted Fastino GLiDE 27B, 8,280 scored observations. Fastino inference uses `FASTINO_API_KEY` in evaluation tooling only (the production credential may be preprovisioned without an exposed route); do not add it to the API catalog from benchmark results alone. Its smaller four released sizes remain pending by owner direction. Execution snapshots preserve the exact measured implementation even after later defensive fixes; use the archived snapshot for metric reproduction. Raw finance text stays in the ignored cache.

The five-model Nace extension is measured in `eval/results/nace-2026-11-06/`; verify it with `python3 -B scripts/compare-nace.py --verify eval/results/nace-2026-11-06`. Nace Drex is evaluation-only through `eval/nace-provider.ts`, using private `NACE_API_KEY`. Require an explicit active serving ID and an exact reported-model match; never benchmark `drex-latest` or retired forwarded IDs. `scripts/run-nace-benchmark.ts` preserves the frozen November 5 inputs and shared kernel, with pacing outside measured latency. Retain the status-only diagnostics and prior-probe receipts separately. New results append to their own archive; do not rewrite historical comparisons or infer production qualification from the vendor report.

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

The two-model Nace calibration extension is `eval/results/nace-calibration-2026-11-06/`. Max and Max Finance reuse the original 2,512 fit / 688 validation cohorts; 6,400 calls, no retries, positive cutoffs and negative policies frozen before validation. Primary fit false-clear budgets are the respective shipped-fit counts 25/771 and 16/771, with the fixed 0/.5/1/2/5% grid preserved. Verify using `python3 -B scripts/analyze-nace-calibration.py --archive eval/results/nace-calibration-2026-11-06`. Validation recall is 62.3% / 69.8% at 97.1% / 96.7% precision; no primary scorecard meets all three targets. Do not reselect budgets on validation or promote these offline policies into the service. The optimized integer bootstrap is tested against the existing source-group algorithm; preserve its resamples and metric units.

The model viability screen is `eval/results/model-screen-2026-11-11/`; verify it with `python3 -B scripts/screen-models.py --verify eval/results/model-screen-2026-11-11`. It ranks measured models by paired macro average precision and latency ordering across the cohorts in `eval/model-screen.json`. The decision-model field moves quickly: a status applies to the measured version under the current prompt, never to a vendor, and the screen directs evaluation effort without changing the API catalog. To add or re-measure a model, run `scripts/measure-model.ts` (`pnpm eval:measure`) on a cohort's frozen inputs, archive the run with `scripts/archive-measurement.py`, append its redacted observations to that cohort's sources, and write a new dated screen; do not rewrite an earlier one. Each screen carries its own `cohorts.json`. The config's `frozen_sources` hashes pin the shared kernel, prompt, transport and scorer; changing any of them makes new rows incomparable, so start a new cohort instead of editing the hashes. New OpenRouter models enter as evaluation-only candidates in `eval/openrouter-candidates.ts` with a reviewed endpoint snapshot (currently `google/gemini-decision-1`, measured November 11 in `eval/results/gemini-decision-1-archive-880-2026-11-11/` and `eval/results/gemini-decision-1-validation-688-2026-11-11/`: 1,568 scored calls, two errors, screened out behind drex-max-finance); a candidate joins the API catalog only by a separate owner decision. Screening out requires replication in at least two cohorts.

`EVALUATION.md` leads with the current field (field table, results by domain, fitted thresholds, why models fall short) and keeps chronology in "How this evaluation evolved" near the end. When a model is added or re-measured, update the front tables from the new screen and add a dated history entry; do not turn the front of the page back into a log.
