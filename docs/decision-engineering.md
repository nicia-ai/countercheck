# Decision engineering

Status: implemented experimental profiles. `balanced-v1` remains the default; profile selection does not establish quality qualification.

The default `balanced-v1` request and decision policy remain available for reproducibility. The
opt-in `semantic-v2` and `structured-value-v1` profiles implement the next iteration from the
[measured engineering plan](evaluations/decision-model-engineering-2026-11-03.md). No profile has
passed the production quality gates.

## Profiles

Send `profile` explicitly in the existing `POST /v1/check` body to select an experiment:

```json
{
  "profile": "semantic-v2",
  "claim": { "id": "new", "text": "The Starter plan includes SSO." },
  "against": [{ "id": "old", "text": "The Starter plan does not include SSO." }]
}
```

`semantic-v2` shares the rubric and contrastive examples once and places each comparison in its
own question instructions. Questions ask directly about the literal compatibility of that pair.
This avoids copying a full rubric twenty times and exposing other comparisons as evidence.
The shared claim and rubric remain visible to all questions; this is not a security isolation
boundary. Field/option order and distractor probes measure the effect rather than assume immunity.

`structured-value-v1` adds bounded candidate selection. Code discovers supported, exact value
spans and normalizes their intervals. A model judgment decides whether candidate values belong
to the same asserted fact under overlapping scope and times. Code compares approved values;
it does not ask the model to do arithmetic. A supported disjoint comparison can establish a
contradiction. A compatible numeric pair cannot establish compatibility of every other assertion.
Unsupported extraction, missing identity, disputed assertion status and incomplete candidate
coverage preserve uncertainty in the structured lane.

Treat structured signals as diagnostic model outputs. They are not a calibrated probability of
the final verdict. Responses with a structured choice distribution do not manufacture four-way
`raw_scores`. Clients must check which signal representation is present. Missing token usage
also stays unknown.

Every profile retains the same input and complete compiled-payload budgets, one provider call,
atomic comparison coverage, no automatic retries, and no silent truncation. Twenty short pairs
must fit; twenty maximum-size snippets need not. Overflow fails before inference.

## Evaluation and qualification

The [engineering evaluation guide](../eval/engineering/README.md) describes split, freeze,
probe, calibration and held-out evaluation commands. The ordinary benchmark runner also accepts
`--profile`; it records the selected profile and per-request payload hashes. `jev-direct` remains
a baseline-only scorer because the experimental profiles require their own composition.

Use training groups to edit examples and questions, development groups to compare frozen
candidates and fit composition, and locked groups once for evaluation. Group assignment and
content hashes are checked; local files are not an access-control boundary. Repeated requests
measure run variation on the same labels, not a larger independent sample. Public development
benchmarks and synthetic diagnostics cannot substitute for the independently human-adjudicated
release corpus.

Keep native benchmark labels intact. Additional service-contract labels need separate author,
review and adjudication provenance. Report both tasks when they differ; never silently relabel
native cases to improve a score. Calibration is an offline artifact and never silently changes
the deployed profile or thresholds.

Jev remains pinned to `jev-1.14.0`. Clef and Decider must run their own frozen provider-compatible
experiments before comparisons can be called optimized. Provider errors count as missing useful
answers; output schemas and prompts must match the actual adapter. Compare precision, recall,
false-clear errors, negative coverage, errors, input tokens and latency with the same labels and
coverage policy. No model receives a production qualification merely by winning a development
comparison.

Promotion requires the human-adjudicated corpus, locked evaluation, repeatability and adversarial
checks, and operational capacity/privacy gates described in [the design](design.md). A candidate
that misses a gate stays experimental.

## Measured first candidate iteration

The compact compiler is a new prompt formulation; it does not inherit the earlier single-pair
rich-rubric results. In the first frozen live Jev development pass, baseline VitaminC/SciFact
precision and recall were 93.1%/38.0% and 94.1%/45.1%. The compact semantic profile measured
93.1%/38.0% and 93.3%/39.4%. The structured profile measured 66.7%/2.8% and 100%/12.7%.
All 1,293 single-pair calls completed. These candidates therefore regress on useful recall;
neither should replace the baseline. Their synthetic contract diagnostics were also weaker:
28/32 baseline, 28/32 semantic and 18/32 structured, with the four expected-uncertain cases
excluded from binary quality metrics.

These are development findings from one pass, not a capacity limit or a causal proof about
shared context. Compressing the rubric changes what the model sees. The structured lane also
requires conservative, complete value coverage, and its larger option set can split probability
mass. Both mechanisms need further paired experiments against the retained raw signals and
contract labels before promotion. Independent review found an unsupported-unit comparator
bug after this initial pass; its correction and any affected-payload verification are recorded
with the [exact frozen results](../eval/results/decision-engineering-2026-11-03/README.md).

The corrected shared-guard structured rerun is worse still: VitaminC 0 true positives and one
false positive (0% precision/recall); SciFact eight true positives and no false positives
(100% precision, 11.3% recall); contract diagnostics 17/32. All 431 single-pair requests and both
20-comparison requests completed without errors or exclusions. This is a separate run after a
parser correction, not a controlled causal estimate of the correction alone. The toy live
calibration workflow also returned uncertainty on both held-out cases; it verifies execution
and data boundaries, not useful learned accuracy.

The hard completeness veto is too broad for practical use: incidental numbers and unsupported
forms can suppress otherwise useful semantic judgments. The next candidate should test an
independent whole-pair semantic lane alongside optional numeric proof, with a judgment about
whether an unresolved quantity is decisive rather than treating every number as decisive.
Measure that composition on separate native and contract labels before enabling it. Compact
shared examples also need a stronger formulation: the earlier rich single-pair improvement did
not survive this compiler unchanged. These results reject the current candidates for promotion;
they do not justify lowering the quality targets or replacing the baseline by default.

## Regression investigation and subsequent iterations

The [regression diagnosis](evaluations/profile-regression-diagnosis.md) separates observed causes
from hypotheses. Incomplete numeric coverage suppressed semantic decisions for identifiers such
as αvβ8 and CX3CR1. Compacting the rubric also changed criteria, examples and question placement
together; it did not preserve the earlier rich formulation. Actual numeric-option mass was
negligible on the measured public cases, so mass dilution alone does not explain the regression.

The new [research loop](../eval/iteration/README.md) tests local structured definitions and
invented contrasts, literal compatibility versus native NLI, independent Noul signals, and
semantic/numeric composition. Quantitative decisiveness is separate from candidate selection;
missing candidates matter only when the quantity is decisive. Refutation's negative answer is
separate from determinability. Comparisons with Clef and Decider use their actual pinned routes
and compatible mixed Choice/Noul responses. Multi-head variants make one physical request,
rather than joining scores from separately executed calls and calling that a bundled result.

The [measured iteration archive](../eval/results/quality-iterations-2026-11-03/README.md) retains
raw responses, source snapshots, native labels, training-only scalar/fusion policies, failed
experiments, fresh baseline reruns and reused development-validation results. Public source
components are separated before selection; a locked role remains unopened. The strongest
ranking model is not necessarily the best usable policy: enforcing training precision has
repeatedly produced conservative cutoffs and low recall. None of these experiments qualifies
an API default replacement. The human-adjudicated service-contract release gate remains unmet;
[the local provenance audit](evaluations/trusted-pair-label-audit.md) explains why aggregate
admission fixtures and model-validated retrieval data cannot fill it.
