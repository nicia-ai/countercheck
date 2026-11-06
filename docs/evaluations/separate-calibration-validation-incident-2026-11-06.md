# Jev validation execution failure

Status: **historical upstream cause unconfirmed; separately authorized rerun succeeded**. November 6, 2026.

Jev 1.14 completed all 2,512 fit assessments without errors. After all nine fit runs completed, its operating policy was frozen with the other policies. Its subsequent 688 validation assessments all failed with the sanitized code `provider_invalid_response` between 09:38:44 and 09:39:11 UTC (01:38:44–01:39:11 Pacific). No probabilities or semantic verdicts were imputed for these cases.

The frozen adapter in `src/providers/transport.ts` uses this code for multiple conditions: certain non-success HTTP statuses, invalid JSON/content type, and response-schema failures. HTTP 401/403, 408/504, 429 and 5xx have separate branches, but HTTP 402 falls into the generic invalid-response branch. The runner deliberately retains neither provider error bodies nor the upstream HTTP status, so the saved artifacts cannot identify which branch caused these failures. The provider/kernel source was unchanged between fit and validation. The launchers used the same credential-loading logic; the historical credential values are not archived.

**Insufficient credits is a hypothesis, not a confirmed diagnosis.** TypeSafe documents HTTP 402 as usually indicating insufficient credits in its [help article](https://help.typesafe.ai/articles/5505198974). We did not record HTTP 402 and cannot infer it from `provider_invalid_response` alone. Account billing/request-log confirmation was requested from the operator. No extra inference probe, purchase, retry, credential replacement, timeout change or runtime patch was made within the original run.

For Jev validation, successful-assessment count is zero and **semantic quality is unmeasured**. Execution-inclusive recall remains zero under the preregistered rule that failures stay in the denominator. Zero false positives or false clears on an all-failed run is not evidence of semantic safety. Other models completed validation under their frozen policies.

Jev's separately fitted policy can still be deterministically applied to the original archived probabilities, with the same development-sample limitations as the other models. That archived recomputation does not replace the missing independent validation evidence.

A future validation rerun needs explicit authorization, a fresh versioned output, and a separate call/spend reservation; this study's no-retry artifacts must remain intact. A separate observability change should preserve safe upstream status/error categories without retaining bodies or customer text. Neither follow-up is part of this measured run or a change to the shipped service.

## Authorized follow-up

After the owner reported adding credits and authorized a fresh 688-call run with a $1.38 reservation, all 688 Jev assessments succeeded and returned HTTP 200. The [new version](../../eval/results/calibration-followup-2026-11-06/README.md) uses the original cohort, deadline, prompt and frozen policies, with status-only observation. It retains the failed original records. This supports the billing explanation but does not establish which historical HTTP status produced the original generic error. The follow-up's additional negative-budget analysis is explicitly post hoc; it changes no service threshold or prompt.
