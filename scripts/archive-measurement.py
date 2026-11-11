#!/usr/bin/env python3
"""Archive one `pnpm eval:measure` run as redacted observations, or verify an archive offline.

Create: python3 -B scripts/archive-measurement.py --input RUN --out NEW_ARCHIVE
Verify: python3 -B scripts/archive-measurement.py --verify ARCHIVE

Pair text never enters the archive: each row reuses the redacted pair already committed in the
cohort's earlier sources, after checking that the measured text hashes to the same value.
"""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
METRICS_HELPER = Path('eval/results/business-2026-11-04/metrics.py')
OBSERVATIONS = 'observations.redacted.jsonl.gz'
MANIFEST = 'archive-sha256.json'
TEXT_FIELDS = ('claim', 'evidence')
IDENTITY_FIELDS = ('gold', 'native_label', 'group_id', 'dataset')
COMPARABLE_FIELDS = ('prompt_version', 'threshold_version', 'engine_release')
PREDICTION_FIELDS = frozenset((
    'engine_release', 'error_code', 'input_tokens', 'latency_ms', 'model', 'model_revision', 'output_tokens', 'pair_id',
    'pass', 'presentation', 'probabilities', 'prompt_hash', 'prompt_version', 'provider', 'raw_scores', 'reported_model',
    'request_id', 'request_usage', 'status', 'threshold_version', 'verdict'))
STATUS_OK = 'ok'
LATENCY_PERCENTILES = {'completed_p50_ms': .5, 'completed_p95_ms': .95}

metrics = runpy.run_path(str(ROOT / METRICS_HELPER), run_name='measurement_metrics')['metrics']


class MeasurementArchiveError(ValueError):
    """The run or archive cannot be trusted as a comparable, redacted measurement."""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n').encode()


def require(condition, message):
    if not condition:
        raise MeasurementArchiveError(message)


def reference_rows(cohort, root):
    """Redacted pair and text provenance for every cohort pair, from the cohort's committed sources."""
    reference = {}
    for source in cohort['sources']:
        for line in gzip.decompress((root / source).read_bytes()).splitlines():
            row = json.loads(line)['row']
            if row['pair']['dataset'] in cohort['datasets']:
                reference.setdefault(row['pair']['id'], row)
    return reference


def text_provenance(pair):
    return {f'{field}_{name}': value for field in TEXT_FIELDS for name, value in (
        ('sha256', sha(pair[field].encode())), ('utf8_bytes', len(pair[field].encode())))}


def redact(row, reference):
    pair, prediction = row['pair'], row['prediction']
    prior = reference.get(pair['id'])
    require(prior is not None, f"{pair['id']}: not a pair of this cohort")
    measured, frozen = text_provenance(pair), prior['text_provenance']
    require(all(f'{field}_sha256' in frozen for field in TEXT_FIELDS) and all(measured[key] == value for key, value in frozen.items()),
            f"{pair['id']}: text differs from the cohort's frozen input")
    require(all(pair[field] == prior['pair'][field] for field in IDENTITY_FIELDS), f"{pair['id']}: label or group changed")
    require(set(prediction) <= PREDICTION_FIELDS, f"{pair['id']}: unreviewed prediction field {sorted(set(prediction) - PREDICTION_FIELDS)}")
    if prediction['status'] == STATUS_OK:
        require(all(prediction[field] == prior['prediction'][field] for field in COMPARABLE_FIELDS
                    if field in prior['prediction']), f"{pair['id']}: prompt or threshold version differs from the cohort")
    return {'pair': prior['pair'], 'prediction': prediction, 'text_provenance': frozen}


def collect(run, root):
    protocol, progress = read(run / 'protocol.json'), read(run / 'progress.json')
    require(progress['status'] == 'complete', 'Run is incomplete; archive only finished measurements')
    cohort = protocol['cohort']
    reference = reference_rows(cohort, root)
    observations, hashes, statuses, models = [], {}, {}, set()
    for data in cohort['inputs']:
        prefix = str(run / data['id'])
        report = read(Path(prefix + '.json'))
        checkpoint = Path(prefix + '.predictions.jsonl').read_bytes()
        require(report['manifest_sha256'] == data['sha256'] == sha((root / data['path']).read_bytes()), f"{data['id']}: input changed")
        require(sha(checkpoint) == report['prediction_artifact']['sha256'], f"{data['id']}: checkpoint differs from report")
        recorded = {item['pair_id']: item for item in map(json.loads, checkpoint.splitlines())}
        require(len(report['rows']) == len(recorded) == data['pairs'], f"{data['id']}: expected one observation per pair")
        for row in report['rows']:
            require(row['prediction'] == recorded[row['pair']['id']], f"{data['id']}: report differs from checkpoint")
            observations.append({'model': None, 'dataset': row['pair']['dataset'], 'row': redact(row, reference)})
        models.add(report['prediction_metadata']['model'])
        status_bytes = Path(prefix + '.http-status.jsonl').read_bytes()
        statuses[data['id']] = [json.loads(line)['status'] for line in status_bytes.splitlines()]
        hashes[data['id']] = {'report': sha(Path(prefix + '.json').read_bytes()), 'checkpoint': sha(checkpoint), 'http_status': sha(status_bytes)}
    require(len(models) == 1 and None not in models, 'Run does not identify exactly one model')
    model = models.pop()
    require({row['row']['pair']['id'] for row in observations} == set(reference), 'Run does not cover the cohort exactly')
    for observation in observations:
        observation['model'] = model
    snapshot = read(run / 'execution-sources.json')
    require(all(sha(snapshot[path].encode()) == digest for path, digest in protocol['frozen_sources'].items()),
            'Execution snapshot differs from the frozen cohort sources')
    return protocol, model, observations, statuses, hashes, snapshot, progress['probe']


def score(rows):
    return metrics([row['pair'] for row in rows],
                   {row['pair']['id']: row['prediction'].get('verdict', row['prediction']['status']) for row in rows},
                   {row['pair']['id']: row['prediction']['probabilities']['contradiction']
                    for row in rows if row['prediction']['status'] == STATUS_OK})


def operation(rows):
    latencies = sorted(row['prediction']['latency_ms'] for row in rows if row['prediction']['status'] == STATUS_OK)
    return {'selected': len(rows), 'completed': len(latencies),
            **{name: latencies[math.floor((len(latencies) - 1) * quantile)] if latencies else None
               for name, quantile in LATENCY_PERCENTILES.items()},
            'reported_models': sorted({row['prediction']['reported_model'] for row in rows if row['prediction'].get('reported_model')})}


def summarize(protocol, model, observations):
    cohort = protocol['cohort']
    by_dataset = {dataset: [item['row'] for item in observations if item['dataset'] == dataset] for dataset in cohort['datasets']}
    return {'schema_version': 1, 'model': model, 'backend': protocol['backend'], 'cohort': cohort['id'],
            'measured_at': protocol['created_at'], 'observations': len(observations),
            'operation': operation([item['row'] for item in observations]),
            'scorecards': {dataset: score(rows) for dataset, rows in by_dataset.items()}}


def render(summary):
    percent = lambda value: '—' if value is None else f'{100 * value:.1f}'
    scalar = lambda value: '—' if value is None else f'{value:.3f}'
    operation = summary['operation']
    latency = (f"Completed-call latency p50 / p95: {operation['completed_p50_ms']:.0f} / {operation['completed_p95_ms']:.0f} ms."
               if operation['completed'] else 'No call completed.')
    lines = [
        f"# {summary['model']}: {summary['cohort']} measurement", '',
        f"Measured {summary['measured_at'][:10]} through the `{summary['backend']}` evaluation backend: "
        f"**{summary['observations']} observations**, {operation['completed']} completed, one sequential pass, "
        'shipped `balanced-v1` prompt and thresholds, no retries or fallback. '
        f"Reported model identities: {', '.join(f'`{name}`' for name in operation['reported_models']) or 'none'}. {latency}", '',
        'Evaluation only. Native dataset labels, not human-adjudicated service-contract labels; public development data; '
        "not contemporaneous with the cohort's earlier measurements, so latency is not directly comparable. "
        'This archive adds no model to the API catalog. Nicia has no commercial relationship with any evaluated model provider.', '',
        '| Scorecard | Precision | Recall | Clear-negative coverage | Average precision | AUROC | False clears | Errors |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ]
    for dataset, card in summary['scorecards'].items():
        lines.append(f"| {dataset} | {percent(card['precision'])} | {percent(card['recall'])} | {percent(card['clear_negative_coverage'])} | "
                     f"{scalar(card['pr_auc_average_precision'])} | {scalar(card['auroc'])} | {card['false_clears']} | {card['errors']} |")
    lines += ['', 'Precision, recall and coverage are percentages at the shared 0.8/0.2 cutoff; errors and uncertainty stay in their '
              'denominators. Ranking metrics use completed calls only.', '',
              'Verify offline with `python3 -B scripts/archive-measurement.py --verify` followed by this directory.', '']
    return '\n'.join(lines).encode()


def packed_observations(observations):
    return gzip.compress(('\n'.join(json.dumps(item, ensure_ascii=False) for item in observations) + '\n').encode(), mtime=0)


def create(run, out, root=ROOT):
    protocol, model, observations, statuses, hashes, snapshot, probe = collect(run, root)
    summary = summarize(protocol, model, observations)
    files = {
        'protocol.json': encoded(protocol), 'summary.json': encoded(summary), 'http-status.json': encoded(statuses),
        'integration-probe.json': encoded({key: probe[key] for key in ('pairs', 'completed', 'errors', 'excluded')}),
        'original-artifact-sha256.json': encoded(hashes), OBSERVATIONS: packed_observations(observations),
        'execution-sources.json.gz': gzip.compress(encoded(snapshot), mtime=0), 'README.md': render(summary),
    }
    files[MANIFEST] = encoded({name: sha(data) for name, data in sorted(files.items())})
    out.mkdir(parents=True, exist_ok=False)
    for name, data in files.items():
        (out / name).write_bytes(data)
    return verify(out, root)


def verify(archive, root=ROOT):
    recorded = read(archive / MANIFEST)
    present = {path.name for path in archive.iterdir()} - {MANIFEST}
    require(present == set(recorded), 'Archive files differ from its manifest')
    for name, digest in recorded.items():
        require(sha((archive / name).read_bytes()) == digest, f'Archive file changed: {name}')
    protocol, summary = read(archive / 'protocol.json'), read(archive / 'summary.json')
    observations = [json.loads(line) for line in gzip.decompress((archive / OBSERVATIONS).read_bytes()).splitlines()]
    reference = reference_rows(protocol['cohort'], root)
    require({item['row']['pair']['id'] for item in observations} == set(reference) and len(observations) == len(reference),
            'Archive does not cover the cohort exactly once')
    for item in observations:
        prior = reference[item['row']['pair']['id']]
        require(item['model'] == summary['model'] and item['row']['pair'] == prior['pair']
                and item['row']['text_provenance'] == prior['text_provenance'], 'Archived pair differs from the cohort')
    require(summarize(protocol, summary['model'], observations) == summary, 'Summary differs from recomputation')
    return {'verified_model': summary['model'], 'cohort': summary['cohort'], 'observations': len(observations), 'network_calls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--verify', type=Path, metavar='ARCHIVE')
    parser.add_argument('--input', type=Path, metavar='RUN')
    parser.add_argument('--out', type=Path, metavar='NEW_ARCHIVE')
    args = parser.parse_args()
    if args.verify and not (args.input or args.out):
        print(json.dumps(verify(args.verify)))
    elif args.input and args.out and not args.verify:
        print(json.dumps(create(args.input, args.out)))
    else:
        parser.error('Use --verify ARCHIVE, or --input RUN with --out NEW_ARCHIVE')


if __name__ == '__main__':
    main()
