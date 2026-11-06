# Deployment and operator notes

Status: controlled authenticated preview deployed on 2026-11-03 through the `nicia-ai` auth profile. [Observed deployment and live checks](deployments/2026-11-03-preview.md) do not qualify the model or service for production.

## Cloudflare prerequisites

Bind a workstation checkout with `pnpm exec wrangler auth activate nicia-ai .` before Cloudflare commands. Wrangler must report `Active profile: nicia-ai`. Workers Builds uses its Cloudflare-managed deployment credentials; CI must not activate a workstation auth profile.

The repository is pinned to the Cloudflare account and dedicated D1 database recorded in
`wrangler.jsonc`. Those resources were provisioned for this checkout. If deploying to another
Cloudflare account, provision a separate D1 database and update `account_id`, `database_id`, and
`preview_database_id` to that account's matching resources before continuing.

1. Confirm the configured D1 database is the dedicated `countercheck` database for this service.
2. The configured API hostname is `countercheck.nicia.ai`, with a custom-domain route in
   `wrangler.jsonc`. `workers_dev` and `preview_urls` are disabled. The deploy preflight validates
   that every configured route has a real zone/custom-domain shape and rejects placeholders; it
   cannot verify account WAF rules. Verify edge coverage before production customer traffic or
   issuing customer keys; the hostname may be used for a controlled authenticated preview first.
3. Apply the reviewed migrations using the intended Wrangler profile:
   `pnpm exec wrangler d1 migrations apply countercheck --remote --config wrangler.jsonc`.
   Verify the applied migration with
   `pnpm exec wrangler d1 execute countercheck --remote --config wrangler.jsonc --command 'SELECT name FROM d1_migrations ORDER BY id;'`.
   Expect `0001_control.sql`, `0002_accounts.sql`, `0003_observability.sql`,
   `0004_invitations.sql`, and `0005_access_requests.sql` for the self-service release; also inspect the actual aggregate schema with
   `pnpm exec wrangler d1 execute countercheck --remote --config wrangler.jsonc --command 'PRAGMA table_info(daily_usage);'`
   and confirm `unknown_token_requests` is present before activating the service.
4. Confirm that rate-limit namespaces `1679165447`, `1679165448`, and `1679165449` are unused in this account, or
   assign unique IDs. The Worker applies an ingress limit of 120 requests per minute per
   `CF-Connecting-IP` before reading the body or querying D1, and a separate 60 requests per minute
   per authenticated key. Missing client IPs share a fail-safe bucket. Cloudflare describes these
   bindings as approximate per-location limits, not strict global quotas.
5. Provision runtime secrets directly on the existing `countercheck` Worker in the pinned account,
   using its Cloudflare dashboard or `pnpm exec wrangler secret put NAME --config wrangler.jsonc`.
   The maintained CI deployment requires `TYPESAFE_API_KEY`, `OPENAI_API_KEY`,
   `OPENROUTER_API_KEY`, `BETTER_AUTH_SECRET`, and `RESEND_API_KEY`. Generate a
   dedicated random `BETTER_AUTH_SECRET` of at least 32 characters for Countercheck; do not reuse
   Nicia's auth secret. Confirm the Resend key can send from the configured sender. These are Worker
   runtime secrets, separate from Workers Builds variables and secrets. Do not copy runtime
   credentials into the repository, GitHub Actions, or the build environment. The deploy script
   checks required secret names only; presence does not establish credential validity or auth-secret
   strength. The application can disable OpenAI/OpenRouter routes when their keys are absent, but
   the maintained deployment preflight requires both to keep all eight hosted routes configured. The `AI` Workers AI binding is
   configured in Wrangler, not as a secret. `GET /v1/models` reports `configured` from binding or
   credential presence only; it does not test credentials, upstream health, or capacity. See
   [supported models](models.md) for the complete hosted catalog.
6. Configure and verify anonymous IP protection at the Cloudflare edge before production customer
   use or key issuance. The Worker ingress limiter runs before body parsing and D1 access, while the
   per-key limiter runs after authentication. These approximate Worker limits do not replace the
   production WAF gate.

## Workers Builds from GitHub

The maintainer configuration recorded on 2026-11-04 connects the existing Worker to `nicia-ai/countercheck` on `main`, with the commands and version pins below, build
caching enabled and preview builds disabled. It uses an existing Cloudflare-managed CI credential;
no new build token was minted. GitHub CI independently passed on the consolidated source before
this configuration record was published. Consult Cloudflare build history for deployment outcome.

The target account was verified on 2026-11-04 as **Nicia AI**, account ID
`42de207988eb23793aa308feb01dc9c7`. These resource identifiers are deployment metadata, not credentials. Forks must configure their own account and resources.

Cloudflare Workers Builds is the deployment pipeline. Connect the existing `countercheck` Worker
under **Settings → Builds** to the GitHub repository `nicia-ai/countercheck`. Use:

| Setting                                 | Value            |
| --------------------------------------- | ---------------- |
| Production branch                       | `main`           |
| Root directory                          | `/`              |
| Build command                           | `pnpm ci:build`  |
| Deploy command                          | `pnpm ci:deploy` |
| Non-production branch builds / previews | Disabled         |
| `NODE_VERSION` build variable           | `24.22.2`        |
| `PNPM_VERSION` build variable           | `11.20.0`        |

Use the committed lockfile for dependency installation. `ci:build` runs
`pnpm check && pnpm test && pnpm build`; `build` compiles the dashboard assets before the Wrangler
Worker dry run. Configure only `main` as a deployment branch in Cloudflare; the deploy script also
rejects a non-main `WORKERS_CI_BRANCH` when that metadata is present. Wrangler's `workers_dev` and
`preview_urls` remain disabled. GitHub Actions runs checks only and has no deploy workflow or
runtime credentials.

Use the existing Cloudflare-managed CI deployment credential selected by Workers Builds. It provides
`CLOUDFLARE_API_TOKEN` to the build; do not activate `nicia-ai` in CI or mint a separate build token. Verify its
permissions cover the existing Worker, D1 migrations on the dedicated database, and route changes
in the protected zone. Worker deployment permission alone does not grant D1 migration access.
See [Workers Builds API tokens](https://developers.cloudflare.com/workers/ci-cd/builds/api-tokens/).
The pinned `account_id` selects the deployment account; if `CLOUDFLARE_ACCOUNT_ID` is configured
in Builds, it must match. Runtime credentials stay on the Worker and are inherited by a deploy;
the build neither reads their values nor uploads a secrets file.

`ci:deploy` validates the protected custom-domain configuration and dedicated D1 target, then lists
Worker secret names and refuses deployment if any required name is absent. The maintained eight-model deployment requires `TYPESAFE_API_KEY`, `OPENAI_API_KEY`, and `OPENROUTER_API_KEY`, plus `BETTER_AUTH_SECRET` and `RESEND_API_KEY`; Clef variants use the `AI` binding. Model credentials belong on the runtime Worker, never in public build variables. It applies all pending
reviewed D1 migrations remotely **before** publishing dependent code. A failed preflight or
migration stops the deployment with no retry or fallback. Authentication reads `expires_at` from
migration 0002, and the account and observability routes require migrations 0002–0005. These
additions preserve the old schema's data; do not undo D1 schema changes when rolling back Worker
code. A fresh build may be requested after an operator resolves a failure.

Deployment also registers the SQLite-backed `AdmissionDO` migration `admission-v1`. Keep that
class, migration tag and singleton name stable to preserve quotas and pause state. Keep production
builds serialized in Cloudflare and do not run concurrent manual deployments. The pipeline does
not create D1, alter account permissions, provision user keys or verify edge rules.

## Invitation-only self-service setup

The maintained deployment includes invitation-only self-service. For a new installation,
verify the following account, invitation and quota behavior after deployment.

- Confirm the configured `BETTER_AUTH_URL` is the exact HTTPS app origin and `AUTH_EMAIL_FROM`
  is a sender verified by the configured Resend account (`Countercheck <hello@nicia.ai>` is the
  committed setting). Auth callbacks and trusted origins derive from this configuration, never
  an incoming request's Host header. Test emailed sign-in links only with an
  operator-controlled email address after deployment; this document records no delivered-email test.
- Set Worker runtime secret `ADMIN_EMAILS` to the exact initial operator address before
  first signup. That explicit allowlist bootstraps an admin account; email verification is still
  mandatory. `ADMIN_USER_IDS` can later grant exact existing user IDs. Comma-separated lists are
  supported, with normalized email comparison and no wildcard/domain matching. Deployments preserve existing runtime secrets. Removing an address from a build variable does
  not revoke it: update the Worker runtime allowlist explicitly, or delete its secret with
  `pnpm exec wrangler secret delete ADMIN_EMAILS --config wrangler.jsonc` (similarly for
  `ADMIN_USER_IDS`). Keep at least one intentional administrator while operating the pilot.
- An administrator uses **Allow access** to create a seven-day permission entry. This sends no
  invitation email; the administrator shares the dashboard URL personally. Other new accounts
  require a live permission entry and mailbox verification. Signing up alone does not consume it; verified acceptance is recorded
  before enrollment or key use. Accepted accounts remain eligible after the invitation expires.
  The admission controller separately limits enrollment to ten tenants and enforces shared
  API/dashboard quotas. Existing operator-created API keys also require explicit tenant enrollment.
- Plan the first rollout as an operator-controlled preview cutover: the new coordinator starts empty,
  so existing keys cannot dispatch until their tenants are enrolled. After deployment, verify the
  bootstrap administrator, enroll each intended legacy tenant through `pnpm control enroll --tenant-id ID`, and
  verify authenticated readiness and a synthetic check before admitting pilot users. Do not assume
  a successful upload alone preserves legacy inference availability.
- `AUTH_LIMITER` provides the native approximate 20-per-minute auth/account IP buckets. Better Auth
  does not retain IP addresses or user agents; its IP-tracking-disabled setting means the native
  binding is the HTTP auth-rate enforcement. The Durable Object, rather than an in-memory limiter
  or D1 usage rollup, owns strict request/comparison/concurrency budgets and pause state.

Optional production secrets `CANARY_API_KEY` and `ALERT_WEBHOOK_URL` enable the five-minute synthetic
check and HTTPS alert delivery. Set these directly on the Worker. To disable one, explicitly delete its runtime secret with
`pnpm exec wrangler secret delete NAME --config wrangler.jsonc`; removing a build variable does
not change an existing Worker secret. A canary key must belong to an
enrolled tenant; it uses the normal API, quotas and one of the tenant's live-key slots. Dashboard
keys expire after 14 days, so rotate a canary key before expiry. The check uses only fixed synthetic
text and consumes up to 288 daily attempts while enabled. Missing canary configuration is reported
as `canary_not_configured`, not a successful live check. Webhook payloads contain only service,
event and time, with no input text, credentials or provider outputs. Configure provider billing
alerts separately; attempt caps and token subtotals are not measured invoice spend.

## Anonymous traffic protection release gate

Publish the API on a hostname in the intended Cloudflare zone. In that zone's Security rules,
create a rate-limiting rule covering every path on that API hostname, including `/v1/check` and
`/internal/ready`. For example, replace `api.example.com` in:

```text
http.host eq "api.example.com"
```

Count by source IP, including requests with no Authorization header or arbitrary Bearer values;
do not count by the submitted key or limit counting to responses with a particular status. Choose
the request count, period and block duration supported by the account's plan, and record them with
the rule ID. Use a blocking action for this machine API. Validate shared-NAT customer traffic before
selecting the production threshold. For the synthetic verification below, set the WAF threshold
below the Worker ingress limit so the edge rule activates first. The WAF and Worker limits are
separate controls.
[Cloudflare rule setup](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/)
and [counting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)
describe plan-dependent fields and IP counters.

Cover every reachable hostname. Before production publication, disable unused `workers.dev` and
version/preview URLs in the deployment configuration, or protect each alternative entry point with
an independently verified access policy. A dashboard-only `workers.dev` disable can be reversed by
the next Wrangler deploy; disabling that route does not disable every other URL type.
[Workers routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
and [version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
describe those separate settings. The committed configuration defines the dedicated hostname, but does not create or verify these
zone edge rules. Controlled preview access uses the native ingress binding; production customer
traffic additionally requires the edge verification below.

Before issuing customer keys, record a synthetic verification from one controlled source IP:

- Send valid small JSON with rotating, randomly generated correctly formatted invalid `cck_` keys.
  These requests must never call inference. Below both thresholds they should reach the Worker and
  receive 401. Above the configured WAF threshold they must be blocked by the edge rule before
  Worker/D1 execution.
- Also exercise missing headers and `/internal/ready`. Confirm the rule ID/action in Cloudflare
  Security Events and correlate the blocked period with Worker invocation and D1 query metrics;
  do not retain submitted headers or request bodies as evidence.
- Verify an ordinary authorized synthetic check after mitigation expires, and verify that alternate
  hostnames cannot bypass the rule. Record hostname coverage, threshold/window, observed action,
  timestamp and responsible operator. This is a required unrun deployment gate until evidence exists.

## API key operations

The `pnpm keys` CLI uses Wrangler's argument-array process interface; it never invokes a shell with
interpolated SQL or keys. Local operations use a temporary mode-0600 SQL file. Remote operations
use `--command` so ordinary key operations use D1's query path and return statement rows, rather
than entering Wrangler's bulk-file import path. Remote SQL arguments can contain key IDs, tenant
metadata or a high-entropy key's hash, but never the full API key.

```sh
pnpm keys create --tenant-id customer-a
pnpm keys list
pnpm keys revoke --id KEY_UUID
```

These commands use local D1 by default. Add `--remote` to explicitly target the configured remote
D1 database. `create` prints the new random 32-byte `cck_` key exactly once. Only its SHA-256 hex
hash is inserted into D1. `list` omits the hash. Record the returned key ID separately if you will
need to revoke the key later. For an isolated local database during operator testing, add
`--persist-to /tmp/countercheck-local`; this passes through to Wrangler's local D1 persistence flag.
The CLI rejects `--remote` while the configured D1 `database_id` is the committed placeholder.

## Data and logs

Countercheck retains no submitted checking corpus. D1 also stores account email/name, database sessions, hashed single-use sign-in tokens and invitation metadata, alongside key metadata,
key hashes, expiry/revocation state and daily technical usage aggregates. Sessions do not persist
IP addresses or user agents. The admission controller stores only internal tenant/key/request IDs,
quota counters and bounded technical reservation metadata. Do not add submitted text or provider
output columns. The application must
not log input text, caller IDs, API keys, upstream response bodies, or model output. Wrangler
enables Workers observability with query-string redaction and disables invocation logs so request
URLs are not recorded as automatic invocation events. Application code must emit only sanitized
operational metrics. Cloudflare Workers Logs have a platform retention limit of seven days; the
repository does not configure an independent retention period.

The Worker also owns a midnight-UTC retention cron. Its scheduled handler deletes aggregate usage
outside the current and preceding 29 UTC dates independently of request traffic. Keep that trigger
enabled, monitor `retention_cleanup_failed`, and investigate scheduled failures; successful API
traffic is not required for cleanup. The optional five-minute canary cron can call inference with
fixed synthetic text; neither cron reads submitted customer text. Account records and key metadata
have account-lifecycle retention, rather than the aggregate's 30-day policy.

## Release status

The beta implementation is explicitly unqualified. Beta precision, recall, clear
negative coverage, calibration, latency, availability, and perturbation gates are proposed targets
until the evaluation protocol records actual results. Do not call a deployment qualified based on
the presence of a healthy Worker or on the historical admission benchmark.
