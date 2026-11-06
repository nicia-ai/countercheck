# Hosted model catalog validation

Status: functional smoke evidence, 2026-11-05. This is not a quality benchmark or a release-quality qualification.

The API and dashboard expose eight hosted models, with Jev 1.14 still the default. Kev is excluded:
it is absent from the checked [OpenRouter model catalog](https://openrouter.ai/api/v1/models) and
[Workers AI catalog](https://developers.cloudflare.com/workers-ai/models/), and this service does
not operate a self-hosted Kev server.

Each route was called using the shipped provider adapter and `balanced-v1` kernel. Clef routes
used the native Workers AI binding through Wrangler's remote binding proxy in the `nicia-ai`
profile. Other routes used their native HTTPS Decisions interfaces. No customer text was used.

Synthetic pair:

- Claim: “Single sign-on is included in every plan.”
- Comparison: “Single sign-on is available on the Enterprise plan only.”

| Requested model                      | Reported model                                | Observed result          |
| ------------------------------------ | --------------------------------------------- | ------------------------ |
| `jev-1.14.0`                         | `jev-1.14.0`                                  | Completed; contradiction |
| `clef`                               | `clef`                                        | Completed; contradiction |
| `clef-flash`                         | `clef-flash`                                  | Completed; contradiction |
| `clef-omni`                          | `clef-omni`                                   | Completed; contradiction |
| `gpt-6-luna`                         | `gpt-6-luna`                                  | Completed; contradiction |
| `microsoft/microsoft-decision-1`     | `microsoft/microsoft-decision-1-20261009`     | Completed; contradiction |
| `perplexity/pplx-decider-v1.2`       | `perplexity/pplx-decider-v1.2-20261016`       | Completed; contradiction |
| `perplexity/pplx-decider-flash-v1.2` | `perplexity/pplx-decider-flash-v1.2-20261016` | Completed; contradiction |

OpenRouter initially returned dated IDs that strict canonical-only identity validation rejected.
The adapters now accept only the requested canonical ID or its explicitly reviewed dated snapshot;
they preserve the reported identity unchanged. These snapshots were checked against each model's
official OpenRouter endpoint catalog. Unknown snapshots and cross-model identities fail closed.

A later deployed-route smoke found that valid OpenRouter responses also include `usage.is_byok`
and `usage.cost_details`. The adapter strips unused router billing metadata before normalizing
usage; token counts, answer distributions and model identity remain validated. Regression fixtures
cover the observed metadata on all three OpenRouter routes and still reject malformed token counts.
This does not change the archived benchmark observations or measured source snapshots.

Automated coverage additionally checks all eight routes, unavailable configurations without
fallback, native response normalization and malformed outputs, shared quota across model switches,
and a converted OpenAI request that exceeds the wire limit before admission is charged.

This one-pair smoke verifies connectivity and response handling. It cannot compare accuracy,
calibration, domain coverage, or production latency. Existing benchmark reports remain separate;
new hosted availability does not imply a new model-quality claim.
