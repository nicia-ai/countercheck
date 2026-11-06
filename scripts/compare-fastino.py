#!/usr/bin/env python3
"""Archive the appended Fastino phase and independently verify the nine-model comparison."""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import runpy
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--baseline', required=True)
parser.add_argument('--in', dest='input', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--executed-sources', help='Verified frozen execution snapshot, for reproduction after source code changes')
a = parser.parse_args()
base, source, out = Path(a.baseline), Path(a.input), Path(a.out)
subprocess.run([sys.executable, '-B', str(ROOT / 'scripts/check-hosted-matrix.py'), str(base)], check=True)
H = runpy.run_path(str(ROOT / 'eval/results/business-2026-11-04/metrics.py'), run_name='independent_glide_metrics')
metrics, close = H['metrics'], H['close']
sha = lambda data: hashlib.sha256(data).hexdigest()
read = lambda path: json.loads(path.read_bytes())
protocol = read(source / 'protocol.json')
progress = read(source / 'progress.json')
assert progress['status'] == 'complete' and len(progress['completed']) == 7
assert protocol['planned_calls'] == 920
executed_sources = json.loads(gzip.decompress(Path(a.executed_sources).read_bytes())) if a.executed_sources else {path: (ROOT / path).read_text() for path in protocol['sources']}
assert set(executed_sources) == set(protocol['sources'])
for path, digest in protocol['sources'].items():
    assert sha(executed_sources[path].encode()) == digest, path
baseline_protocol = read(base / 'protocol.json')
assert sha((base / 'protocol.json').read_bytes()) == protocol['baseline_protocol_sha256']
assert protocol['inputs'] == baseline_protocol['inputs']
for path in baseline_protocol['sources']:
    if path.startswith('src/') or path in ('eval/backends.ts', 'eval/metrics.ts', 'eval/types.ts', 'eval/protocol.ts', 'eval/checkpoint.ts'):
        assert protocol['sources'][path] == baseline_protocol['sources'][path], path
baseline = read(base / 'summary.json')
base_rows = [json.loads(line) for line in gzip.decompress((base / 'observations.redacted.jsonl.gz').read_bytes()).splitlines()]
comparison_inputs = {(row['dataset'], row['row']['pair']['id']): row['row'] for row in base_rows if row['model'] == 'jev-1.14.0'}
model = protocol['models'][0]
new_runs, new_rows, operations_rows = [], [], []
original_hashes = {}

def verify(rows, recorded):
    pairs = [row['pair'] for row in rows]
    verdicts = {row['pair']['id']: row['prediction'].get('verdict', row['prediction']['status']) for row in rows}
    scores = {row['pair']['id']: row['prediction']['probabilities']['contradiction'] for row in rows if row['prediction']['status'] == 'ok'}
    actual = metrics(pairs, verdicts, scores)
    for name, field in [('tp', 'true_positive'), ('fp', 'false_positive'), ('tn', 'true_negative'), ('false_clears', 'definitive_false_negative')]:
        assert actual[name] == recorded['confusion'][field]
    for name in ('precision', 'recall', 'clear_negative_coverage', 'coverage', 'false_positive_rate', 'completion'):
        close(actual[name], recorded[name]['value'])
    for name in ('f1', 'auroc', 'pr_auc_average_precision', 'brier'):
        close(actual[name], recorded[name])
    for name in ('errors', 'excluded', 'probability_denominator'):
        assert actual[name] == recorded[name]
    assert actual['binary_cases'] == recorded['denominator']
    return actual

for dataset in protocol['inputs']:
    prefix = source / f"fastino--GLiDE.{dataset['id']}"
    report = read(Path(str(prefix) + '.json'))
    assert report['manifest_sha256'] == dataset['sha256']
    manifest = read(ROOT / dataset['path'])
    assert sha((ROOT / dataset['path']).read_bytes()) == dataset['sha256']
    originals = {pair['id']: pair for pair in manifest['pairs']}
    rows = report['rows']
    assert len(rows) == len({row['pair']['id'] for row in rows}) == dataset['pairs']
    saved = Path(str(prefix) + '.predictions.jsonl').read_bytes()
    meta = Path(str(prefix) + '.predictions.jsonl.metadata.json').read_bytes()
    assert sha(saved) == report['prediction_artifact']['sha256']
    assert sha(meta) == report['prediction_artifact']['metadata_sha256']
    checkpoint = {p['pair_id']: p for p in map(json.loads, saved.splitlines())}
    assert len(checkpoint) == len(rows)
    original_hashes[dataset['id']] = {'report_sha256': sha(Path(str(prefix) + '.json').read_bytes()), 'checkpoint_sha256': sha(saved), 'metadata_sha256': sha(meta)}
    for row in rows:
        pair, prediction = row['pair'], row['prediction']
        assert pair == originals[pair['id']]
        assert prediction == checkpoint[pair['id']]
        assert prediction['pass'] == 1 and prediction['pair_id'] == pair['id']
        if prediction['status'] == 'ok':
            assert prediction['model'] == model['id'] and prediction['reported_model'] in ('glide', 'glide_v2')
            raw = prediction['raw_scores']
            assert set(raw) == {'contradiction', 'consistent', 'different_scope', 'insufficient_context'}
            assert all(math.isfinite(v) and 0 <= v <= 1 for v in raw.values()) and math.isclose(sum(raw.values()), 1, abs_tol=.001)
            close(prediction['probabilities']['contradiction'], raw['contradiction'] / sum(raw.values()))
            expected = 'contradiction' if raw['contradiction'] >= .8 else 'no_contradiction' if raw['contradiction'] <= .2 and max(raw['consistent'], raw['different_scope']) >= .8 else 'uncertain'
            assert prediction['verdict'] == expected
        else:
            assert prediction['status'] in ('error', 'excluded') and not any(k in prediction for k in ('verdict', 'probabilities', 'raw_scores'))
        text = {'claim_sha256': sha(pair['claim'].encode()), 'claim_utf8_bytes': len(pair['claim'].encode()), 'evidence_sha256': sha(pair['evidence'].encode()), 'evidence_utf8_bytes': len(pair['evidence'].encode())}
        prior = comparison_inputs[dataset['id'], pair['id']]
        assert text == prior['text_provenance']
        for key in ('gold', 'native_label', 'group_id'):
            assert pair[key] == prior['pair'][key]
        new_rows.append({'model': model['id'], 'dataset': dataset['id'], 'row': {'pair': prior['pair'], 'prediction': prediction, 'text_provenance': text}})
    actual = verify(rows, report['overall'])
    run = {key: report[key] for key in ('overall', 'intervals', 'by_dataset', 'by_native_label', 'by_pass', 'diagnostics')}
    run.update(model=model['id'], name=model['name'], dataset=dataset['id'], pairs=len(rows), pair_ids=[row['pair']['id'] for row in rows], manifest_sha256=dataset['sha256'], measurement='synthetic_contract_diagnostic' if dataset['purpose'] == 'synthetic-smoke' else 'public_native_label_adaptation', reported_models=sorted({row['prediction'].get('reported_model') for row in rows if row['prediction']['status'] == 'ok'}), independent_metrics=actual)
    new_runs.append(run)
    if dataset['purpose'] != 'synthetic-smoke':
        operations_rows.extend(rows)
    if dataset['id'] == 'findver':
        strict_ids = set(next(run['pair_ids'] for run in baseline['runs'] if run['model'] == 'jev-1.14.0' and run['dataset'] == 'findver-strict-subset'))
        subset = [row for row in rows if row['pair']['id'] in strict_ids]
        subset_actual = metrics([r['pair'] for r in subset], {r['pair']['id']: r['prediction'].get('verdict', r['prediction']['status']) for r in subset}, {r['pair']['id']: r['prediction']['probabilities']['contradiction'] for r in subset if r['prediction']['status'] == 'ok'})
        new_runs.append({'model': model['id'], 'name': model['name'], 'dataset': 'findver-strict-subset', 'pairs': 23, 'derived_without_calls': True, 'pair_ids': sorted(strict_ids), 'independent_metrics': subset_actual})
assert len(new_rows) == 920
assert len(operations_rows) == 880
ok = [row for row in operations_rows if row['prediction']['status'] == 'ok']
attempts = [row for row in operations_rows if row['prediction']['status'] != 'excluded']
times = sorted(row['prediction']['latency_ms'] for row in ok)
known = [row['prediction']['input_tokens'] for row in attempts if row['prediction'].get('input_tokens') is not None]
operation = {'model': model['id'], 'name': model['name'], 'selected': 880, 'attempted': len(attempts), 'completed': len(ok), 'errors': sum(row['prediction']['status'] == 'error' for row in operations_rows), 'excluded': sum(row['prediction']['status'] == 'excluded' for row in operations_rows), 'known_input_tokens': sum(known), 'known_input_observations': len(known), 'unknown_input_observations': len(attempts) - len(known), 'actual_cost_usd': None}
for q, name in [(.5, 'p50'), (.95, 'p95'), (.99, 'p99')]:
    operation[f'completed_{name}_ms'] = times[math.floor((len(times)-1)*q)] if times else None
combined = {'schema_version': 1, 'observations': 8280, 'models': baseline_protocol['models'] + protocol['models'], 'runs': baseline['runs'] + new_runs, 'operations': baseline['operations'] + [operation], 'targets': baseline['targets'], 'smaller_fastino_sizes': 'Pending, as requested; unavailable through the observed hosted API catalog.', 'quality_pooled_across_domains': False, 'prior_fastino_integration_probes_not_in_quality_denominators': 3}
out.mkdir(parents=False, exist_ok=False)
write = lambda name, value: (out / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
write('summary.json', combined)
write('fastino-protocol.json', protocol)
write('original-fastino-artifact-sha256.json', original_hashes)
write('parent-archive.json', {'path': str(base), 'archive_sha256': sha((base / 'archive-sha256.json').read_bytes()), 'summary_sha256': sha((base / 'summary.json').read_bytes())})
(out / 'observations.redacted.jsonl.gz').write_bytes(gzip.compress(('\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in base_rows + new_rows) + '\n').encode(), mtime=0))
source_files = executed_sources
(out / 'fastino-execution-sources.json.gz').write_bytes(gzip.compress(json.dumps(source_files, ensure_ascii=False).encode(), mtime=0))
write('analysis-provenance.json', {'recorded_at': datetime.now(timezone.utc).isoformat(), 'phase': 'Post-inference analysis; inference source unchanged and verified against the pre-run protocol', 'source_files': {str(Path(__file__).relative_to(ROOT)): sha(Path(__file__).read_bytes()), 'eval/results/business-2026-11-04/metrics.py': sha((ROOT / 'eval/results/business-2026-11-04/metrics.py').read_bytes())}})
pct = lambda v: '—' if v is None else f'{100*v:.1f}'
models = combined['models']
run_for = lambda model_id, dataset: next(run for run in combined['runs'] if run['model'] == model_id and run['dataset'] == dataset)
text = '''# Nine-model contradiction benchmark comparison

Measured November 5, 2026. Eight exposed Countercheck models plus the **evaluation-only hosted Fastino GLiDE 27B**. The 0.4B, 0.8B, 2B and 9B releases remain pending, as requested; no scores are fabricated for unserved models.

**8,280 scored observations:** 880 frozen public pairs and 40 synthetic cases per model. Fixed shipped `balanced-v1` policy, original presentation, single pairs, one pass, sequential calls, 3,000ms kernel deadline, no retries, fallback, truncation, prompt fitting or threshold tuning. The original 23-pair finance scorecard is a derived subset of 82, with no extra calls. Three Fastino integration probes are recorded separately and excluded from quality denominators. The first phase and Fastino phase have separate pre-inference protocols; shared kernel, compiler, metrics and input bytes are verified unchanged.

This compares current shipped-policy behavior, not optimally calibrated or prompted performance for every model. Native public labels are not independently adjudicated service-contract labels. Error and uncertainty remain misses in recall and coverage; unavailable distributions are excluded only from probability metrics.

## F1 by domain

F1 is calculated with positive uncertainty, errors and exclusions retained as missed contradictions. Values are percentages; quality is not pooled across domains.

| Model | Wikipedia200 | Science199 | Contracts199 | Business-adjacent200 | Finance82 |
| --- | ---: | ---: | ---: | ---: | ---: |
'''
for m in models:
    text += '| ' + m['name'] + ' | ' + ' | '.join(pct(run_for(m['id'], ds)['overall']['f1']) for ds in ('vitaminc', 'scifact', 'contractnli', 'mnli', 'findver')) + ' |\n'
text += '\n## Business precision / recall / clear-negative coverage\n\nEach cell is **P / R / N**, in percent. Proposed point targets are 95 / 90 / 85 on the same scorecard.\n\n| Model | Contracts | Business-adjacent | Finance |\n| --- | ---: | ---: | ---: |\n'
for m in models:
    values = []
    for ds in ('contractnli', 'mnli', 'findver'):
        stat = run_for(m['id'], ds)['overall']
        values.append(' / '.join(pct(stat[key]['value']) for key in ('precision', 'recall', 'clear_negative_coverage')))
    text += '| ' + m['name'] + ' | ' + ' | '.join(values) + ' |\n'
text += '\n## Execution on 880 public pairs per model\n\nProvider/kernel latency includes the route used in this run, **not authenticated deployed API latency or capacity**. Cloudflare models use the native binding through Wrangler’s remote proxy; other providers use direct native HTTPS. Successful-call percentiles exclude errors, which remain in the completed counts. Model order was fixed, so changing network/provider load can affect timing.\n\n| Model | Completed | Errors / excluded | p50ms | p95ms | p99ms |\n| --- | ---: | ---: | ---: | ---: | ---: |\n'
for op in combined['operations']:
    ms = lambda key: 'n/a' if op[key] is None else f"{op[key]:.0f}"
    text += f"| {op['name']} | {op['completed']}/880 | {op['errors']} / {op['excluded']} | {ms('completed_p50_ms')} | {ms('completed_p95_ms')} | {ms('completed_p99_ms')} |\n"
text += '\n## Joint quality targets\n\nPassing a native-label scorecard requires precision≥95%, recall≥90%, and clear-negative coverage≥85% together; this is not a production qualification or confidence-bound guarantee.\n\n| Model | Primary scorecards meeting all three |\n| --- | --- |\n'
for m in models:
    passed = []
    for ds in ('vitaminc', 'scifact', 'contractnli', 'mnli', 'findver'):
        stat = run_for(m['id'], ds)['overall']
        if (stat['precision']['value'] or 0) >= .95 and (stat['recall']['value'] or 0) >= .90 and (stat['clear_negative_coverage']['value'] or 0) >= .85:
            passed.append(ds)
    text += f"| {m['name']} | {', '.join(passed) or 'None'} |\n"
text += '''
## Evidence and limits

The [original eight-model report](../hosted-models-2026-11-05/README.md) retains per-domain precision, recall, uncertainty, false clears, calibration, AUROC, source-group intervals and original source/license provenance. `summary.json` combines that unchanged summary with the independently verified Fastino reports, including its native-label slices and intervals. `observations.redacted.jsonl.gz` contains all 9 models’ scoring metadata/predictions with every claim/evidence text removed and replaced by original text hashes and byte counts. Finance issuer-report text stays in ignored local storage.

Fastino is requested as `fastino/GLiDE`. The live catalog describes GLiDE v2.3 served in NVFP4 on a B200; successful inference reports `glide_v2`, which is preserved. No immutable checkpoint revision is supplied. Requests use `store:false` and `thinking:false`; the integration check observed `X-Fastino-Data-Retention: not-stored`. Fastino was added to evaluations only; the API/dashboard catalog and default are unchanged.

The public suite consists of Wikipedia-derived VitaminC, SciFact gold rationale sets, ContractNLI complete annotated excerpts, MultiNLI government/telephone/Slate, and supported FinDVer testmini IE contexts. These are adaptations, not official retrieval/full-document leaderboard scores or representative customer traffic. The finance cohort fits only 82/250 IE inputs under 2 KiB without truncation. Full-contract labels transferred to excerpts can lack definitions or exceptions. MultiNLI is business-adjacent, not a workplace-native corpus. One fixed pass does not establish repeat stability or an SLA. Actual billed cost remains unknown; per-provider reported input usage is retained in the summaries.

[Fastino release](https://fastino.ai/blog/glide-decision-model-family), [Fastino API documentation](https://docs.fastino.ai/inference/systemone), and [hosted model catalog](https://api.fastino.ai/v1/base-models?supports_inference=true&task_type=systemone). The release provides open weights at 0.4B/0.8B/2B/9B/27B; the observed API catalog serves only the hosted GLiDE route. The smaller four remain explicitly unrun.

Rebuild and independently verify this extension, without model calls:

```sh
python3 -B scripts/compare-fastino.py --baseline eval/results/hosted-models-2026-11-05 \\
  --in eval/reports/fastino-glide-2026-11-05 \\
  --executed-sources eval/results/hosted-models-with-glide-2026-11-05/fastino-execution-sources.json.gz \\
  --out eval/results/hosted-models-with-glide-new
```

Exact inference reconstruction additionally requires the ignored original input manifests and provider configuration. The protocol and source snapshots pin the actually executed code; this post-inference analysis implementation does not claim a pre-inference analysis freeze.
'''
(out / 'README.md').write_text(text)
# Format before hashing; never silently alter archived measured JSON/checkpoints.
subprocess.run(['pnpm', 'exec', 'prettier', '--write', str(out / 'README.md')], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
write('archive-sha256.json', {path.name: sha(path.read_bytes()) for path in sorted(out.iterdir()) if path.is_file()})
for name, digest in read(out / 'archive-sha256.json').items():
    assert sha((out / name).read_bytes()) == digest
assert len(base_rows + new_rows) == 8280
print(json.dumps({'archive': str(out), 'models': len(models), 'verified_scored_observations': 8280, 'identical_inputs_across_all_models': True, 'new_fastino_scorecards': len(new_runs), 'network_calls': 0}))
