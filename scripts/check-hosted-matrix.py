#!/usr/bin/env python3
"""Independently verify the redacted hosted-model comparison. Offline; no inference."""
import gzip
import hashlib
import json
import math
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parents[1]
archive = Path(sys.argv[1])
for name, digest in json.loads((archive / 'archive-sha256.json').read_text()).items():
    assert hashlib.sha256((archive / name).read_bytes()).hexdigest() == digest, name
protocol = json.loads((archive / 'protocol.json').read_text())
summary = json.loads((archive / 'summary.json').read_text())
receipt = json.loads((archive / 'analysis-provenance.json').read_text())
analysis_sources = json.loads(gzip.decompress((archive / 'analysis-sources.json.gz').read_bytes()))
execution_sources = json.loads(gzip.decompress((archive / 'execution-sources.json.gz').read_bytes()))
assert set(execution_sources) == set(protocol['sources'])
for name, source in execution_sources.items():
    assert hashlib.sha256(source.encode()).hexdigest() == protocol['sources'][name]
for name, source in analysis_sources.items():
    digest = hashlib.sha256(source.encode()).hexdigest()
    assert digest == receipt['source_hashes'][name]
    assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest
HELPERS = runpy.run_path(str(ROOT / 'eval/results/business-2026-11-04/metrics.py'), run_name='independent_matrix_metrics')
metrics, close = HELPERS['metrics'], HELPERS['close']
rows = [json.loads(line) for line in gzip.decompress((archive / 'observations.redacted.jsonl.gz').read_bytes()).splitlines()]
assert len(rows) == summary['observations'] == protocol['planned_calls'] == 7360
models = {model['id'] for model in protocol['models']}
assert len(models) == 8 and {row['model'] for row in rows} == models
cohorts = {}
for row in rows:
    key = row['model'], row['dataset']
    cohorts.setdefault(key, []).append(row['row'])
    pair, prediction = row['row']['pair'], row['row']['prediction']
    assert pair['claim'] == pair['evidence'] == '[not archived: input text hashes below]'
    assert len(row['row']['text_provenance']['claim_sha256']) == len(row['row']['text_provenance']['evidence_sha256']) == 64
    assert prediction['pair_id'] == pair['id'] and prediction['pass'] == 1
    assert prediction['status'] in ('ok', 'error', 'excluded')
    if prediction['status'] == 'ok':
        assert prediction['model'] == row['model']
        assert prediction['prompt_version'] == 'pair-relation-v1'
        assert prediction['threshold_version'] == 'evaluation-0.8-0.2-v1'
        raw = prediction['raw_scores']
        assert set(raw) == {'contradiction', 'consistent', 'different_scope', 'insufficient_context'}
        assert all(math.isfinite(v) and 0 <= v <= 1 for v in raw.values())
        assert math.isclose(sum(raw.values()), 1, abs_tol=.001)
        projected = prediction['probabilities']
        close(projected['contradiction'], raw['contradiction'] / sum(raw.values()))
        expected = 'contradiction' if raw['contradiction'] >= .8 else 'no_contradiction' if raw['contradiction'] <= .2 and max(raw['consistent'], raw['different_scope']) >= .8 else 'uncertain'
        assert prediction['verdict'] == expected
    else:
        assert not any(field in prediction for field in ('verdict', 'probabilities', 'raw_scores'))
assert len(cohorts) == 56
for dataset in protocol['inputs']:
    versions = []
    for model in models:
        cohort = cohorts[model, dataset['id']]
        assert len(cohort) == len({row['pair']['id'] for row in cohort}) == dataset['pairs']
        versions.append({row['pair']['id']: (row['pair']['gold'], row['pair']['native_label'], row['pair']['group_id'], row['text_provenance']['claim_sha256'], row['text_provenance']['evidence_sha256']) for row in cohort})
    assert all(version == versions[0] for version in versions)

verified = 0
for run in summary['runs']:
    derived = run['dataset'] == 'findver-strict-subset'
    cohort = cohorts[run['model'], 'findver' if derived else run['dataset']]
    if derived:
        subset = set(run['pair_ids'])
        assert len(subset) == 23
        cohort = [row for row in cohort if row['pair']['id'] in subset]
    assert {row['pair']['id'] for row in cohort} == set(run['pair_ids'])
    pairs = [row['pair'] for row in cohort]
    verdicts = {row['pair']['id']: row['prediction'].get('verdict', row['prediction']['status']) for row in cohort}
    scores = {row['pair']['id']: row['prediction']['probabilities']['contradiction'] for row in cohort if row['prediction']['status'] == 'ok'}
    actual = metrics(pairs, verdicts, scores)
    recorded = run['overall']
    for key, field in [('tp', 'true_positive'), ('fp', 'false_positive'), ('tn', 'true_negative'), ('false_clears', 'definitive_false_negative')]:
        assert actual[key] == recorded['confusion'][field], (run['model'], run['dataset'], key)
    for key in ('precision', 'recall', 'clear_negative_coverage', 'coverage', 'false_positive_rate', 'completion'):
        close(actual[key], recorded[key]['value'])
    for key in ('auroc', 'pr_auc_average_precision', 'brier', 'f1'):
        close(actual[key], recorded[key])
    for key in ('errors', 'excluded', 'probability_denominator'):
        assert actual[key] == recorded[key]
    assert actual['binary_cases'] == recorded['denominator']
    assert actual['positive'] == recorded['positive'] and actual['negative'] == recorded['negative']
    verified += 1
for target in summary['target_results']:
    run = next(run for run in summary['runs'] if run['model'] == target['model'] and run['dataset'] == target['dataset'])
    m = run['overall']
    assert target['all_point_targets_met'] == ((m['precision']['value'] or 0) >= .95 and (m['recall']['value'] or 0) >= .90 and (m['clear_negative_coverage']['value'] or 0) >= .85)
for op in summary['operations']:
    cohort = [row for (model, dataset), values in cohorts.items() if model == op['model'] and not dataset.startswith('synthetic-') for row in values]
    assert len(cohort) == op['selected'] == 880
    ok = [row for row in cohort if row['prediction']['status'] == 'ok']
    assert len(ok) == op['completed']
    assert sum(row['prediction']['status'] == 'error' for row in cohort) == op['errors']
    assert sum(row['prediction']['status'] == 'excluded' for row in cohort) == op['excluded']
    attempts = [row for row in cohort if row['prediction']['status'] != 'excluded']
    assert len(attempts) == op['attempted']
    known = [row['prediction']['input_tokens'] for row in attempts if row['prediction'].get('input_tokens') is not None]
    assert len(known) == op['known_input_observations']
    assert sum(known) == op['known_input_tokens'] and len(attempts) - len(known) == op['unknown_input_observations']
    times = sorted(row['prediction']['latency_ms'] for row in ok)
    for q, name in [(.5, 'p50'), (.95, 'p95'), (.99, 'p99')]:
        close(times[math.floor((len(times)-1)*q)] if times else None, op[f'completed_{name}_ms'])
print(json.dumps({'verified_runs': verified, 'verified_observations': len(rows), 'models': len(models), 'identical_inputs_across_models': True, 'finance_text_archived': False, 'network_calls': 0}))
