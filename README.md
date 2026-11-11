# Countercheck

<a href="https://countercheck.nicia.ai"><img src="docs/assets/countercheck-logo.png" alt="Countercheck — opposing logic brackets around a red square" width="540" /></a>

Countercheck combines a contradiction-detection API with a reproducible evaluation harness for decision models. The stateless API compares one caller-supplied claim with up to twenty
caller-supplied texts. It reports pair-level contradictions, uncertainty, and the exact submitted
text IDs it evaluated. It does not retain a customer corpus, retrieve evidence, choose which text is
right, or decide whether a write should be admitted.

**[Try Countercheck online →](https://countercheck.nicia.ai)** — compare statements in your browser, choose a model, and create an API key. The hosted preview is invitation-only; request access on the site if you haven't been invited.

Start with the **[evaluation approach and results](EVALUATION.md)** if you build or evaluate decision models. You can recompute the published aggregate metrics and analysis offline without provider keys, Cloudflare, or a Countercheck account.

Hosted API: [OpenAPI](https://countercheck.nicia.ai/openapi.json) · [health](https://countercheck.nicia.ai/health). Hosting and authentication are separate from the evaluation toolkit.

The service is not yet qualified for production. The approved beta targets are evaluation gates,
not measured results: contradiction precision of at least 0.95, recall of at least 0.90, and a
definitive negative answer for at least 0.85 of clearly non-contradictory pairs, with confidence
intervals and category-level reporting. See [the design](docs/design.md) for the complete contract
and release protocol.

## Evaluation

**Fifteen hosted decision models measured as of November 11, 2026**, each on the same 880 public pairs across Wikipedia, science, commercial contracts, business-adjacent language and finance, with one prompt and fixed thresholds. Twelve are also measured on a disjoint 688-pair validation cohort. Failed and uncertain results stay in the denominators. Nicia has no commercial relationship with any evaluated model provider.

| Status        | Models                                                                         |
| ------------- | ------------------------------------------------------------------------------ |
| Viable        | GLiDE 27B, drex-max-finance, Pplx Decider v1.2, drex-max-v1.1, Jev 1.14        |
| Deprioritized | drex-max, Pplx Decider Flash v1.2, Clef Omni, drex-v1.5, drex-v2.0, Clef Flash |
| Screened out  | Gemini Decision 1, Clef, Decision-1, GPT-6 Luna Decisions                      |

- **No model meets all three quality targets together** on any scorecard, with the shared thresholds or with thresholds fitted per model.
- **Four models lead on ranking quality and are not separable:** GLiDE 27B, drex-max-finance, Pplx Decider v1.2 and drex-max-v1.1.
- **Jev 1.14 is the fastest route** (107 ms p95 on the 880 pairs) and completed every call; it ranks below the leaders.
- **Gemini Decision 1 was measured on its release day and lands mid-field:** sixth of fifteen on ranking, best on science, and set aside because drex-max-finance ranks better in both cohorts at lower latency.
- **Fitted thresholds help but do not close the gap.** The best validated results are 96.7% precision / 69.8% recall / 70.6% negative coverage (drex-max-finance) and 96.0 / 67.5 / 74.2 (Pplx Decider v1.2); their difference is within its paired interval.
- **The API catalog trails the measurements.** Only two of the eight selectable models are viable; GLiDE, Nace Drex and Gemini Decision 1 are evaluation-only.

A status comes from the [viability screen](eval/results/model-screen-2026-11-11/README.md): a paired comparison of ranking quality and latency across both cohorts. It directs evaluation effort and changes nothing in the API. These are native public labels, development data and one pass per model, not human-adjudicated service-contract results.

Read **[the evaluation page](EVALUATION.md)** for the full field table, results by domain, fitted-threshold results, method, limitations, and how the study evolved. It also covers [adding or re-measuring a model](EVALUATION.md#add-or-re-measure-a-model), which takes one runner, one archiver and one screen. The 204-item human labelling packet is prepared, not yet labelled.

Verify the published numbers using only Python and committed artifacts:

```sh
python3 -B scripts/verify-eval-release.py
python3 -B scripts/verify-calibration-followup.py
python3 -B scripts/compare-nace.py --verify eval/results/nace-2026-11-06
python3 -B scripts/analyze-nace-calibration.py --archive eval/results/nace-calibration-2026-11-06
python3 -B scripts/archive-measurement.py --verify eval/results/gemini-decision-1-archive-880-2026-11-11
python3 -B scripts/archive-measurement.py --verify eval/results/gemini-decision-1-validation-688-2026-11-11
python3 -B scripts/screen-models.py --verify eval/results/model-screen-2026-11-11
```

To exercise the runner without credentials or model calls:

```sh
pnpm install --frozen-lockfile
pnpm eval:smoke
```

To run new experiments, see [bounded live runs](EVALUATION.md#run-a-new-evaluation), [custom scorer replay](EVALUATION.md#evaluate-your-own-model), the [runner reference](eval/README.md), and [business dataset preparation](eval/business/README.md). Each provider requires your own credentials; HTTPS-provider evaluations do not require a Nicia account. Live calls need explicit opt-in and call/spend reservations. Unknown billed cost is not reported as zero.

The [earlier profile-regression investigation](docs/evaluations/profile-regression-diagnosis.md), [controlled iterations](eval/results/quality-iterations-2026-11-03/README.md), and [offline DeBERTa baseline](eval/results/deberta-dev-2026-11-03/README.md) retain useful negative results and distinct training/coverage disclosures. The historical request-level admission benchmark is a different task and is not pair-level contradiction gold. None of these runs certifies production capacity or the service's human-adjudicated release gate.

## Dashboard beta

The dashboard includes invitation-only Better Auth accounts, one-time API key creation, a session-authenticated
playground, usage views and administrative pause controls. See [self-service beta](docs/self-service-beta.md)
for limits, telemetry and account behavior. Cloudflare Workers Builds deploys `main` from
[`nicia-ai/countercheck`](https://github.com/nicia-ai/countercheck); GitHub Actions runs checks only.
GitHub checks also exercise the offline analysis verifier. See [deployment](docs/deployment.md) for runtime setup and release gates.

## Local service quickstart

For evaluation only, use the [evaluation quickstart](EVALUATION.md#verify-the-published-numbers-offline); the dashboard and database are unnecessary.

The checked-in Wrangler configuration names the maintainer's Cloudflare account, domain and resources. For your own service deployment, configure your own account/resources and named Wrangler profile first; see [deployment setup](docs/deployment.md). The following commands are for a checkout already configured for your account.

Requirements: Node.js 24.22.2 and pnpm 11.20.0.

```sh
pnpm install
pnpm exec wrangler auth activate YOUR_PROFILE .
cp .dev.vars.example .dev.vars
pnpm exec wrangler d1 migrations apply countercheck --local --config wrangler.jsonc
pnpm dev
```

Set the account variables described in `.dev.vars.example`, including a dedicated auth secret,
Resend credential and bootstrap administrator email. Open `/dashboard`, request a sign-in link for that address,
and follow the emailed link to verify mailbox access and create a key. The dashboard displays the `cck_...` API key once; save it securely.
The server stores only its SHA-256 hash. Existing operator-issued keys require explicit tenant
enrollment through the authenticated operator controls; creating a key alone no longer grants
inference access. Use `pnpm keys ... --remote` only when deliberately operating on the configured
remote database.

Set a valid provider credential in `.dev.vars` as `TYPESAFE_API_KEY` before calling the API. This
credential is used by the Jev provider; the local API does not have an auth bypass or a fake-model
fallback. The `AI` binding and optional `OPENAI_API_KEY` and `OPENROUTER_API_KEY` secrets enable the
other hosted routes described in [supported models](docs/models.md). Keep `.dev.vars` private and
never commit it. Start the Worker with `pnpm dev`; Wrangler
prints its local address (normally `http://localhost:8787`).

Call the local Worker with curl:

```sh
export COUNTERCHECK_URL=http://localhost:8787
read -rs COUNTERCHECK_API_KEY
export COUNTERCHECK_API_KEY
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $COUNTERCHECK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"claim":{"id":"new-policy","text":"The Starter plan includes SSO."},"against":[{"id":"current-policy","text":"The Starter plan does not include SSO."}]}' \
  "$COUNTERCHECK_URL/v1/check"
unset COUNTERCHECK_API_KEY
```

The same request using Node's built-in `fetch`:

```sh
read -rs COUNTERCHECK_API_KEY
export COUNTERCHECK_API_KEY
node --input-type=module <<'NODE'
const response = await fetch(`${process.env.COUNTERCHECK_URL}/v1/check`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.COUNTERCHECK_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    claim: { id: "new-policy", text: "The Starter plan includes SSO." },
    against: [{ id: "current-policy", text: "The Starter plan does not include SSO." }],
  }),
});
console.log(response.status, await response.json());
NODE
unset COUNTERCHECK_API_KEY
```

The response is probabilistic. `no_contradiction_detected` means the detector did not identify a
contradiction in that submitted pair; it is not proof that the texts are consistent. A `completed`
response means all requested pairs were assessed, including pairs whose verdict is `uncertain`.
Verdicts belong to `comparisons[]` only; there is no top-level verdict.
See [the API and semantic contract](docs/design.md#http-api).

## Supported models

Jev 1.14 is the default. The hosted selector includes:

| Request `model`                      | Provider route        |
| ------------------------------------ | --------------------- |
| `jev-1.14.0`                         | TypeSafe              |
| `clef`                               | Cloudflare Workers AI |
| `clef-flash`                         | Cloudflare Workers AI |
| `clef-omni`                          | Cloudflare Workers AI |
| `gpt-6-luna`                         | OpenAI Decisions      |
| `microsoft/microsoft-decision-1`     | OpenRouter            |
| `perplexity/pplx-decider-v1.2`       | OpenRouter            |
| `perplexity/pplx-decider-flash-v1.2` | OpenRouter            |

The dashboard lists every supported ID and marks models whose provider is not configured; all models
share account limits. `GET /v1/models` exposes the same catalog and configuration flags without
running inference. `configured` reflects credential or binding presence, not credential validity or
provider health. OpenAI Decisions and OpenRouter credentials are optional runtime secrets. See
[model selection and provider details](docs/models.md) and [deployment](docs/deployment.md).

## Experimental decision profiles

The default remains `balanced-v1`. Explicitly select `semantic-v2` for a compact shared rubric
with contrastive examples, or `structured-value-v1` for bounded value selection and deterministic
interval comparisons. Both are experimental. Structured responses expose a choice distribution
rather than inventing four-way `raw_scores`; check the signal representation before reading it.
See [profile behavior and qualification](docs/decision-engineering.md) and the
[engineering evaluation workflow](eval/engineering/README.md). Local changes do not update the hosted preview automatically.

## Development checks

```sh
pnpm check       # TypeScript, ESLint, and Prettier
pnpm test        # Unit and integration tests
pnpm smoke       # Local API smoke test
pnpm build       # Wrangler Worker dry run; does not deploy
```

An IP ingress limiter protects checks and private readiness before parsing or D1 lookup; an independent
per-key limiter protects inference. Both are approximate per Cloudflare location, not global quotas.
Ingress and body parsing share a 2-second budget.

The service stores API key hashes and daily aggregate usage in D1, but no request text or provider
output. Application code must not log customer text, caller IDs, keys, upstream error bodies, or
model outputs. Wrangler enables Workers observability with query-string redaction and disables
automatic invocation logs; the platform retention limit for Workers Logs is seven days. Do not add
request-body logging or trace payloads.

Usage counters are advisory: their token counter is the subtotal of reported input tokens, with
`unknown_token_requests` tracking missing usage separately. They are not a billing ledger. The
response preserves missing provider usage as `null`.

A daily midnight-UTC scheduled handler removes aggregate usage outside the current and preceding
29 UTC dates, even when no successful requests arrive. Operational failures of that cleanup must
be monitored like other scheduled-worker failures; this is a daily retention policy, not a precise
per-row thirty-day timer.

## Deployment

Deployment is pinned to a dedicated Cloudflare D1 database and account ID in `wrangler.jsonc`, plus
Cloudflare account credentials and a provider credential in the `TYPESAFE_API_KEY` secret. The
configured custom domain is `countercheck.nicia.ai`; the production WAF rule must cover it before
customer traffic. A controlled authenticated preview uses the native ingress limiter while that
production gate is pending. Cloudflare Workers Builds deploys `main` from
`nicia-ai/countercheck` using `pnpm ci:build` and `pnpm ci:deploy`; GitHub Actions runs checks only.
The deploy preflight verifies runtime secret names and applies D1 migrations before publishing.
Runtime secrets stay on the Worker, separate from build credentials. Deployment does not create
Cloudflare resources or qualify the model for production use. Follow
[the deployment notes](docs/deployment.md) and the release gates in
[the design](docs/design.md#evaluation-and-release-gates).

## Licensing

Original software and documentation are licensed under [Apache 2.0](LICENSE). See [NOTICE](NOTICE) for project attribution and [DATA_NOTICE.md](DATA_NOTICE.md) for the separate dataset, model, and third-party terms. The [publication review](docs/publication-review.md) records the credential/data checks, omitted internal material, and the Git-history cleanup and its limits.
