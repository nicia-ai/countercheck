#!/usr/bin/env python3
"""Verify a published nine-model evaluation using committed artifacts only.

Python standard library only. No network, inference, credentials, or original dataset text.
"""
import argparse
from collections import defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / 'eval/results/hosted-models-with-glide-2026-11-05'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def verify_archive(path):
    inventory = read(path / 'archive-sha256.json')
    for name, expected in inventory.items():
        if Path(name).name != name:
            raise ValueError('Archive filenames must stay within the archive directory')
        assert digest((path / name).read_bytes()) == expected, name
    return inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, default=DEFAULT)
    args = parser.parse_args()
    archive = args.archive.resolve()
    verify_archive(archive)
    parent_receipt = read(archive / 'parent-archive.json')
    parent = (ROOT / parent_receipt['path']).resolve()
    if not parent.is_relative_to(ROOT):
        raise ValueError('Parent archive must be inside this checkout')
    assert digest((parent / 'archive-sha256.json').read_bytes()) == parent_receipt['archive_sha256']
    assert digest((parent / 'summary.json').read_bytes()) == parent_receipt['summary_sha256']
    verify_archive(parent)
    baseline_protocol = read(parent / 'protocol.json')
    fastino_protocol = read(archive / 'fastino-protocol.json')
    assert baseline_protocol['inputs'] == fastino_protocol['inputs']
    assert digest((parent / 'protocol.json').read_bytes()) == fastino_protocol['baseline_protocol_sha256']
    for folder, snapshot, expected in [
        (parent, 'execution-sources.json.gz', baseline_protocol['sources']),
        (archive, 'fastino-execution-sources.json.gz', fastino_protocol['sources']),
    ]:
        sources = json.loads(gzip.decompress((folder / snapshot).read_bytes()))
        assert set(sources) == set(expected)
        assert all(digest(source.encode()) == expected[path] for path, source in sources.items())
    helper = 'eval/results/business-2026-11-04/metrics.py'
    receipt = read(archive / 'analysis-provenance.json')
    assert digest((ROOT / helper).read_bytes()) == receipt['source_files'][helper]
    helpers = runpy.run_path(str(ROOT / helper), run_name='published_eval_metrics')
    metrics, close = helpers['metrics'], helpers['close']
    summary = read(archive / 'summary.json')
    baseline = read(parent / 'summary.json')
    assert summary['runs'][:len(baseline['runs'])] == baseline['runs']
    assert summary['operations'][:len(baseline['operations'])] == baseline['operations']
    rows = [json.loads(line) for line in gzip.decompress((archive / 'observations.redacted.jsonl.gz').read_bytes()).splitlines()]
    prior_rows = [json.loads(line) for line in gzip.decompress((parent / 'observations.redacted.jsonl.gz').read_bytes()).splitlines()]
    assert rows[:len(prior_rows)] == prior_rows
    assert len(rows) == summary['observations'] == 8280
    models = {model['id'] for model in summary['models']}
    assert len(models) == 9
    cohorts = defaultdict(list)
    for observation in rows:
        assert observation['model'] in models
        row = observation['row']
        pair, prediction = row['pair'], row['prediction']
        assert pair['claim'] == pair['evidence'] == '[not archived: input text hashes below]'
        assert prediction['pair_id'] == pair['id'] and prediction['pass'] == 1
        assert all(len(row['text_provenance'][key]) == 64 for key in ('claim_sha256', 'evidence_sha256'))
        if prediction['status'] == 'ok':
            assert prediction['model'] == observation['model']
            raw = prediction['raw_scores']
            assert set(raw) == {'contradiction', 'consistent', 'different_scope', 'insufficient_context'}
            assert all(math.isfinite(value) and 0 <= value <= 1 for value in raw.values())
            assert math.isclose(sum(raw.values()), 1, abs_tol=.001)
            close(prediction['probabilities']['contradiction'], raw['contradiction'] / sum(raw.values()))
            close(prediction['probabilities']['no_contradiction'], (raw['consistent'] + raw['different_scope']) / sum(raw.values()))
            close(prediction['probabilities']['insufficient_context'], raw['insufficient_context'] / sum(raw.values()))
            expected = 'contradiction' if raw['contradiction'] >= .8 else 'no_contradiction' if raw['contradiction'] <= .2 and max(raw['consistent'], raw['different_scope']) >= .8 else 'uncertain'
            assert prediction['verdict'] == expected
        else:
            assert prediction['status'] in ('error', 'excluded')
            assert not any(key in prediction for key in ('verdict', 'probabilities', 'raw_scores'))
        cohorts[observation['model'], observation['dataset']].append(row)
    assert len(cohorts) == 63
    for dataset in baseline_protocol['inputs']:
        signatures = []
        for model in models:
            cohort = cohorts[model, dataset['id']]
            assert len(cohort) == len({row['pair']['id'] for row in cohort}) == dataset['pairs']
            signatures.append({row['pair']['id']: (row['pair']['gold'], row['pair']['native_label'], row['pair']['group_id'], row['text_provenance']['claim_sha256'], row['text_provenance']['evidence_sha256']) for row in cohort})
        assert all(signature == signatures[0] for signature in signatures)
    for run in summary['runs']:
        subset = run['dataset'] == 'findver-strict-subset'
        cohort = cohorts[run['model'], 'findver' if subset else run['dataset']]
        if subset:
            ids = set(run['pair_ids'])
            assert len(ids) == 23
            cohort = [row for row in cohort if row['pair']['id'] in ids]
        assert {row['pair']['id'] for row in cohort} == set(run['pair_ids'])
        pairs = [row['pair'] for row in cohort]
        verdicts = {row['pair']['id']: row['prediction'].get('verdict', row['prediction']['status']) for row in cohort}
        scores = {row['pair']['id']: row['prediction']['probabilities']['contradiction'] for row in cohort if row['prediction']['status'] == 'ok'}
        actual = metrics(pairs, verdicts, scores)
        if 'overall' not in run:
            assert actual == run['independent_metrics']
            continue
        recorded = run['overall']
        for name, field in [('tp', 'true_positive'), ('fp', 'false_positive'), ('tn', 'true_negative'), ('false_clears', 'definitive_false_negative')]:
            assert actual[name] == recorded['confusion'][field]
        for name in ('precision', 'recall', 'clear_negative_coverage', 'coverage', 'false_positive_rate', 'completion'):
            close(actual[name], recorded[name]['value'])
        for name in ('f1', 'auroc', 'pr_auc_average_precision', 'brier'):
            close(actual[name], recorded[name])
        for name in ('errors', 'excluded', 'probability_denominator'):
            assert actual[name] == recorded[name]
        assert actual['binary_cases'] == recorded['denominator']
    for operation in summary['operations']:
        cohort = [row for (model, dataset), values in cohorts.items() if model == operation['model'] and not dataset.startswith('synthetic-') for row in values]
        assert len(cohort) == operation['selected'] == 880
        successful = [row for row in cohort if row['prediction']['status'] == 'ok']
        attempted = [row for row in cohort if row['prediction']['status'] != 'excluded']
        assert len(successful) == operation['completed'] and len(attempted) == operation['attempted']
        assert sum(row['prediction']['status'] == 'error' for row in cohort) == operation['errors']
        assert len(cohort) - len(attempted) == operation['excluded']
        tokens = [row['prediction']['input_tokens'] for row in attempted if row['prediction'].get('input_tokens') is not None]
        assert len(tokens) == operation['known_input_observations']
        assert len(attempted) - len(tokens) == operation['unknown_input_observations']
        assert sum(tokens) == operation['known_input_tokens']
        times = sorted(row['prediction']['latency_ms'] for row in successful)
        for q, name in [(.5, 'p50'), (.95, 'p95'), (.99, 'p99')]:
            close(times[math.floor((len(times)-1)*q)] if times else None, operation[f'completed_{name}_ms'])
    supplement = runpy.run_path(str(ROOT / 'scripts/analyze-eval-release.py'), run_name='release_analysis')
    analysis_receipt = supplement['verify_supplement'](ROOT)
    print(json.dumps({'verified_models': len(models), 'verified_observations': len(rows), 'verified_scorecards': len(summary['runs']), 'identical_inputs_across_models': True, 'execution_errors': sum(op['errors'] for op in summary['operations']), **analysis_receipt, 'network_calls': 0, 'raw_dataset_text_required': False}))


if __name__ == '__main__':
    main()
