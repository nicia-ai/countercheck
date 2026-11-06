#!/usr/bin/env python3
"""Recompute the post-hoc evaluation supplement without network calls or raw text."""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import runpy

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = Path('eval/results/hosted-models-with-glide-2026-11-05')
SUPPLEMENT = Path('eval/results/hosted-models-analysis-2026-11-05')
DATASETS = ('vitaminc', 'scifact', 'contractnli', 'mnli', 'findver')
GLIDE = 'fastino/GLiDE'
DECIDER = 'perplexity/pplx-decider-v1.2'
JEV = 'jev-1.14.0'
COMPARISONS = (
    ('findver', GLIDE, DECIDER),
    ('findver', GLIDE, JEV),
    ('contractnli', GLIDE, DECIDER),
    ('mnli', GLIDE, DECIDER),
    ('vitaminc', DECIDER, JEV),
    ('mnli', DECIDER, JEV),
)
REPLICATES = 20000
SEED = 20261105
SOURCE = Path('scripts/analyze-eval-release.py')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n').encode()


def counts(rows):
    """All selected rows remain in denominators, including errors and abstentions."""
    result = [0] * 5  # native positives, negatives, TP, FP, clear negatives
    for row in rows:
        positive = row['pair']['gold'] == 'contradiction'
        prediction = row['prediction']
        verdict = prediction.get('verdict') if prediction['status'] == 'ok' else None
        result[0] += positive
        result[1] += not positive
        result[2] += positive and verdict == 'contradiction'
        result[3] += not positive and verdict == 'contradiction'
        result[4] += not positive and verdict == 'no_contradiction'
    return result


def measures(value):
    positives, negatives, tp, fp, tn = value
    return {
        'f1': 2 * tp / (positives + tp + fp) if positives + tp + fp else None,
        'recall': tp / positives if positives else None,
        'clear_negative_coverage': tn / negatives if negatives else None,
    }


def precision_frontier(rows, minimum=.95):
    """An optimistic same-sample threshold sweep; tied scores enter together."""
    positives = sum(row['pair']['gold'] == 'contradiction' for row in rows)
    blocks = defaultdict(lambda: [0, 0])
    observed = 0
    for row in rows:
        prediction = row['prediction']
        if prediction['status'] != 'ok':
            continue
        score = prediction['raw_scores']['contradiction']
        positive = row['pair']['gold'] == 'contradiction'
        blocks[score][0 if positive else 1] += 1
        observed += 1
    best = None
    tp = fp = 0
    for threshold in sorted(blocks, reverse=True):
        more_tp, more_fp = blocks[threshold]
        tp += more_tp
        fp += more_fp
        precision = tp / (tp + fp)
        if precision < minimum:
            continue
        candidate = (tp, precision, threshold, fp)
        if best is None or candidate[:3] > best[:3]:
            best = candidate
    return {
        'minimum_observed_precision': minimum,
        'positive_denominator': positives,
        'probability_denominator': observed,
        'recall': (best[0] / positives if best else 0.0) if positives else None,
        'precision': best[1] if best else None,
        'threshold': best[2] if best else None,
        'true_positive': best[0] if best else 0,
        'false_positive': best[3] if best else 0,
        'nonempty_qualifying_threshold': best is not None,
    }


def paired(first, second, replicates=REPLICATES, seed=SEED):
    if not first or replicates < 1:
        raise ValueError('Paired comparison requires rows and positive replicate count')
    if set(first) != set(second):
        raise ValueError('Paired comparison requires identical selected pair IDs')
    groups = defaultdict(lambda: [[], []])
    only = {'positive': [0, 0], 'negative': [0, 0]}
    for pair_id in sorted(first):
        a, b = first[pair_id], second[pair_id]
        for field in ('gold', 'native_label', 'group_id'):
            if a['pair'][field] != b['pair'][field]:
                raise ValueError('Paired labels and source groups must agree')
        group = groups[a['pair']['group_id']]
        group[0].append(a)
        group[1].append(b)
        positive = a['pair']['gold'] == 'contradiction'
        expected = 'contradiction' if positive else 'no_contradiction'
        hit_a = a['prediction']['status'] == 'ok' and a['prediction'].get('verdict') == expected
        hit_b = b['prediction']['status'] == 'ok' and b['prediction'].get('verdict') == expected
        discordant = only['positive' if positive else 'negative']
        discordant[0] += hit_a and not hit_b
        discordant[1] += hit_b and not hit_a
    sufficient = [(counts(groups[g][0]), counts(groups[g][1])) for g in sorted(groups)]
    points = [measures(counts(value.values())) for value in (first, second)]
    differences = {key: [] for key in points[0]}
    rng = random.Random(seed)
    for _ in range(replicates):
        totals = [[0] * 5, [0] * 5]
        for _ in sufficient:
            selected = sufficient[rng.randrange(len(sufficient))]
            for side in (0, 1):
                for index, count in enumerate(selected[side]):
                    totals[side][index] += count
        a, b = map(measures, totals)
        for key in differences:
            if a[key] is not None and b[key] is not None:
                differences[key].append(a[key] - b[key])
    intervals = {}
    for key, values in differences.items():
        values.sort()
        intervals[key] = {
            'first': points[0][key],
            'second': points[1][key],
            'difference': points[0][key] - points[1][key]
            if points[0][key] is not None and points[1][key] is not None else None,
            'percentile_95': [values[math.floor((len(values) - 1) * q)] for q in (.025, .975)]
            if values else None,
            'valid_replicates': len(values),
        }
    return {'selected_pairs': len(first), 'source_groups': len(groups),
            'discordant_correct_outcomes': only, 'metrics': intervals}


def analyze(root=ROOT):
    archive = root / ARCHIVE
    source_bytes = (archive / 'observations.redacted.jsonl.gz').read_bytes()
    observations = [json.loads(line) for line in gzip.decompress(source_bytes).splitlines()]
    cohorts = defaultdict(dict)
    for observation in observations:
        if observation['dataset'] not in DATASETS:
            continue
        row = observation['row']
        cohort = cohorts[observation['model'], observation['dataset']]
        pair_id = row['pair']['id']
        if pair_id in cohort:
            raise ValueError('The supplement requires one pass and unique pair IDs')
        cohort[pair_id] = row
    summary = json.loads((archive / 'summary.json').read_bytes())
    models = summary['models']
    expected = {(model['id'], dataset) for model in models for dataset in DATASETS}
    if set(cohorts) != expected:
        raise ValueError('Expected all nine models on all five public scorecards')
    helper_path = Path('eval/results/business-2026-11-04/metrics.py')
    calculate = runpy.run_path(str(root / helper_path), run_name='supplement_metrics')['metrics']
    rankings = []
    coverage = []
    for model in models:
        for dataset in DATASETS:
            rows = list(cohorts[model['id'], dataset].values())
            pairs = [row['pair'] for row in rows]
            verdicts = {row['pair']['id']: row['prediction'].get('verdict', row['prediction']['status']) for row in rows}
            scores = {row['pair']['id']: row['prediction']['probabilities']['contradiction']
                      for row in rows if row['prediction']['status'] == 'ok'}
            metrics = calculate(pairs, verdicts, scores)
            rankings.append({
                'model': model['id'], 'dataset': dataset, 'selected': len(rows),
                'source_groups': len({pair['group_id'] for pair in pairs}),
                'positive_denominator': sum(pair['gold'] == 'contradiction' for pair in pairs),
                'probability_denominator': metrics['probability_denominator'],
                'errors': metrics['errors'], 'excluded': metrics['excluded'],
                'shipped': {key: metrics[key] for key in
                            ('f1', 'precision', 'recall', 'clear_negative_coverage', 'false_clears')},
                'auroc': metrics['auroc'], 'average_precision': metrics['pr_auc_average_precision'],
                'retrospective_recall_at_precision_95': precision_frontier(rows),
            })
            by_label = defaultdict(list)
            for row in rows:
                if row['pair']['gold'] != 'contradiction':
                    by_label[row['pair']['native_label']].append(row)
            for label, selected in sorted(by_label.items()):
                outcomes = Counter(row['prediction'].get('verdict', row['prediction']['status']) for row in selected)
                uncertain_top = Counter()
                for row in selected:
                    if row['prediction'].get('verdict') != 'uncertain':
                        continue
                    raw = row['prediction']['raw_scores']
                    largest = max(raw.values())
                    uncertain_top['+'.join(sorted(key for key, value in raw.items() if value == largest))] += 1
                coverage.append({
                    'model': model['id'], 'dataset': dataset, 'native_label': label,
                    'selected': len(selected), 'cleared': outcomes['no_contradiction'],
                    'clear_negative_coverage': outcomes['no_contradiction'] / len(selected),
                    'uncertain': outcomes['uncertain'], 'false_positive': outcomes['contradiction'],
                    'errors': outcomes['error'], 'excluded': outcomes['excluded'],
                    'uncertain_argmax': dict(sorted(uncertain_top.items())),
                })
    contrasts = []
    for dataset, first, second in COMPARISONS:
        contrasts.append({'dataset': dataset, 'first_model': first, 'second_model': second,
                          **paired(cohorts[first, dataset], cohorts[second, dataset])})
    baseline_protocol = Path('eval/results/hosted-models-2026-11-05/protocol.json')
    fastino_protocol = ARCHIVE / 'fastino-protocol.json'
    return {
        'analysis_kind': 'post-hoc, exploratory; no new inference or threshold validation',
        'analysis_version': 1,
        'inputs_sha256': {str(path): sha((root / path).read_bytes()) for path in
                          (ARCHIVE / 'observations.redacted.jsonl.gz', ARCHIVE / 'summary.json',
                           baseline_protocol, fastino_protocol, helper_path, SOURCE)},
        'bootstrap': {'unit': 'source group; all pairs from both models resampled together',
                      'replicates': REPLICATES, 'seed': SEED,
                      'interval': 'pointwise percentile 95%; no multiplicity correction',
                      'scope': 'conditional on selected groups and one fixed inference pass'},
        'models': models, 'ranking_and_operating_points': rankings,
        'negative_coverage_by_native_label': coverage, 'paired_comparisons': contrasts,
    }


def percent(value):
    return '—' if value is None else f'{value * 100:.1f}'


def render(analysis):
    names = {model['id']: model['name'] for model in analysis['models']}
    lines = [
        '# Post-hoc analysis of the November 5 nine-model comparison', '',
        'Status: exploratory analysis of previously published observations. No new model calls, tuning validation, or changes to the frozen measurement archives.', '',
        '## Interpretation', '',
        '- Four scorecards are reused development samples. FinDVer is a previously scored, untuned public evaluation cohort; its original `locked-test` protocol field is retained as historical metadata, not a claim of a fresh holdout.',
        '- The Fastino phase was specified after the eight-model results were available. It used the same inputs and policy; it was not part of a single prospective nine-model protocol.',
        '- One pass and original presentation were measured. Input-order robustness, inference repeatability, and generalization to unseen-to-model data were not established.',
        '- These public corpora may have been present in provider training. The initial five-arm prompt-ablation study used Jev only; later quality iterations also explored Decider prompts and composition. No vendor-optimized comparison was performed.',
        '- The source labels are native dataset labels, not human adjudication of the service’s four-way contract. All results remain separate from production qualification.', '',
        '## Ranking and shipped behavior', '',
        'AUC/AP use successful rows with observed probabilities; their denominators are explicit. Shipped F1, recall and negative coverage retain errors and abstentions in their selected-case denominators. Percentages below are 0–100; AUROC/AP are 0–1.', '',
        '| Dataset | Model | Shipped F1 | Precision | Recall | Clear negatives | AUROC | AP | Retrospective R@P≥95% | Probability rows / selected |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ]
    for dataset in DATASETS:
        for row in analysis['ranking_and_operating_points']:
            if row['dataset'] != dataset:
                continue
            shipped = row['shipped']
            lines.append(f"| {dataset} | {names[row['model']]} | {percent(shipped['f1'])} | {percent(shipped['precision'])} | {percent(shipped['recall'])} | {percent(shipped['clear_negative_coverage'])} | {row['auroc']:.3f} | {row['average_precision']:.3f} | {percent(row['retrospective_recall_at_precision_95']['recall'])} | {row['probability_denominator']} / {row['selected']} |")
    lines += ['', 'R@P≥95% is the maximum recall among nonempty score-threshold selections with at least 95% **observed precision on these same rows**, with whole tied-score blocks using the raw contradiction score, matching the shipped positive gate. AUROC/AP use the archived normalized binary probabilities. Threshold selection and assessment use the same labels. This is optimistic sensitivity analysis, not a validated deployment operating point or a precision guarantee. Missing/error rows remain positive misses. A zero means no native positives were recovered at a qualifying observed operating point; inspect JSON to distinguish no qualifying threshold. Full thresholds, TP/FP and denominators are in `analysis.json`. This scalar sweep does not optimize the four-way negative decision or jointly meet the application’s three targets.', '',
              '## Paired differences', '',
              'Each difference is first minus second, in percentage points. Source-group resampling preserves pairs and both models together. Intervals are pointwise exploratory percentile intervals from 20,000 resamples, not multiplicity-adjusted tests or uncertainty over repeated provider inference. Source groups are the recorded grouping approximation; small group counts and extreme outcomes limit inference.', '',
              '| Dataset | First − second | Groups | F1 difference [95% interval] | Recall difference [95% interval] | Negative coverage difference [95% interval] |',
              '| --- | --- | ---: | ---: | ---: | ---: |']
    for row in analysis['paired_comparisons']:
        cells=[]
        for key in ('f1', 'recall', 'clear_negative_coverage'):
            value=row['metrics'][key]
            interval=value['percentile_95']
            cells.append(f"{percent(value['difference'])} [{percent(interval[0])}, {percent(interval[1])}]")
        lines.append(f"| {row['dataset']} | {names[row['first_model']]} − {names[row['second_model']]} | {row['source_groups']} | " + ' | '.join(cells) + ' |')
    lines += ['', 'A finance F1 interval touching zero for GLiDE versus Decider leaves that comparison inconclusive. GLiDE versus Jev on finance and Decider versus Jev on VitaminC have exploratory F1 intervals above zero on this fixed sample; positive-only paired tests answer a different recall question. Equal observed contract detections do not establish population equivalence. Bootstrap intervals cannot establish high precision from a small cohort with zero observed false positives.', '',
              '## Negative coverage by native label', '',
              'All native negatives remain in each denominator. Neutral/NEI labels are not automatically the service’s `insufficient_context` label. Low confidence and a different leading relation are distinct reasons to abstain; JSON records the leading raw category among uncertain responses, preserving ties.', '',
              '| Dataset | Native label | Model | Clear / selected | Coverage | Uncertain | False positives | Errors |',
              '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |']
    for row in analysis['negative_coverage_by_native_label']:
        lines.append(f"| {row['dataset']} | {row['native_label']} | {names[row['model']]} | {row['cleared']} / {row['selected']} | {percent(row['clear_negative_coverage'])} | {row['uncertain']} | {row['false_positive']} | {row['errors']} |")
    lines += ['', 'GLiDE and Jev each clear 43/61 MultiNLI-neutral cases. Decider clears 16/61; of its 44 uncertain cases, 33 favor `consistent`, eight favor `insufficient_context`, and three favor `contradiction`. ContractNLI’s 173 selected negatives are all entailments: GLiDE clears 123 versus Decider’s 95. Neutral/NEI alone therefore cannot explain that coverage difference.', '',
              '## Reproduction and provenance', '',
              'Run `python3 -B scripts/verify-eval-release.py` from the repository root to verify both original archives and recompute this supplement. `python3 -B scripts/analyze-eval-release.py` checks the supplement alone. Python standard library only; no credentials, original finance text, or network access are needed.', '',
              'The analysis pins its observation archive, summary, protocols, metric helper and analysis source by SHA-256. `archive-sha256.json` pins this supplement’s generated JSON and README. The verifier recomputes the supplement with the declared analysis implementation; its new statistical calculations are covered by analytic regression fixtures, rather than claimed as an independent second statistical implementation. The base release verifier separately checks original aggregate metrics with the independent metric helper.', '',
              'To reconstruct into a new empty directory: `python3 -B scripts/analyze-eval-release.py --write --output /tmp/countercheck-analysis`. The command refuses to overwrite a nonempty directory. Original measurement inventories and source snapshots remain unchanged.', '']
    return '\n'.join(lines).encode()


def artifacts(root=ROOT):
    analysis = analyze(root)
    files = {'analysis.json': encoded(analysis), 'README.md': render(analysis)}
    files['archive-sha256.json'] = encoded({name: sha(data) for name, data in files.items()})
    return files


def verify_supplement(root=ROOT, path=None):
    directory = path if path is not None else root / SUPPLEMENT
    expected = artifacts(root)
    for name, data in expected.items():
        if (directory / name).read_bytes() != data:
            raise ValueError(f'Post-hoc supplement differs from recomputation: {name}')
    return {'verified_analysis_scorecards': 45, 'verified_paired_comparisons': len(COMPARISONS),
            'bootstrap_replicates_per_comparison': REPLICATES}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / SUPPLEMENT)
    args=parser.parse_args()
    if args.write:
        if args.output.exists() and any(args.output.iterdir()):
            raise ValueError('Refusing to overwrite a nonempty analysis directory')
        files=artifacts()
        args.output.mkdir(parents=True, exist_ok=True)
        for name, data in files.items():
            (args.output / name).write_bytes(data)
        print(json.dumps({'written_files': len(files), 'network_calls': 0}))
    else:
        print(json.dumps(verify_supplement(path=args.output)))


if __name__ == '__main__':
    main()
