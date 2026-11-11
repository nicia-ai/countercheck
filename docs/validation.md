# Implementation verification

Status: engineering verification and development measurements through November 6, 2026. This is not production model qualification.

## Current automated checks

The maintained tree passes strict TypeScript checking, ESLint, formatting, 789 TypeScript tests across 53 files, 28 Python analysis regression tests, and a Cloudflare Worker deployment dry run. The published evaluation tables and artifact hashes were also checked independently. Re-run the commands rather than treating this dated count as a permanent property:

```sh
pnpm check
pnpm test
pnpm build
python3 -B -m unittest discover -s tests -p 'test_*.py'
python3 -B scripts/verify-calibration-followup.py
python3 -B scripts/compare-nace.py --verify eval/results/nace-2026-11-06
python3 -B scripts/analyze-nace-calibration.py --archive eval/results/nace-calibration-2026-11-06
python3 -B scripts/archive-measurement.py --verify eval/results/gemini-decision-1-archive-880-2026-11-11
python3 -B scripts/archive-measurement.py --verify eval/results/gemini-decision-1-validation-688-2026-11-11
python3 -B scripts/screen-models.py --verify eval/results/model-screen-2026-11-11
```

Coverage includes HTTP contracts and attribution, strict probability validation, provider transport and redirects, input/body budgets, single-call execution, error and uncertainty handling, native model selection, real workerd/D1 behavior, atomic shared admission limits, hash-only API keys, invitation-only mailbox verification, cookie isolation, access requests, usage accounting and retention. The synthetic provider exercises the actual kernel; it is not a production fallback or a semantic-quality test.

The offline release verifier works in an isolated checkout containing only committed redacted artifacts and the Python standard library. It verifies nine models, 8,280 observations and 72 scorecards without credentials, network access, raw dataset text or ignored reports. A deliberately changed artifact is rejected. The separate post-hoc supplement deterministically recomputes 45 ranking/operating-point rows, 63 native-negative-label slices, and six source-group paired comparisons. The original aggregate verifier does not independently recompute every historical bootstrap interval or diagnostic curve.

The calibration-follow-up verifier also runs the original release verification and checks both nine-model calibration versions, including the successful Jev validation rerun. The two Nace verifiers add the five-model, 4,600-assessment shipped-policy extension and the two-model, 6,400-call calibration study. The latter independently refits the frozen policies and recomputes 192 scorecards and 54 paired comparisons. All use committed redacted artifacts without provider access; verification makes no new model calls.

## Measured model work

- [Current methodology and results](../EVALUATION.md): the current fifteen-model field, results by domain, separately fitted operating policies, and the history of the study.
- [Nace shipped-policy extension](../eval/results/nace-2026-11-06/README.md): five additional evaluation-only models, frozen original inputs and a fourteen-model comparison.
- [Model viability screen](../eval/results/model-screen-2026-11-11/README.md): a post-hoc paired screen of all fifteen measured models, including Gemini Decision 1 ([880-pair](../eval/results/gemini-decision-1-archive-880-2026-11-11/README.md) and [validation](../eval/results/gemini-decision-1-validation-688-2026-11-11/README.md) archives), on ranking quality and latency across the 880-pair archive and the 688-pair validation cohort. It directs evaluation effort only; the API catalog is unchanged.
- [Nace calibration follow-up](../eval/results/nace-calibration-2026-11-06/README.md): Max and Max Finance policies frozen before validation, an eleven-model calibrated comparison, sensitivity analysis and synthetic contract controls. Finance validates at 96.7% precision, 69.8% recall and 70.6% negative coverage; its paired intervals do not establish an improvement over calibrated Decider.
- [Original eight-model archive](../eval/results/hosted-models-2026-11-05/README.md): pre-inference protocol, source snapshots, input hashes and detailed metrics.
- [Fastino extension](../eval/results/hosted-models-with-glide-2026-11-05/README.md): identical shared inputs and kernel, a separate execution protocol, and combined redacted scoring rows.
- [Post-hoc statistical supplement](../eval/results/hosted-models-analysis-2026-11-05/README.md): metric-specific paired intervals, native-label coverage and explicitly retrospective threshold sensitivity. Frozen measurement archives remain unchanged.
- [Earlier public baselines](../eval/README.md), [business evaluation](../eval/results/business-2026-11-04/README.md), and [controlled quality iterations](../eval/results/quality-iterations-2026-11-03/README.md): retained development evidence and limitations, including negative experiments.

Native labels, uncertainty, errors, exclusions, source groups, probability denominators and unknown usage remain explicit. The overlapping 23/82-pair finance cohorts are not counted as independent examples. Original finance report text remains local; the current scoring release contains redacted derivatives and text hashes. Measured artifacts and original third-party terms are not rewritten to conceal failed experiments or change outcomes.

## Review and operational evidence

Review-driven changes include shared contract/verdict/hash logic, one deadline owner, strict replay provenance, incremental checkpoints, duplicate-JSON rejection, redirect refusal, exact reported-model checks where required, and explicit usage completeness. Automated tests and source implement those properties. Internal agent transcripts, account-quota conversations and per-review billing/session records are excluded from the public tree; they are not a certification or benchmark result. See [review process](reviews/README.md).

The [initial controlled deployment record](deployments/2026-11-03-preview.md) is historical operational evidence. It is not an invitation to use a maintainer credential, a current production-readiness assertion, or a capacity qualification. Provision your own account and resources using [deployment setup](deployment.md).

No model met all three proposed quality targets together on the latest public scorecards. A human-adjudicated pair corpus matching the service contract, disjoint validation, and deployed reliability/capacity measurements remain separate release work. A successful deployment, completed inference, synthetic test or review score does not replace those gates.
