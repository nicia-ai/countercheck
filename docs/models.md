# Supported hosted models

Countercheck exposes a fixed set of hosted inference models through the check API and dashboard.
`model` is optional and defaults to pinned `jev-1.14.0`.

| Request `model`                      | Display name                         | Provider route                 | Runtime configuration |
| ------------------------------------ | ------------------------------------ | ------------------------------ | --------------------- |
| `jev-1.14.0`                         | Jev 1.14                             | TypeSafe HTTPS, pinned version | `TYPESAFE_API_KEY`    |
| `clef`                               | Clef                                 | Cloudflare Workers AI          | `AI` binding          |
| `clef-flash`                         | Clef Flash                           | Cloudflare Workers AI          | `AI` binding          |
| `clef-omni`                          | Clef Omni                            | Cloudflare Workers AI          | `AI` binding          |
| `gpt-6-luna`                         | GPT-6 Luna (OpenAI Decisions)        | OpenAI Decisions               | `OPENAI_API_KEY`      |
| `microsoft/microsoft-decision-1`     | Decision-1 (OpenRouter)              | OpenRouter                     | `OPENROUTER_API_KEY`  |
| `perplexity/pplx-decider-v1.2`       | Pplx Decider v1.2 (OpenRouter)       | OpenRouter                     | `OPENROUTER_API_KEY`  |
| `perplexity/pplx-decider-flash-v1.2` | Pplx Decider Flash v1.2 (OpenRouter) | OpenRouter                     | `OPENROUTER_API_KEY`  |

Jev uses the exact `jev-1.14.0` version rather than a moving latest alias. Cloudflare model aliases
and external-provider model IDs retain the revision guarantees of their provider; the service does
not claim immutable weights where the upstream route does not provide them. Provider failures do
not trigger fallback to a different model.

## Provider-reported model IDs

OpenRouter currently reports dated snapshot IDs for three canonical request models. Response
validation accepts either the canonical requested ID or only these reviewed snapshots, and preserves
the reported ID unchanged:

| Canonical request model              | Accepted dated reported ID                    |
| ------------------------------------ | --------------------------------------------- |
| `microsoft/microsoft-decision-1`     | `microsoft/microsoft-decision-1-20261009`     |
| `perplexity/pplx-decider-v1.2`       | `perplexity/pplx-decider-v1.2-20261016`       |
| `perplexity/pplx-decider-flash-v1.2` | `perplexity/pplx-decider-flash-v1.2-20261016` |

These dated identities are response metadata, not additional selectable request IDs. Unknown or
cross-model identities fail closed; the adapter does not accept arbitrary snapshots or rewrite the
reported identity. The exact smoke results are in [hosted model catalog validation](model-catalog-validation.md).

Choose a model in the playground or include `model` in either check endpoint's JSON body:

```json
{
  "model": "perplexity/pplx-decider-v1.2",
  "claim": { "id": "claim", "text": "Single sign-on is included in every plan." },
  "against": [
    { "id": "comparison_1", "text": "Single sign-on is available on the Enterprise plan only." }
  ]
}
```

Omitting `model` is equivalent to `"model": "jev-1.14.0"`. Model selection is independent of
`profile`, which still defaults to `balanced-v1`. All hosted models share the same tenant and global
pilot limits, key permissions, input limits, and per-comparison response contract. Switching models
does not reset quota. The response's `engine.provider` and `engine.requested_model` identify the
selected route; `reported_model` and `model_revision` preserve metadata actually supplied by the
provider. Missing reported identity remains null, and an explicit identity mismatch is rejected.

## Deployment availability

Discover the catalog without making an inference call:

```sh
curl https://countercheck.nicia.ai/v1/models
```

The response includes the default plus every supported model's `id`, `name`, `provider`, and
`configured` flag. Unconfigured models remain in the catalog; the dashboard marks them as
unconfigured and disables them. `configured` reports configuration presence only: a nonempty
provider credential or the required Workers AI binding is present. It does not validate a
credential, contact the upstream service, measure provider health or capacity, or qualify a model's
quality. Availability can change between deployments. The API returns `422 invalid_request` for an
unknown model ID and `503 provider_not_configured` if a requested model's route is not configured.

`TYPESAFE_API_KEY` is needed for Jev. At runtime, absent `OPENAI_API_KEY` or `OPENROUTER_API_KEY`
secrets disable the corresponding routes. The maintained CI deployment requires both names,
alongside the Jev and account secrets, so all eight hosted models stay configured. The Workers AI binding is configured in
Wrangler rather than as a secret. Add only credentials for providers you intend to enable; never put
provider credentials in browser code or request bodies. See [deployment](deployment.md) for
provisioning guidance.

Every model remains an English evaluation preview. The catalog does not assert model-quality
qualification. DeBERTa remains an evaluation-only comparator; benchmark results do not qualify the
hosted routes. See the [benchmark evidence](../README.md#evaluation) for measured results and
limitations.

Hosted GLiDE 27B is measured through the separate evaluation adapter. Provisioning `FASTINO_API_KEY` alone does not expose it in this catalog; see [benchmark coverage versus API availability](../EVALUATION.md#benchmark-coverage-and-api-availability).

Nace Drex also has a separate [evaluation backend](../eval/README.md#nace-drex-evaluations), using `NACE_API_KEY` with the active IDs `drex-v1.5`, `drex-v2.0`, `drex-max`, `drex-max-v1.1`, and `drex-max-finance`. These IDs are not accepted by `/v1/check` or shown in the dashboard; adding an evaluation credential does not enable a hosted route.

Drex Max and Max Finance have [separately fitted calibration results](../eval/results/nace-calibration-2026-11-06/README.md). These remain offline operating-policy experiments; neither has met all three native-label point targets or been promoted into the API catalog.

Google Gemini Decision 1 (`google/gemini-decision-1`) is measured through the evaluation-only `openrouter-candidate` backend, pinned to the reviewed snapshot `google/gemini-decision-1-20261111`. It is not accepted by `/v1/check` or shown in the dashboard. The [current field table](../EVALUATION.md#the-field-today) shows where every measured model stands, including which of the eight selectable models the viability screen has set aside.
