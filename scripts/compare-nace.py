#!/usr/bin/env python3
"""Archive Nace append-only results and independently verify them without inference.

Create: python3 scripts/compare-nace.py --input RUN --out NEW_ARCHIVE
Verify: python3 scripts/compare-nace.py --verify ARCHIVE
"""
import argparse
import collections
import gzip
import hashlib
import json
import math
from pathlib import Path
import runpy
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'eval/results/hosted-models-with-glide-2026-11-05'
ORIGINAL = ROOT / 'eval/results/hosted-models-2026-11-05'
HELPERS = runpy.run_path(str(ROOT / 'eval/results/business-2026-11-04/metrics.py'), run_name='nace_independent_metrics')
metrics, close = HELPERS['metrics'], HELPERS['close']
ANALYSIS = runpy.run_path(str(ROOT / 'scripts/analyze-eval-release.py'), run_name='nace_shared_analysis')
COMPARATOR = 'perplexity/pplx-decider-v1.2'
PUBLIC_DATASETS = ('vitaminc', 'scifact', 'contractnli', 'mnli', 'findver')
PAIRED_REPLICATES = 20000
PAIRED_SEED = 20261106
INPUT_USD_PER_MILLION = {'drex-v1.5': .05, 'drex-v2.0': .06, 'drex-max': .03, 'drex-max-v1.1': .03, 'drex-max-finance': .03}
sha = lambda b: hashlib.sha256(b).hexdigest()
read = lambda p: json.loads(p.read_bytes())
pack = lambda v: (json.dumps(v, ensure_ascii=False, indent=2) + '\n').encode()
unzip = lambda p: json.loads(gzip.decompress(p.read_bytes()))
load_rows = lambda p: [json.loads(s) for s in gzip.decompress(p.read_bytes()).splitlines()]
PCT_FIELDS = ('precision', 'recall', 'clear_negative_coverage', 'coverage', 'false_positive_rate', 'completion')
SCALAR_FIELDS = ('f1', 'auroc', 'pr_auc_average_precision', 'brier')
COUNT_FIELDS = ('errors', 'excluded', 'probability_denominator')


def score(rows):
    return metrics([r['pair'] for r in rows],
                   {r['pair']['id']: r['prediction'].get('verdict', r['prediction']['status']) for r in rows},
                   {r['pair']['id']: r['prediction']['probabilities']['contradiction'] for r in rows if r['prediction']['status'] == 'ok'})


def check_metrics(actual, recorded):
    for k, v in [('tp', 'true_positive'), ('fp', 'false_positive'), ('tn', 'true_negative'), ('false_clears', 'definitive_false_negative')]:
        assert actual[k] == recorded['confusion'][v], (k, actual[k], recorded['confusion'][v])
    for k in PCT_FIELDS:
        close(actual[k], recorded[k]['value'])
    for k in SCALAR_FIELDS:
        close(actual[k], recorded[k])
    for k in COUNT_FIELDS:
        assert actual[k] == recorded[k]
    assert actual['binary_cases'] == recorded['denominator']
    assert actual['positive'] == recorded['positive'] and actual['negative'] == recorded['negative']


def recall95(rows):
    # Use the same raw-score, tie-preserving frontier as the November 5 supplement.
    return ANALYSIS['precision_frontier'](rows)['recall']


def uncertain_negative_leaders(rows):
    leaders = collections.Counter()
    for row in rows:
        p = row['prediction']
        if row['pair']['gold'] == 'contradiction' or p.get('verdict') != 'uncertain':
            continue
        raw = p['raw_scores']
        top = max(raw.values())
        winners = sorted(k for k, v in raw.items() if v == top)
        leaders[winners[0] if len(winners) == 1 else 'tie'] += 1
    return dict(sorted(leaders.items()))


def paired_comparisons(rows):
    baseline = load_rows(BASE / 'observations.redacted.jsonl.gz')
    result = []
    for model in sorted({r['model'] for r in rows}):
        for dataset in PUBLIC_DATASETS:
            first = {r['row']['pair']['id']: r['row'] for r in rows if r['model'] == model and r['dataset'] == dataset}
            second = {r['row']['pair']['id']: r['row'] for r in baseline if r['model'] == COMPARATOR and r['dataset'] == dataset}
            result.append(dict(first=model, second=COMPARATOR, dataset=dataset,
                               **ANALYSIS['paired'](first, second, replicates=PAIRED_REPLICATES, seed=PAIRED_SEED)))
    return result


def diagnostics(rows):
    expected = [r for r in rows if r['pair']['dataset'] == 'synthetic-smoke' and r['pair'].get('source_metadata', {}).get('expected_verdict')]
    correct = 0
    for row in expected:
        label = row['pair']['source_metadata']['expected_verdict']
        label = 'no_contradiction' if label == 'no_contradiction_detected' else label
        correct += row['prediction']['status'] == 'ok' and row['prediction'].get('verdict') == label
    return dict(execution_observations=len(rows), execution_completed=sum(r['prediction']['status'] == 'ok' for r in rows),
                execution_errors=sum(r['prediction']['status'] == 'error' for r in rows),
                execution_excluded=sum(r['prediction']['status'] == 'excluded' for r in rows),
                expected_uncertain_excluded_from_binary=len(rows)-score(rows)['binary_cases'],
                expected_verdict_cases=len(expected), expected_verdict_correct=correct)


def point_targets(runs):
    return [dict(model=r['model'], dataset=r['dataset'],
                 all_point_targets_met=all(r['independent_metrics'][k] is not None and r['independent_metrics'][k] >= v
                                          for k, v in [('precision', .95), ('recall', .9), ('clear_negative_coverage', .85)]))
            for r in runs if r['dataset'] in PUBLIC_DATASETS]


def operation(model, rows):
    selected = [r for r in rows if r['dataset'] not in ('synthetic-smoke', 'synthetic-contract') and r['model'] == model]
    predictions = [r['row']['prediction'] for r in selected]
    ok = [p for p in predictions if p['status'] == 'ok']
    times = sorted(p['latency_ms'] for p in ok)
    attempts = [p for p in predictions if p['status'] != 'excluded']
    known = [p for p in attempts if 'input_tokens' in p]
    return dict(model=model, selected=len(selected), completed=len(ok), errors=sum(p['status'] == 'error' for p in predictions),
                excluded=sum(p['status'] == 'excluded' for p in predictions),
                completed_p50_ms=times[math.floor((len(times)-1)*.5)] if times else None,
                completed_p95_ms=times[math.floor((len(times)-1)*.95)] if times else None,
                known_input_tokens=sum(p['input_tokens'] for p in known), unknown_input_observations=len(attempts)-len(known), actual_cost_usd=None)


def archive(source, out, probe_path=None):
    protocol = read(source / 'protocol.json')
    progress = read(source / 'progress.json')
    assert progress['status'] == 'complete' and len(progress['completed']) == 35
    assert protocol['planned_calls'] == 4600
    count = protocol['prior_integration_probes']
    assert type(count) is int and count >= 0
    probes = []
    if count:
        assert probe_path is not None, 'Probe receipt required for a nonzero prior-probe count'
        allowed = ('model', 'status', 'reported_model', 'input_tokens', 'http_status', 'latency_ms')
        probes = [{k: p[k] for k in allowed} for p in read(probe_path)]
        assert len(probes) == count
        assert all(p['status'] == 'ok' and p['http_status'] == [200] and p['reported_model'] == p['model'] for p in probes)
    assert protocol['inputs'] == read(ORIGINAL / 'protocol.json')['inputs']
    assert sha((ORIGINAL / 'protocol.json').read_bytes()) == protocol['baseline_protocol_sha256']
    snapshot = read(source / 'execution-sources.json')
    for path, h in protocol['sources'].items():
        assert sha(snapshot[path].encode()) == h
    parent = {(r['dataset'], r['row']['pair']['id']): r['row'] for r in load_rows(BASE / 'observations.redacted.jsonl.gz') if r['model'] == 'jev-1.14.0'}
    rows, runs, statuses, hashes = [], [], [], {}
    base_summary = read(BASE / 'summary.json')
    strict = set(next(r['pair_ids'] for r in base_summary['runs'] if r['model'] == 'jev-1.14.0' and r['dataset'] == 'findver-strict-subset'))
    for model in protocol['models']:
        for data in protocol['inputs']:
            prefix = source / f"{model['id']}.{data['id']}"
            report = read(Path(str(prefix) + '.json'))
            assert report['manifest_sha256'] == data['sha256']
            assert sha((ROOT / data['path']).read_bytes()) == data['sha256']
            original = {p['id']: p for p in read(ROOT / data['path'])['pairs']}
            checkpoint_bytes = Path(str(prefix) + '.predictions.jsonl').read_bytes()
            meta_bytes = Path(str(prefix) + '.predictions.jsonl.metadata.json').read_bytes()
            assert sha(checkpoint_bytes) == report['prediction_artifact']['sha256']
            assert sha(meta_bytes) == report['prediction_artifact']['metadata_sha256']
            checkpoint = {p['pair_id']: p for p in map(json.loads, checkpoint_bytes.splitlines())}
            assert len(report['rows']) == len(checkpoint) == data['pairs']
            status_bytes = Path(str(prefix) + '.http-status.jsonl').read_bytes()
            observed_statuses = list(map(json.loads, status_bytes.splitlines()))
            for row in report['rows']:
                pair, prediction = row['pair'], row['prediction']
                assert pair == original[pair['id']] and prediction == checkpoint[pair['id']]
                prior = parent[data['id'], pair['id']]
                text = {k: v for field in ('claim', 'evidence') for k, v in (
                    (field + '_sha256', sha(pair[field].encode())), (field + '_utf8_bytes', len(pair[field].encode())))}
                assert text == prior['text_provenance']
                for key in ('gold', 'native_label', 'group_id'):
                    assert pair[key] == prior['pair'][key]
                rows.append(dict(model=model['id'], dataset=data['id'], row=dict(pair=prior['pair'], prediction=prediction, text_provenance=text)))
            actual = score(report['rows'])
            check_metrics(actual, report['overall'])
            run = dict(model=model['id'], dataset=data['id'], pairs=data['pairs'], pair_ids=list(checkpoint),
                       overall=report['overall'], intervals=report['intervals'], by_native_label=report['by_native_label'],
                       independent_metrics=actual, retrospective_recall_at_precision_95=recall95(report['rows']),
                       uncertain_negative_leading_labels=uncertain_negative_leaders(report['rows']), diagnostics=report['diagnostics'])
            runs.append(run)
            if data['id'] == 'findver':
                subset = [r for r in report['rows'] if r['pair']['id'] in strict]
                assert len(subset) == 23
                runs.append(dict(model=model['id'], dataset='findver-strict-subset', pairs=23, pair_ids=sorted(strict),
                                 derived_without_calls=True, independent_metrics=score(subset), retrospective_recall_at_precision_95=recall95(subset)))
            statuses.append(dict(model=model['id'], dataset=data['id'], observations=observed_statuses))
            hashes[f"{model['id']}/{data['id']}"] = dict(report=sha(Path(str(prefix) + '.json').read_bytes()), checkpoint=sha(checkpoint_bytes), metadata=sha(meta_bytes), http_status=sha(status_bytes))
    assert len(rows) == 4600
    summary = dict(schema_version=1, observations=4600, models=protocol['models'], runs=runs,
                   operations=[operation(m['id'], rows) for m in protocol['models']], quality_pooled_across_domains=False,
                   paired_comparisons=paired_comparisons(rows), paired_replicates=PAIRED_REPLICATES, paired_seed=PAIRED_SEED,
                   point_target_results=point_targets(runs), prior_models=9, comparison_models=14, targets=dict(precision=.95, recall=.9, clear_negative_coverage=.85))
    out.mkdir(parents=False, exist_ok=False)
    files = dict(protocol=protocol, summary=summary, **{'http-status': statuses, 'pricing-observation': dict(observed_date='2026-11-06', source='https://console.nace.ai/docs/drex/reference/pricing',
                                                                   input_usd_per_million=INPUT_USD_PER_MILLION, actual_invoice_available=False),
                 'integration-probes': probes,
                 'integration-probe-provenance': dict(operator_recorded=True, pinned_at='post-inference archive creation',
                                                     pre_inference_protocol_hash_binding=False,
                                                     original_artifact_sha256=sha(probe_path.read_bytes()) if probe_path else None),
                 'original-artifact-sha256': hashes,
                 'parent-archive': dict(path=str(BASE.relative_to(ROOT)), archive_sha256=sha((BASE / 'archive-sha256.json').read_bytes()),
                                        summary_sha256=sha((BASE / 'summary.json').read_bytes())),
                 'analysis-provenance': dict(created_at=datetime.now(timezone.utc).isoformat(), python=sys.version, stage='Post-inference analysis; no tuning',
                                            sources={str(Path(__file__).relative_to(ROOT)): sha(Path(__file__).read_bytes()),
                                                     'eval/results/business-2026-11-04/metrics.py': sha((ROOT / 'eval/results/business-2026-11-04/metrics.py').read_bytes()),
                                                     'scripts/analyze-eval-release.py': sha((ROOT / 'scripts/analyze-eval-release.py').read_bytes())})})
    for name, value in files.items():
        (out / f'{name}.json').write_bytes(pack(value))
    (out / 'observations.redacted.jsonl.gz').write_bytes(gzip.compress(('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n').encode(), mtime=0))
    (out / 'execution-sources.json.gz').write_bytes(gzip.compress(pack(snapshot), mtime=0))
    (out / 'README.md').write_text(render(summary, base_summary))
    (out / 'archive-sha256.json').write_bytes(pack({p.name: sha(p.read_bytes()) for p in sorted(out.iterdir())}))
    verify(out)


def render(summary, baseline):
    pct = lambda v: '—' if v is None else f'{v*100:.1f}'
    text = '''# Nace Drex: append-only benchmark comparison

Measured November 6, 2026. Five active Nace IDs, **4,600 observations**: the same 880 public pairs and 40 synthetic diagnostics per model as the [November 5 nine-model archive](../hosted-models-with-glide-2026-11-05/README.md). That archive remains unchanged. This is a later phase, specified after its results and the calibration study were available, not a contemporaneous 14-model experiment.

Fixed shipped `balanced-v1` prompt and thresholds, original presentation, isolated pairs, one pass, sequential calls, 3,000ms kernel deadline, no retries, fallback, truncation, prompt changes or threshold tuning. Pre-benchmark synthetic integration probes are separate from quality denominators; their count and sanitized receipts are recorded in `protocol.json` and `integration-probes.json`. These receipts are operator-recorded integration metadata, pinned at archive creation rather than hash-bound to the pre-inference protocol; benchmark HTTP statuses are independently instrumented during execution. Pacing between starts within each cohort is outside latency and deadlines; each cohort starts a new process, so no minimum interval is guaranteed across cohort boundaries. Explicit active IDs exclude aliases and retired forwards; returned identities must match. A checkpoint revision is unavailable.

Four public scorecards are reused development samples. FinDVer is previously scored and untuned; its historical `locked-test` manifest field is not a fresh holdout claim. Public training contamination remains possible. Native labels are not independent human adjudication of Countercheck's four-way contract. The initial prompt-ablation study was Jev-only; later Decider experiments do not make this vendor-optimized prompting. One pass does not establish repeatability or option-order robustness. Nace receives the shared kernel payload with only its model field replaced; the baseline retains its documented provider-specific encodings. Server-side rendering/tokenization may differ.

The [technical report](https://arxiv.org/abs/2611.07854) describes four released architectures; the API has five active serving IDs, including Max v1.1 and Finance. We test those hosted IDs, not the unserved DLM weights or the paper's exact checkpoints. Vendor-wide calibration and leaderboard claims are not our contradiction quality measurements. No model is promoted into the production catalog by this run. Nicia has no commercial relationship with any evaluated model provider.

__NACE_FINDINGS__

## Shipped-policy comparison

Each cell is **precision / recall / clear-negative coverage**, in percent. Errors and abstentions remain in recall and coverage denominators. Results are separated by domain; no pooled quality ranking. Higher coverage is an operating-point result, not necessarily an intrinsic model advantage; see the [separate calibration study](../calibration-followup-2026-11-06/README.md). Nace has not had the corresponding independently fitted validation study.

| Model | VitaminC | SciFact | ContractNLI | MultiNLI | FinDVer |
| --- | ---: | ---: | ---: | ---: | ---: |
'''
    for model in baseline['models'] + summary['models']:
        cells = []
        for dataset in ('vitaminc', 'scifact', 'contractnli', 'mnli', 'findver'):
            run = next(r for r in baseline['runs'] + summary['runs'] if r['model'] == model['id'] and r['dataset'] == dataset)
            m = run['independent_metrics'] if 'independent_metrics' in run else {k: run['overall'][k]['value'] for k in PCT_FIELDS}
            cells.append(' / '.join(pct(m[k]) for k in ('precision', 'recall', 'clear_negative_coverage')))
        text += f"| {model['name']} | " + ' | '.join(cells) + ' |\n'
    text += '\n## Nace ranking diagnostics\n\nAUROC/AP use observed successful distributions only; R@P≥95% uses the raw contradiction score and is a retrospective in-sample sensitivity ceiling, **not a validated threshold**. Missing distributions stay misses in recall. No cutoff from this table is selected for deployment.\n\n| Model | Dataset | F1 | AUROC | AP | Retrospective R@P≥95% | Probability rows / selected | False clears | Errors / excluded |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n'
    for run in summary['runs']:
        if run['dataset'].startswith('synthetic'):
            continue
        m = run['independent_metrics']
        fmt = lambda v: '—' if v is None else f'{v:.3f}'
        text += f"| {run['model']} | {run['dataset']} | {pct(m['f1'])} | {fmt(m['auroc'])} | {fmt(m['pr_auc_average_precision'])} | {pct(run['retrospective_recall_at_precision_95'])} | {m['probability_denominator']} / {m['binary_cases']} | {m['false_clears']} | {m['errors']} / {m['excluded']} |\n"
    text += '\n## Joint point targets\n\nAll three must hold on the same native-label scorecard: precision ≥95%, recall ≥90%, clear-negative coverage ≥85%. A point estimate is not a confidence-bound guarantee or human-adjudicated service-contract qualification.\n\n| Model | Public scorecards meeting all three point targets |\n| --- | --- |\n'
    for model in summary['models']:
        passed = [r['dataset'] for r in summary['point_target_results'] if r['model'] == model['id'] and r['all_point_targets_met']]
        text += f"| {model['name']} | " + (', '.join(passed) if passed else 'None') + ' |\n'
    text += '\n## Paired intervals against full Decider\n\nExploratory post-hoc comparisons, specified after early Nace results were visible. Every Nace model is compared with the same full Decider baseline on every public scorecard. Differences are Nace minus Decider, in percentage points, with percentile 95% intervals from 20,000 paired source-group resamples (seed 20261106). The interval matches the named metric. These are unadjusted for multiple comparisons; no population-equivalence claim follows from an interval containing zero. Dataset/group selection and small samples limit inference.\n\n| Nace model | Dataset | F1 difference [95% interval] | Recall difference [95% interval] | Clear-negative difference [95% interval] |\n| --- | --- | ---: | ---: | ---: |\n'
    for comparison in summary['paired_comparisons']:
        cells = []
        for metric in ('f1', 'recall', 'clear_negative_coverage'):
            m = comparison['metrics'][metric]
            interval = m['percentile_95']
            cells.append('—' if interval is None or m['difference'] is None else f"{100*m['difference']:+.1f} [{100*interval[0]:+.1f}, {100*interval[1]:+.1f}]")
        text += f"| {comparison['first']} | {comparison['dataset']} | " + ' | '.join(cells) + ' |\n'
    text += '\n## Uncertain native negatives\n\nCounts below distinguish low-confidence compatible judgments from an insufficient-context leading label. Native negatives are not automatically unknown. Exact ties are retained separately.\n\n| Model | Dataset | Consistent leads | Different scope leads | Insufficient context leads | Contradiction leads | Ties |\n| --- | --- | ---: | ---: | ---: | ---: | ---: |\n'
    for run in summary['runs']:
        if run['dataset'] not in PUBLIC_DATASETS:
            continue
        counts = run['uncertain_negative_leading_labels']
        text += f"| {run['model']} | {run['dataset']} | " + ' | '.join(str(counts.get(k, 0)) for k in ('consistent', 'different_scope', 'insufficient_context', 'contradiction', 'tie')) + ' |\n'
    text += '\n## Execution\n\nPublic 880-pair cohorts only. Successful-call latency excludes failures and pacing; it is not authenticated deployed API latency, a capacity comparison or an SLA. Client attempts are sequential and non-contemporaneous with the baseline; timed-out work may continue upstream. Timeout counts do not establish a change in vendor speed. Input-token arithmetic is a price estimate, not an invoice; tokens and accounting differ by provider. Failed-call usage remains unknown.\n\n| Model | Completed | Errors / excluded | p50 ms | p95 ms | Known input tokens | Estimated known-input USD |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n'
    for op in summary['operations']:
        price = INPUT_USD_PER_MILLION[op['model']]
        ms = lambda v: '—' if v is None else f'{v:.0f}'
        text += f"| {op['model']} | {op['completed']}/880 | {op['errors']} / {op['excluded']} | {ms(op['completed_p50_ms'])} | {ms(op['completed_p95_ms'])} | {op['known_input_tokens']} | {op['known_input_tokens'] * price / 1e6:.5f} |\n"
    text += '\n## Synthetic diagnostics\n\nReported separately; four uncertain fixtures are excluded from binary quality metrics.\n\n| Model | Smoke explicit expectations | Contract explicit expectations |\n| --- | ---: | ---: |\n'
    for model in summary['models']:
        cells = []
        for d in ('synthetic-smoke', 'synthetic-contract'):
            diagnostic = next(r['diagnostics'] for r in summary['runs'] if r['model'] == model['id'] and r['dataset'] == d)
            cells.append(f"{diagnostic['expected_verdict_correct']}/{diagnostic['expected_verdict_cases']}")
        text += f"| {model['name']} | " + ' | '.join(cells) + ' |\n'
    text += '''
## Scope and reproduction

ContractNLI uses gold rationale excerpts, not the official full-document task. FinDVer is the same length-conditioned 82-pair IE cohort; the strict 23-pair subset overlaps and is derived without extra calls. MultiNLI government/telephone/Slate is business-adjacent language, not a workplace dataset. The [original data provenance](../hosted-models-2026-11-05/data-provenance.json) retains source URLs, hashes and terms. No new labels or holdouts were opened. This isolated text-pair protocol does not measure image understanding, shared-state multi-question efficiency, or the paper's wider decision tasks.

`summary.json` preserves the TypeScript scorecards and source-group intervals beside independent Python recomputation, native-label slices and probability denominators. Interval and ranking fields do not establish significant cross-model wins; table differences are descriptive. `observations.redacted.jsonl.gz` replaces every claim and comparison text with hashes/byte counts and the original sanitized pair metadata. Finance source text and full reports remain in ignored local storage. `http-status.json` contains only per-run numeric status observations and ordinals, with null for no received response. Neither keys nor error bodies are archived. Execution sources are pinned before benchmark inference, analysis provenance after inference. The unused OpenRouter adapter's later metadata-stripping fix is disclosed in the protocol; the shared kernel/metrics/transport are byte-identical to November 5.

Verify all published metrics offline, with no provider credentials or network calls:

```sh
python3 scripts/compare-nace.py --verify eval/results/nace-2026-11-06
```

Re-running inference additionally needs the original local manifests and a private `NACE_API_KEY`:

```sh
pnpm exec node --env-file=.env --import tsx scripts/run-nace-benchmark.ts \\
  --live --baseline eval/results/hosted-models-2026-11-05 \\
  --out eval/reports/nace-FRESH --max-calls 4600 --prior-probes 0 \\
  --cost-per-call-usd 0.002 --max-spend-usd 10 --interval-ms 550
python3 scripts/compare-nace.py --input eval/reports/nace-FRESH --out eval/results/nace-FRESH
```

Call/spend figures are conservative operator reservations, not an upstream enforced spending limit or measured charge. The initial run used a 4,605-call reservation including its five separate probes. Consult the [live model catalog](https://console.nace.ai/docs/drex/reference/models), [pricing](https://console.nace.ai/docs/drex/reference/pricing) and [rate limits](https://console.nace.ai/docs/drex/reference/limits) before another run.
'''
    finance = next(r for r in summary['runs'] if r['model'] == 'drex-max-finance' and r['dataset'] == 'findver')['independent_metrics']
    passed = [f"{r['model']} / {r['dataset']}" for r in summary['point_target_results'] if r['all_point_targets_met']]
    target_finding = ('No Nace model/domain scorecard meets all three point targets.' if not passed else 'Joint point-target passes: ' + ', '.join(passed) + '.')
    uncertain = {r['dataset']: r['uncertain_negative_leading_labels'] for r in summary['runs'] if r['model'] == 'drex-max-v1.1' and r['dataset'] in PUBLIC_DATASETS}
    errors = sum(op['errors'] for op in summary['operations'])
    completed = sum(op['completed'] for op in summary['operations'])
    findings = f"""## Findings

- **{target_finding}** These remain native-label scorecards, not production qualification.
- **Max Finance on the 82 finance pairs:** {pct(finance['precision'])}% precision, {pct(finance['recall'])}% recall and {pct(finance['clear_negative_coverage'])}% clear-negative coverage; {finance['errors']} failures remain in denominators. This describes this cohort and deadline, not a finance-wide guarantee.
- **Cutoffs matter for negative clearance.** Max v1.1 has {uncertain['scifact'].get('consistent', 0)} uncertain SciFact negatives and {uncertain['contractnli'].get('consistent', 0)} uncertain ContractNLI negatives whose leading label is consistent. We have not fitted and independently validated model-specific Nace thresholds; the retrospective ranking view is not a replacement for that study.
- **Execution:** {completed}/4,400 public observations completed, with {errors} errors. The same deadline applies to all Nace rows; the separate status archive distinguishes HTTP responses from failures without one. Baseline comparisons are non-contemporaneous. See the paired intervals before interpreting table differences as wins.
"""
    return text.replace('__NACE_FINDINGS__', findings)


def verify(folder):
    for name, h in read(folder / 'archive-sha256.json').items():
        assert Path(name).name == name, 'Unsafe archive member'
        assert sha((folder / name).read_bytes()) == h, name
    protocol, summary = read(folder / 'protocol.json'), read(folder / 'summary.json')
    assert summary['models'] == protocol['models']
    assert summary['comparison_models'] == 14 and summary['prior_models'] == 9
    assert summary['targets'] == dict(precision=.95, recall=.9, clear_negative_coverage=.85)
    snapshot = unzip(folder / 'execution-sources.json.gz')
    assert set(snapshot) == set(protocol['sources'])
    for path, h in protocol['sources'].items():
        assert sha(snapshot[path].encode()) == h
    for path, h in read(folder / 'analysis-provenance.json')['sources'].items():
        assert sha((ROOT / path).read_bytes()) == h, path
    parent_receipt = read(folder / 'parent-archive.json')
    assert parent_receipt['path'] == str(BASE.relative_to(ROOT))
    assert parent_receipt['archive_sha256'] == sha((BASE / 'archive-sha256.json').read_bytes())
    assert parent_receipt['summary_sha256'] == sha((BASE / 'summary.json').read_bytes())
    for name, h in read(BASE / 'archive-sha256.json').items():
        assert sha((BASE / name).read_bytes()) == h
    original_protocol = read(ORIGINAL / 'protocol.json')
    assert protocol['inputs'] == original_protocol['inputs']
    assert protocol['baseline_protocol_sha256'] == sha((ORIGINAL / 'protocol.json').read_bytes())
    for path, h in original_protocol['sources'].items():
        if (path.startswith('src/') and path != 'src/providers/decider.ts') or path in ('eval/backends.ts', 'eval/metrics.ts', 'eval/types.ts', 'eval/protocol.ts', 'eval/checkpoint.ts'):
            assert protocol['sources'][path] == h, path
    assert protocol['profile'] == 'balanced-v1' and protocol['passes'] == 1 and protocol['timeout_ms'] == 3000
    assert protocol['retries'] == 0 and protocol['fallbacks'] is False and protocol['batch_size'] == 1
    assert protocol['presentation'] == 'original' and protocol['concurrency'] == 1 and protocol['interval_ms'] >= 110
    assert protocol['planned_calls'] == summary['observations'] == 4600
    assert {m['id'] for m in protocol['models']} == {'drex-v1.5', 'drex-v2.0', 'drex-max', 'drex-max-v1.1', 'drex-max-finance'}
    parent = {(r['dataset'], r['row']['pair']['id']): r['row'] for r in load_rows(BASE / 'observations.redacted.jsonl.gz') if r['model'] == 'jev-1.14.0'}
    rows = load_rows(folder / 'observations.redacted.jsonl.gz')
    assert len(rows) == 4600
    cohorts = collections.defaultdict(list)
    for r in rows:
        p, pred = r['row']['pair'], r['row']['prediction']
        prior = parent[r['dataset'], p['id']]
        assert r['row']['pair'] == prior['pair'] and r['row']['text_provenance'] == prior['text_provenance']
        assert pred['pair_id'] == p['id'] and pred['pass'] == 1
        if pred['status'] == 'ok':
            assert pred['model'] == pred['reported_model'] == r['model']
            assert pred['prompt_version'] == 'pair-relation-v1' and pred['threshold_version'] == 'evaluation-0.8-0.2-v1'
            raw = pred['raw_scores']
            assert set(raw) == {'contradiction', 'consistent', 'different_scope', 'insufficient_context'}
            assert all(math.isfinite(x) and 0 <= x <= 1 for x in raw.values()) and math.isclose(sum(raw.values()), 1, abs_tol=.001)
            close(pred['probabilities']['contradiction'], raw['contradiction'] / sum(raw.values()))
            expected = 'contradiction' if raw['contradiction'] >= .8 else 'no_contradiction' if raw['contradiction'] <= .2 and max(raw['consistent'], raw['different_scope']) >= .8 else 'uncertain'
            assert pred['verdict'] == expected
        else:
            assert pred['status'] in ('error', 'excluded') and not any(k in pred for k in ('verdict', 'probabilities', 'raw_scores'))
        cohorts[r['model'], r['dataset']].append(r['row'])
    assert len(cohorts) == 35
    for model in protocol['models']:
        for data in protocol['inputs']:
            cohort = cohorts[model['id'], data['id']]
            assert len(cohort) == len({r['pair']['id'] for r in cohort}) == data['pairs']
            assert {r['pair']['id'] for r in cohort} == {pair_id for dataset, pair_id in parent if dataset == data['id']}
    assert len(summary['runs']) == 40
    strict = set(next(r['pair_ids'] for r in read(BASE / 'summary.json')['runs'] if r['model'] == 'jev-1.14.0' and r['dataset'] == 'findver-strict-subset'))
    for run in summary['runs']:
        derived = run['dataset'] == 'findver-strict-subset'
        cohort = cohorts[run['model'], 'findver' if derived else run['dataset']]
        if derived:
            assert set(run['pair_ids']) == strict and run['pairs'] == 23
            cohort = [r for r in cohort if r['pair']['id'] in strict]
        actual = score(cohort)
        assert set(actual) == set(run['independent_metrics'])
        for key, value in actual.items():
            recorded = run['independent_metrics'][key]
            if isinstance(value, float) or value is None:
                close(value, recorded)
            else:
                assert value == recorded, (run['model'], run['dataset'], key)
        if 'overall' in run:
            check_metrics(actual, run['overall'])
            assert uncertain_negative_leaders(cohort) == run['uncertain_negative_leading_labels']
            assert diagnostics(cohort) == run['diagnostics']
        close(recall95(cohort), run['retrospective_recall_at_precision_95'])
    assert summary['point_target_results'] == point_targets(summary['runs'])
    assert summary['paired_replicates'] == PAIRED_REPLICATES and summary['paired_seed'] == PAIRED_SEED
    assert summary['paired_comparisons'] == paired_comparisons(rows)
    assert summary['operations'] == [operation(m['id'], rows) for m in protocol['models']]
    assert read(folder / 'pricing-observation.json')['input_usd_per_million'] == INPUT_USD_PER_MILLION
    probe_provenance = read(folder / 'integration-probe-provenance.json')
    assert probe_provenance['operator_recorded'] is True and probe_provenance['pre_inference_protocol_hash_binding'] is False
    probes = read(folder / 'integration-probes.json')
    assert len(probes) == protocol['prior_integration_probes']
    for p in probes:
        assert set(p) == {'model', 'status', 'reported_model', 'input_tokens', 'http_status', 'latency_ms'}
        assert p['model'] in {m['id'] for m in protocol['models']}
        assert p['status'] == 'ok' and p['reported_model'] == p['model'] and p['http_status'] == [200]
    statuses = read(folder / 'http-status.json')
    assert len(statuses) == 35
    for s in statuses:
        cohort = cohorts[s['model'], s['dataset']]
        observations = s['observations']
        assert len(observations) == sum(r['prediction']['status'] != 'excluded' for r in cohort)
        for i, obs in enumerate(observations):
            assert set(obs) == {'sequence', 'status'} and obs['sequence'] == i + 1
            assert obs['status'] is None or type(obs['status']) is int and 100 <= obs['status'] <= 599
    baseline_summary = read(BASE / 'summary.json')
    rendered = render(summary, baseline_summary)
    assert (folder / 'README.md').read_text() == rendered
    main_table = rendered.split('## Shipped-policy comparison', 1)[1].split('## Nace ranking diagnostics', 1)[0]
    table_labels = [line.split('|')[1].strip() for line in main_table.splitlines() if line.startswith('|')]
    assert table_labels[2:] == [m['name'] for m in baseline_summary['models'] + summary['models']]
    print(json.dumps(dict(archive=str(folder), verified_observations=len(rows), models=5, comparison_models=14, network_calls=0)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--verify', type=Path)
    parser.add_argument('--probes', type=Path, help='Private probe receipts when protocol prior-probe count is nonzero')
    args = parser.parse_args()
    if args.verify and not args.input and not args.out:
        verify(args.verify)
    elif args.input and args.out and not args.verify:
        archive(args.input, args.out, args.probes)
    else:
        parser.error('Use --verify ARCHIVE or --input RUN --out NEW_ARCHIVE')
