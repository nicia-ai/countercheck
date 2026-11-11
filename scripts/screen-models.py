#!/usr/bin/env python3
"""Screen measured decision models for viability without network calls or raw text.

Verify: python3 -B scripts/screen-models.py --verify ARCHIVE
Create: python3 -B scripts/screen-models.py --out NEW_ARCHIVE
"""
import argparse
from collections import defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import runpy
import statistics

ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path('eval/model-screen.json')
METRICS_HELPER = Path('eval/results/business-2026-11-04/metrics.py')
ARCHIVED_CONFIG = 'cohorts.json'
MANIFEST = 'archive-sha256.json'
COHORT_FIELDS = ('id', 'description', 'datasets', 'sources')
REPLICATES = 2000
SEED = 20261111
INTERVAL = (.025, .975)
LATENCY_PERCENTILE = .95
MINIMUM_REPLICATION_COHORTS = 2
RELIABILITY_FLAG_ERROR_RATE = .02
STATUS_SCREENED_OUT = 'screened_out'
STATUS_DEPRIORITIZED = 'deprioritized'
STATUS_VIABLE = 'viable'
STATUS_ORDER = (STATUS_VIABLE, STATUS_DEPRIORITIZED, STATUS_SCREENED_OUT)
POSITIVE = 'contradiction'

ranking_metrics = runpy.run_path(str(ROOT / METRICS_HELPER), run_name='screen_metrics')['ranking_metrics']


class ScreenError(ValueError):
    """The configured cohorts cannot support a paired screen."""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n').encode()


def percentile(sorted_values, quantile):
    return sorted_values[math.floor((len(sorted_values) - 1) * quantile)]


def load_cohort(cohort, root=ROOT):
    """Return {model: {dataset: {pair_id: row}}}; a later source replaces a model's earlier rows."""
    models = {}
    for source in cohort['sources']:
        incoming = defaultdict(lambda: defaultdict(dict))
        for line in gzip.decompress((root / source).read_bytes()).splitlines():
            observation = json.loads(line)
            if observation['dataset'] not in cohort['datasets']:
                continue
            rows = incoming[observation['model']][observation['dataset']]
            pair_id = observation['row']['pair']['id']
            if pair_id in rows:
                raise ScreenError(f'{source}: repeated pair {pair_id}; the screen expects one pass')
            rows[pair_id] = observation['row']
        models.update({model: dict(datasets) for model, datasets in incoming.items()})
    if not models:
        raise ScreenError(f"{cohort['id']}: no observations for the configured scorecards")
    require_identical_inputs(cohort, models)
    return models


def require_identical_inputs(cohort, models):
    reference = None
    for model, datasets in sorted(models.items()):
        if set(datasets) != set(cohort['datasets']):
            raise ScreenError(f"{cohort['id']}: {model} lacks a configured scorecard")
        identity = {dataset: {pair_id: (row['pair']['gold'], row['pair']['group_id'])
                              for pair_id, row in rows.items()} for dataset, rows in datasets.items()}
        if reference is None:
            reference = identity
        elif identity != reference:
            raise ScreenError(f"{cohort['id']}: {model} was not measured on the cohort's exact pairs")


def average_precision(rows):
    """Successful rows only, matching the published ranking metric; errors are reported separately."""
    scored = [row for row in rows if row['prediction']['status'] == 'ok']
    pairs = [row['pair'] for row in scored]
    scores = {row['pair']['id']: row['prediction']['probabilities']['contradiction'] for row in scored}
    return ranking_metrics(pairs, scores)['pr_auc_average_precision'] if scored else None


def describe(cohort, models):
    summary = {}
    for model, datasets in models.items():
        rows = [row for dataset in cohort['datasets'] for row in datasets[dataset].values()]
        latencies = sorted(row['prediction']['latency_ms'] for row in rows if row['prediction']['status'] == 'ok')
        errors = sum(row['prediction']['status'] != 'ok' for row in rows)
        by_dataset = {dataset: average_precision(datasets[dataset].values()) for dataset in cohort['datasets']}
        summary[model] = {
            'average_precision': by_dataset,
            'macro_average_precision': statistics.mean(by_dataset.values()),
            'successful_p95_ms': percentile(latencies, LATENCY_PERCENTILE) if latencies else None,
            'selected': len(rows), 'errors': errors, 'error_rate': errors / len(rows),
            'reliability_flag': errors / len(rows) >= RELIABILITY_FLAG_ERROR_RATE,
        }
    return summary


def resampled_precision(cohort, models, replicates=REPLICATES, seed=SEED):
    """One shared source-group resample per replicate keeps every model comparison paired."""
    by_group = {(model, dataset): defaultdict(list) for model in models for dataset in cohort['datasets']}
    for model, datasets in models.items():
        for dataset in cohort['datasets']:
            for row in datasets[dataset].values():
                by_group[model, dataset][row['pair']['group_id']].append(row)
    reference = next(iter(models))
    groups = {dataset: sorted(by_group[reference, dataset]) for dataset in cohort['datasets']}
    rng = random.Random(seed)
    samples = {model: [] for model in models}
    for _ in range(replicates):
        picks = {dataset: [names[rng.randrange(len(names))] for _ in names] for dataset, names in groups.items()}
        for model in models:
            samples[model].append([
                average_precision([row for group in picks[dataset] for row in by_group[model, dataset][group]])
                for dataset in cohort['datasets']])
    return samples


def interval(values):
    ordered = sorted(values)
    return [percentile(ordered, INTERVAL[0]), percentile(ordered, INTERVAL[1])] if ordered else None


def compare(cohort, summary, samples, candidate, challenger):
    """Challenger minus candidate: macro ranking quality, per-scorecard reversals and latency."""
    macro, per_dataset = [], [[] for _ in cohort['datasets']]
    for theirs, ours in zip(samples[challenger], samples[candidate]):
        defined = [(a, b) for a, b in zip(theirs, ours) if a is not None and b is not None]
        if defined:
            macro.append(statistics.mean(a for a, _ in defined) - statistics.mean(b for _, b in defined))
        for index, (a, b) in enumerate(zip(theirs, ours)):
            if a is not None and b is not None:
                per_dataset[index].append(a - b)
    macro_interval = interval(macro)
    reversals = [dataset for dataset, values in zip(cohort['datasets'], per_dataset)
                 if values and interval(values)[1] < 0]
    candidate_latency = summary[candidate]['successful_p95_ms']
    challenger_latency = summary[challenger]['successful_p95_ms']
    comparable = candidate_latency is not None and challenger_latency is not None
    return {
        'macro_average_precision_difference':
            summary[challenger]['macro_average_precision'] - summary[candidate]['macro_average_precision'],
        'percentile_95': macro_interval,
        'candidate_significantly_better_on': reversals,
        'quality_dominates': macro_interval is not None and macro_interval[0] > 0 and not reversals,
        'challenger_not_slower': comparable and challenger_latency <= candidate_latency,
        'candidate_faster': comparable and candidate_latency < challenger_latency,
    }


def classify(evidence):
    """Evidence is one comparison per shared cohort for a single challenger."""
    if not evidence or not all(item['quality_dominates'] for item in evidence.values()):
        return None
    if all(item['candidate_faster'] for item in evidence.values()):
        return None  # A consistent speed advantage is a reason to keep measuring the model.
    replicated = len(evidence) >= MINIMUM_REPLICATION_COHORTS
    if replicated and all(item['challenger_not_slower'] for item in evidence.values()):
        return STATUS_SCREENED_OUT
    return STATUS_DEPRIORITIZED


def screen(config, root=ROOT, replicates=REPLICATES, seed=SEED):
    cohorts = {}
    for cohort in config['cohorts']:
        models = load_cohort(cohort, root)
        cohorts[cohort['id']] = (cohort, describe(cohort, models), resampled_precision(cohort, models, replicates, seed))
    every_model = sorted({model for _, summary, _ in cohorts.values() for model in summary})
    decisions = []
    for candidate in every_model:
        dominators = []
        for challenger in every_model:
            if challenger == candidate:
                continue
            evidence = {cohort_id: compare(cohort, summary, samples, candidate, challenger)
                        for cohort_id, (cohort, summary, samples) in cohorts.items()
                        if candidate in summary and challenger in summary}
            status = classify(evidence)
            if status:
                dominators.append({'model': challenger, 'status': status, 'evidence': evidence})
        status = max((item['status'] for item in dominators), key=STATUS_ORDER.index, default=STATUS_VIABLE)
        decisions.append({
            'model': candidate, 'status': status,
            'measured_cohorts': [cohort_id for cohort_id, (_, summary, _) in cohorts.items() if candidate in summary],
            'reliability_flags': [cohort_id for cohort_id, (_, summary, _) in cohorts.items()
                                  if candidate in summary and summary[candidate]['reliability_flag']],
            'dominated_by': [item for item in dominators if item['status'] == status],
        })
    return {
        'analysis_kind': 'post-hoc viability screen; no new inference, tuning or production qualification',
        'analysis_version': 1,
        'rule': {
            'quality': 'paired source-group bootstrap of macro average precision across the cohort scorecards; '
                       'the challenger interval must exclude zero and the candidate may not be significantly better on any scorecard',
            STATUS_SCREENED_OUT: f'quality-dominated in every shared cohort (at least {MINIMUM_REPLICATION_COHORTS}) '
                                 'by a challenger whose successful p95 latency is no higher in each',
            STATUS_DEPRIORITIZED: 'quality-dominated in every shared cohort without a consistent latency advantage, '
                                  'but unreplicated or with inconsistent latency ordering',
            STATUS_VIABLE: 'not dominated, or consistently faster than every model that dominates it on quality',
            'replicates': replicates, 'seed': seed, 'interval': 'pointwise percentile 95%; no multiplicity correction',
            'reliability_flag_error_rate': RELIABILITY_FLAG_ERROR_RATE,
        },
        'cohorts': [{'id': cohort_id, 'description': cohort['description'], 'datasets': cohort['datasets'],
                     'models': summary} for cohort_id, (cohort, summary, _) in cohorts.items()],
        'decisions': decisions,
    }


def render(analysis):
    cohorts = {cohort['id']: cohort for cohort in analysis['cohorts']}
    lines = [
        '# Decision-model viability screen', '',
        'Status: post-hoc analysis of committed observations. No new model calls. This narrows where evaluation effort goes; '
        'it changes no API catalog entry, default, prompt or threshold and qualifies no model for production.', '',
        '## Rule', '',
        f"- **Quality:** {analysis['rule']['quality']}.",
        f"- **Screened out:** {analysis['rule'][STATUS_SCREENED_OUT]}.",
        f"- **Deprioritized:** {analysis['rule'][STATUS_DEPRIORITIZED]}.",
        f"- **Viable:** {analysis['rule'][STATUS_VIABLE]}.", '',
        'Average precision ranks native contradictions by the raw contradiction score, so it does not depend on the shared 0.8/0.2 '
        'cutoff. It still depends on the shared `balanced-v1` prompt and on native labels that differ from the service contract. '
        'Latency is one sequential pass per route and varied severalfold between cohorts; it is used only as an ordering. '
        'The rule was written after these results were visible.', '',
        '## Result', '',
        '| Model | Status | ' + ' | '.join(f'{cohort_id}: macro AP / p95 ms / errors' for cohort_id in cohorts) + ' | Dominated by |',
        '| --- | --- | ' + ' | '.join('---:' for _ in cohorts) + ' | --- |',
    ]
    for decision in sorted(analysis['decisions'], key=lambda item: (STATUS_ORDER.index(item['status']), item['model'])):
        cells = []
        for cohort in cohorts.values():
            measured = cohort['models'].get(decision['model'])
            cells.append('—' if measured is None else
                         f"{measured['macro_average_precision']:.3f} / {measured['successful_p95_ms']:.0f} / "
                         f"{measured['errors']}{' ⚠' if measured['reliability_flag'] else ''}")
        dominators = ', '.join(f"`{item['model']}`" for item in decision['dominated_by']) or '—'
        lines.append(f"| `{decision['model']}` | {decision['status'].replace('_', ' ')} | " + ' | '.join(cells) + f' | {dominators} |')
    lines += [
        '', f"⚠ marks an error rate of at least {analysis['rule']['reliability_flag_error_rate']:.0%} in that cohort. "
        'Errors are excluded from average precision and reported here instead, so a reliability problem is not mistaken for a ranking problem.', '',
        '## Re-measuring or adding a model', '',
        'A status describes the measured model version under the current prompt, not the vendor. To add a model or revisit a status: '
        "measure it on a cohort's frozen inputs with `pnpm eval:measure`, archive the run with `scripts/archive-measurement.py`, "
        "append the archive's redacted observations to the cohort's `sources` in `eval/model-screen.json`, and write a new dated "
        'screen with `python3 -B scripts/screen-models.py --out NEW_ARCHIVE`. '
        'A later source replaces the same model ID; a new version under a new ID is screened beside the old one. '
        'A model measured on one cohort can be deprioritized but not screened out. Each screen keeps its own `cohorts.json`, '
        'so earlier screens remain verifiable.', '',
        'Verify this archive offline with `python3 -B scripts/screen-models.py --verify` followed by its directory.', '',
    ]
    return '\n'.join(lines).encode()


def source_hashes(config, root):
    return {source: sha((root / source).read_bytes()) for cohort in config['cohorts'] for source in cohort['sources']}


def artifacts(config, root=ROOT):
    """The archive carries its own cohort snapshot, so appending a source later leaves it verifiable."""
    snapshot = {'cohorts': [{key: cohort[key] for key in COHORT_FIELDS} for cohort in config['cohorts']]}
    analysis = {'sources_sha256': source_hashes(snapshot, root), **screen(snapshot, root)}
    files = {ARCHIVED_CONFIG: encoded(snapshot), 'analysis.json': encoded(analysis), 'README.md': render(analysis)}
    files[MANIFEST] = encoded({name: sha(data) for name, data in files.items()})
    return files, analysis


def verify(directory, root=ROOT):
    recorded = json.loads((directory / MANIFEST).read_bytes())
    for name, digest in recorded.items():
        if sha((directory / name).read_bytes()) != digest:
            raise ScreenError(f'Model screen file changed: {name}')
    snapshot = json.loads((directory / ARCHIVED_CONFIG).read_bytes())
    if source_hashes(snapshot, root) != json.loads((directory / 'analysis.json').read_bytes())['sources_sha256']:
        raise ScreenError('A screened source changed after this screen was written')
    files, analysis = artifacts(snapshot, root)
    for name in (ARCHIVED_CONFIG, 'analysis.json'):
        if (directory / name).read_bytes() != files[name]:
            raise ScreenError(f'Model screen differs from recomputation: {name}')
    statuses = defaultdict(list)
    for decision in analysis['decisions']:
        statuses[decision['status']].append(decision['model'])
    return {'verified_models': len(analysis['decisions']), **statuses, 'network_calls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--verify', type=Path, metavar='ARCHIVE')
    action.add_argument('--out', type=Path, metavar='NEW_ARCHIVE')
    args = parser.parse_args()
    if args.verify:
        print(json.dumps(verify(args.verify)))
        return
    if args.out.exists() and any(args.out.iterdir()):
        raise ScreenError('Refusing to overwrite a nonempty screen directory')
    files, _ = artifacts(json.loads((ROOT / CONFIG).read_bytes()))
    args.out.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (args.out / name).write_bytes(data)
    print(json.dumps({'written_files': len(files), 'network_calls': 0}))


if __name__ == '__main__':
    main()
