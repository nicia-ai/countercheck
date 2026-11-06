# Self-service beta

Status: implemented in the maintained invitation-only preview. Deployment does not establish model-quality or production launch qualification.

Countercheck now includes a same-origin dashboard at `/dashboard`. Better Auth provides
mailbox-first sign-in using single-use emailed links, plus sign-out. Password signup and login are disabled. Account creation requires
an administrator's invitation to the same email address. An explicitly configured `ADMIN_EMAILS`
address can bootstrap the first administrator and must also verify its email.

In Admin, **Allow access** adds an email address to the permission list without sending email or
creating an account. The administrator shares the dashboard URL personally. The person has seven
days to activate access by requesting and consuming a sign-in link; accepted access persists beyond
that initial expiry. Only an eligible email (or an explicitly configured bootstrap administrator)
can request a sign-in link or establish a session. Verification establishes control of the mailbox.
Allowing access does not grant administrative rights. No customer claim, comparison text or result is stored by the
application. The authentication database necessarily stores account identity, sessions and hashed sign-in tokens. Application sessions omit IP address and user agent.

An unlisted or expired, unaccepted email receives `403 ACCESS_REQUIRED` and sees **Request access**
instead of an inbox prompt. This deliberately exposes permission eligibility for the submitted
address. The optional use-case note is limited to 2,000 characters. Submitting a request sends no
email and creates no user, session, invitation or pilot enrollment. Administrators see pending
requests with notes labeled as unverified submissions, and may allow the address without sending
an invitation email. The mailbox owner must still complete normal sign-in after approval.

Intake uses the account rate limiter, exact-origin checks and bounded JSON validation. It allows at
most 1,000 pending requests, preserving the first note on duplicate pending submissions; an approved
request can reopen when its unaccepted permission expires and queue capacity is available. Admins
can dismiss unwanted requests without granting access or sending email. Dismissal frees a pending
slot; repeated submissions cannot reopen a dismissal during its retention period, though an admin
can still allow the address manually. Contact addresses and notes are visible
only to administrators, omitted from technical logs, and removed after thirty days by the daily
retention job (also pruned on new intake). No access-request note is sent to a decision model.

The dashboard uses `POST /dashboard/api/access-requests` with `{email, note?}` for intake.
Administrator-only `GET /dashboard/api/admin/access-requests` and `GET /dashboard/api/admin/invitations`
list pending requests and permission entries. `POST /dashboard/api/admin/invitations` with `{email}`
atomically allows access and marks any matching request reviewed; it does not send email.
`POST /dashboard/api/admin/access-requests/dismiss` with `{email}` dismisses a pending request.

HTTPS sessions use Countercheck-specific `__Host-` cookies, scoped to this host with `Secure`,
`HttpOnly`, `SameSite=Lax` and `Path=/`. They are independent of Nicia's parent-domain sessions.
The cookie namespace fix requires a fresh sign-in link for existing Countercheck sessions;
it does not sign users out of other Nicia applications. Local HTTP development uses the
`countercheck` cookie prefix without the HTTPS-only `__Host-` prefix.

Verified users can create up to three live API keys, each expiring after fourteen days, and revoke
keys immediately. The full key is displayed once and stored only as a SHA-256 hash on the server.
The playground uses the signed-in session rather than persisting an API key in the browser.
Enter one statement per line in the playground: the first nonblank statement is compared with each
following statement, with 2–21 statements per check. Blank lines are ignored; returned `line_N` IDs
refer to the original physical lines. Text is preserved within each line.
Inputs remain in page memory; results clear when inputs change. The playground calls the same
engine and shares the same tenant limits as API requests.
The playground model selector lists all hosted models, defaults to Jev 1.14, and disables models
whose provider is not configured. Its availability flags come from `GET /v1/models` and indicate
credential or binding presence only, not provider health. Changing the model clears prior results.
Model selection shares the same account limits; see [supported models](models.md).
Results show a verdict on each comparison, with request completion and coverage reported separately.
The overview's curl example and a newly revealed API key have adjacent copy icons.

## Pilot limits

One SQLite Durable Object serializes admission for the whole pilot. Missing or unavailable
admission state fails closed before inference. It enrolls at most ten tenants and applies:

| Limit                       | Per tenant |  Global |
| --------------------------- | ---------: | ------: |
| Requests per rolling minute |         10 |       — |
| In-flight reservations      |          2 |       4 |
| Attempts per UTC day        |      1,000 |  10,000 |
| Comparisons per UTC day     |     10,000 | 100,000 |

Attempts and comparisons are charged when admitted, including later failures and timeouts.
Successful completion releases its reservation; unknown provider outcomes retain a conservative
60-second lease. Lease expiry bounds API admission, and does not prove upstream GPU cancellation.
Native Cloudflare rate limits additionally protect ingress and account endpoints, but their
per-location counters are not the authoritative global budget. Unit caps are hard limits on
admission, not a guaranteed dollar billing ceiling.

The user usage view reports daily attempts, comparisons, completion/failure states, pending
reports and known versus unknown token usage. The administrator view exposes aggregate usage,
tenant/global pauses and invitations. Account sessions, origin checks and an explicit administrator
allowlist protect administrative actions. API keys cannot administer the service.

## Observability

Structured terminal events contain generated request IDs, internal tenant/key IDs, status,
profile/release, counts, byte sizes and phase durations. They omit customer text, caller-supplied
IDs, findings, probabilities, email, passwords, credentials and raw provider exceptions.
Cloudflare invocation logs are disabled; query strings are redacted. Technical D1 rollups and
operator audit records are retained for thirty UTC dates; the independent daily retention job
runs without customer traffic. Authentication records and Cloudflare platform log retention have
separate lifecycles and are not covered by the technical-rollup deletion rule.

Every five minutes the monitor checks retention health and aggregate failure rates. A configured
`CANARY_API_KEY` enables a rotating synthetic contradiction/restatement request through the real
public API. It consumes ordinary quota and requires key rotation. Alerts contain controlled event
codes only; optional `ALERT_WEBHOOK_URL` delivery is deduplicated hourly. Missing canary configuration
is reported explicitly. A paused service will also fail the synthetic check.

## Local setup and operations

Follow the deployment runbook for secrets, migrations and the named `nicia-ai` Wrangler profile.
Locally set `BETTER_AUTH_URL` to Wrangler's exact loopback origin and supply a dedicated auth secret,
a Resend credential, verified sender and bootstrap administrator email. Sign-in link
mail uses Resend; local development has no production authentication bypass.

After verification, invite another account, mint a key, run the synthetic SSO example, inspect usage,
then revoke the key. Avoid putting real key values into screenshots, issue reports or command lines.
The operator CLI accepts an administrator session cookie through `COUNTERCHECK_ADMIN_COOKIE`, with
`COUNTERCHECK_ORIGIN` identifying the HTTPS deployment. Run `pnpm control --help` for commands.
Existing operator-issued keys need explicit tenant enrollment before they can dispatch; they do
not bypass the new admission controller. An expired or revoked key remains rejected regardless of
available quota. See [deployment](deployment.md) for operational prerequisites.

The default remains Jev 1.14 with `balanced-v1`. This feature does not qualify the model against
business quality targets or promote experimental decision profiles. Existing published benchmark
limitations and the protected-zone launch gate still apply.
