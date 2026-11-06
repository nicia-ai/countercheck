# Implementation verification

Status: engineering verification and development measurements through November 5, 2026. This is not production model qualification.

## Current automated checks

The maintained tree passes strict TypeScript checking, ESLint, formatting, 754 TypeScript tests across 47 files, eight Python analysis regression tests, and a Cloudflare Worker deployment dry run. The published evaluation table and artifact hashes were also checked independently. Re-run the commands rather than treating this dated count as a permanent property:

```sh
pnpm check
pnpm test
pnpm build
python3 -B -m unittest discover -s tests -p 'test_eval_release_analysis.py'
python3 -B scripts/verify-eval-release.py
```

Coverage includes HTTP contracts and attribution, strict probability validation, provider transport and redirects, input/body budgets, single-call execution, error and uncertainty handling, native model selection, real workerd/D1 behavior, atomic shared admission limits, hash-only API keys, invitation-only mailbox verification, cookie isolation, access requests, usage accounting and retention. The synthetic provider exercises the actual kernel; it is not a production fallback or a semantic-quality test.

The offline release verifier works in an isolated checkout containing only committed redacted artifacts and the Python standard library. It verifies nine models, 8,280 observations and 72 scorecards without credentials, network access, raw dataset text or ignored reports. A deliberately changed artifact is rejected. The separate post-hoc supplement deterministically recomputes 45 ranking/operating-point rows, 63 native-negative-label slices, and six source-group paired comparisons. The original aggregate verifier does not independently recompute every historical bootstrap interval or diagnostic curve.

## Measured model work

- [Latest methodology and nine-model results](../EVALUATION.md): fixed shipped policy across eight exposed models plus evaluation-only hosted GLiDE 27B.
- [Original eight-model archive](../eval/results/hosted-models-2026-11-05/README.md): pre-inference protocol, source snapshots, input hashes and detailed metrics.
- [Fastino extension](../eval/results/hosted-models-with-glide-2026-11-05/README.md): identical shared inputs and kernel, a separate execution protocol, and combined redacted scoring rows.
- [Post-hoc statistical supplement](../eval/results/hosted-models-analysis-2026-11-05/README.md): metric-specific paired intervals, native-label coverage and explicitly retrospective threshold sensitivity. Frozen measurement archives remain unchanged.
- [Earlier public baselines](../eval/README.md), [business evaluation](../eval/results/business-2026-11-04/README.md), and [controlled quality iterations](../eval/results/quality-iterations-2026-11-03/README.md): retained development evidence and limitations, including negative experiments.

Native labels, uncertainty, errors, exclusions, source groups, probability denominators and unknown usage remain explicit. The overlapping 23/82-pair finance cohorts are not counted as independent examples. Original finance report text remains local; the current scoring release contains redacted derivatives and text hashes. Measured artifacts and original third-party terms are not rewritten to conceal failed experiments or change outcomes.

## Review and operational evidence

Review-driven changes include shared contract/verdict/hash logic, one deadline owner, strict replay provenance, incremental checkpoints, duplicate-JSON rejection, redirect refusal, exact reported-model checks where required, and explicit usage completeness. Automated tests and source implement those properties. Internal agent transcripts, account-quota conversations and per-review billing/session records are excluded from the public tree; they are not a certification or benchmark result. See [review process](reviews/README.md).

The [initial controlled deployment record](deployments/2026-11-03-preview.md) is historical operational evidence. It is not an invitation to use a maintainer credential, a current production-readiness assertion, or a capacity qualification. Provision your own account and resources using [deployment setup](deployment.md).

No model met all three proposed quality targets together on the latest public scorecards. A human-adjudicated pair corpus matching the service contract, disjoint validation, and deployed reliability/capacity measurements remain separate release work. A successful deployment, completed inference, synthetic test or review score does not replace those gates.
