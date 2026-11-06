#!/usr/bin/env python3
"""Separately fitted policies: independent offline fitting and paired scorecard reconstruction.

Uses committed IDs, native labels, hashes and predictions only. No source text or network.
The TypeScript producer fits with the existing project calibrator; this implementation
independently checks its chosen cutoffs before scoring the frozen policies.
"""
import argparse
import bisect
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parents[1]
PREP = Path('eval/results/calibration-preparation-2026-11-05')
STUDY = Path('eval/results/separate-calibration-2026-11-05')
ARCHIVE = Path('eval/results/hosted-models-with-glide-2026-11-05/observations.redacted.jsonl.gz')
DATASETS = ('vitaminc', 'scifact', 'contractnli', 'mnli', 'findver')
REPLICATES = 20000
SEED = 20261105
SUPPORTS = (0, .2, .4, .5, .6, .7, .8, .9, .95, 1, 1.001)
METRICS = ('precision', 'recall', 'f1', 'clear_negative_coverage', 'false_clear_rate', 'false_clears')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n').encode()


def read(path):
    return json.loads(path.read_bytes())


def observations(path):
    return [json.loads(line) for line in gzip.decompress(path.read_bytes()).splitlines()]


def fitted_policy(rows):
    """Independent equivalent of selectThresholds, including grid order and sentinels."""
    successful = [r for r in rows if r['prediction']['status'] == 'ok']
    points = [(r['prediction']['raw_scores']['contradiction'],
               max(r['prediction']['raw_scores']['consistent'], r['prediction']['raw_scores']['different_scope']),
               r['pair']['gold'] == 'contradiction') for r in successful]
    if not {p[2] for p in points} == {False, True}:
        raise ValueError('Both native classes need observed distributions')
    cuts = sorted({0, 1.000001, *(i / 100 for i in range(101)), *(p[0] for p in points)})
    ordered = sorted(points)
    scores = [p[0] for p in ordered]
    positive_prefix = [0]
    for p in ordered:
        positive_prefix.append(positive_prefix[-1] + p[2])
    eligible = []
    for cut in cuts:
        index = bisect.bisect_left(scores, cut)
        tp = positive_prefix[-1] - positive_prefix[index]
        fp = len(points) - index - tp
        if tp and tp / (tp + fp) >= .95:
            eligible.append((tp, tp / (tp + fp), cut))
    positive = max(eligible)[2] if eligible else 1.000001
    supports = {}
    for support in SUPPORTS:
        values = sorted(p for p in points if p[0] < positive and p[1] >= support)
        prefix = [0]
        for p in values:
            prefix.append(prefix[-1] + p[2])
        supports[support] = ([p[0] for p in values], prefix)
    policy = dict(positive=positive, negative_cut=0, negative_support=1.001)
    best_tn = -1
    for cut in (c for c in cuts if c < positive and c <= 1):
        for support in SUPPORTS:
            values, prefix = supports[support]
            index = bisect.bisect_right(values, cut)
            false_clears = prefix[index]
            tn = index - false_clears
            if not false_clears and tn > best_tn:
                best_tn = tn
                policy = dict(positive=positive, negative_cut=cut, negative_support=support)
    return policy


def remap(row, policy):
    prediction = row['prediction']
    if prediction['status'] != 'ok':
        return row
    raw = prediction['raw_scores']
    verdict = ('contradiction' if raw['contradiction'] >= policy['positive'] else
               'no_contradiction' if raw['contradiction'] <= policy['negative_cut'] and
               max(raw['consistent'], raw['different_scope']) >= policy['negative_support'] else 'uncertain')
    return {**row, 'prediction': {**prediction, 'verdict': verdict}}


def counts(rows):
    result = [0] * 9  # positive, negative, TP, FP, TN, false clear, errors, uncertain, excluded
    for row in rows:
        positive = row['pair']['gold'] == 'contradiction'
        prediction = row['prediction']
        verdict = prediction.get('verdict') if prediction['status'] == 'ok' else None
        result[0] += positive
        result[1] += not positive
        result[2] += positive and verdict == 'contradiction'
        result[3] += not positive and verdict == 'contradiction'
        result[4] += not positive and verdict == 'no_contradiction'
        result[5] += positive and verdict == 'no_contradiction'
        result[6] += prediction['status'] == 'error'
        result[8] += prediction['status'] == 'excluded'
        result[7] += verdict == 'uncertain'
    return result


def measures(c):
    p, n, tp, fp, tn, fc, errors, uncertain, excluded = c
    return dict(selected=p+n, completed=p+n-errors-excluded, positive=p, negative=n, tp=tp, fp=fp, tn=tn,
                false_clears=fc, errors=errors, excluded=excluded, uncertain=uncertain,
                precision=tp/(tp+fp) if tp+fp else None,
                recall=tp/p if p else None,
                f1=2*tp/(p+tp+fp) if p+tp+fp else None,
                clear_negative_coverage=tn/n if n else None,
                false_clear_rate=fc/p if p else None)


def paired(first, second, replicates=REPLICATES, seed=SEED):
    """Same paired source-group percentile bootstrap design as the release supplement."""
    if not first or set(first) != set(second) or replicates < 1:
        raise ValueError('Identical nonempty paired coverage and positive replicate count required')
    groups = defaultdict(lambda: [[], []])
    for pair_id in sorted(first):
        a, b = first[pair_id], second[pair_id]
        if any(a['pair'][f] != b['pair'][f] for f in ('gold', 'native_label', 'group_id')):
            raise ValueError('Paired labels/groups differ')
        group = a['pair']['dataset'] + ':' + a['pair']['group_id']
        groups[group][0].append(a)
        groups[group][1].append(b)
    sufficient = [(counts(groups[g][0]), counts(groups[g][1])) for g in sorted(groups)]
    points = [measures(counts(side.values())) for side in (first, second)]
    differences = {key: [] for key in METRICS}
    rng = random.Random(seed)
    for _ in range(replicates):
        totals = [[0]*9, [0]*9]
        for _ in sufficient:
            selected = sufficient[rng.randrange(len(sufficient))]
            for side in (0, 1):
                for index, count in enumerate(selected[side]):
                    totals[side][index] += count
        a, b = map(measures, totals)
        for key in differences:
            if a[key] is not None and b[key] is not None:
                differences[key].append(a[key]-b[key])
    intervals = {}
    for key, values in differences.items():
        values.sort()
        a, b = (point[key] for point in points)
        intervals[key] = dict(calibrated=a, shipped=b, difference=a-b if a is not None and b is not None else None,
                              percentile_95=[values[math.floor((len(values)-1)*q)] for q in (.025, .975)] if values else None,
                              valid_replicates=len(values))
    return dict(selected_pairs=len(first), source_groups=len(groups), metrics=intervals)


def checked_cohort(values, expected, models):
    cohorts = defaultdict(dict)
    registry = {r['id']: r for r in expected}
    for observation in values:
        model, row = observation['model'], observation['row']
        pair = row['pair']
        if model not in models or pair['id'] not in registry or pair['id'] in cohorts[model]:
            raise ValueError('Unexpected/duplicate observation')
        frozen = registry[pair['id']]
        for key in ('dataset', 'group_id', 'gold', 'native_label'):
            if pair[key] != frozen[key]:
                raise ValueError('Observation label/source mismatch')
        for key in ('claim_sha256', 'evidence_sha256'):
            if row['text_provenance'][key] != frozen[key]:
                raise ValueError('Observation text hash mismatch')
        if pair['claim'] != pair['evidence'] or pair['claim'] != '[not archived: input text hashes below]':
            raise ValueError('Source text must be redacted')
        prediction = row['prediction']
        if prediction['pair_id'] != pair['id'] or prediction['pass'] != 1:
            raise ValueError('Prediction attribution mismatch')
        if prediction['status'] == 'ok':
            raw = prediction['raw_scores']
            if prediction['model'] != model or set(raw) != {'contradiction', 'consistent', 'different_scope', 'insufficient_context'}:
                raise ValueError('Successful model/score shape mismatch')
            if not all(math.isfinite(v) and 0 <= v <= 1 for v in raw.values()) or not math.isclose(sum(raw.values()), 1, abs_tol=.001):
                raise ValueError('Invalid distribution')
            shipped = dict(positive=.8, negative_cut=.2, negative_support=.8)
            if prediction['verdict'] != remap(row, shipped)['prediction']['verdict']:
                raise ValueError('Shipped-policy mapping mismatch')
        elif prediction['status'] not in ('error', 'excluded') or any(k in prediction for k in ('verdict', 'raw_scores', 'probabilities')):
            raise ValueError('Invalid failed observation')
        cohorts[model][pair['id']] = row
    if set(cohorts) != set(models) or any(set(c) != set(registry) for c in cohorts.values()):
        raise ValueError('Incomplete model/pair coverage')
    return cohorts


def analyze(root=ROOT):
    prep, study = root/PREP, root/STUDY
    protocol = read(prep/'protocol.json')
    receipt = read(study/'policy-freeze.json')
    if digest((prep/'cohort-registry.json').read_bytes()) != protocol['registry_sha256']:
        raise ValueError('Cohort registry changed')
    if digest((prep/'protocol.json').read_bytes()) != receipt['protocol_sha256']:
        raise ValueError('Protocol changed')
    for name, key in [('policies.json', 'policies_sha256'), ('fit-observations.redacted.jsonl.gz', 'fit_observations_sha256'), ('fitting-sources.json.gz', 'fitting_sources_sha256')]:
        if digest((study/name).read_bytes()) != receipt[key]:
            raise ValueError('Frozen fitting artifact changed: '+name)
    sources = json.loads(gzip.decompress((study/'fitting-sources.json.gz').read_bytes()))
    if set(sources) != set(receipt['source_files']) or any(digest(text.encode()) != receipt['source_files'][p] for p, text in sources.items()):
        raise ValueError('Fitting source snapshot mismatch')
    models = [m['model'] for m in protocol['accounting']['models']]
    registry = read(prep/'cohort-registry.json')
    policies = read(study/'policies.json')
    if policies['selection_uses_validation'] is not False or set(policies['policies']) != set(models):
        raise ValueError('Policy model coverage/validation selection mismatch')
    cohorts = {}
    for role in ('fit', 'validation'):
        cohorts[role] = checked_cohort(observations(study/f'{role}-observations.redacted.jsonl.gz'), registry['rows'][role], models)
    for model in models:
        rows=list(cohorts['fit'][model].values())
        fitted=policies['policies'][model]
        if fitted_policy(rows) != fitted['policy']:
            raise ValueError('Independent fitted thresholds disagree: '+model)
        observed=[r for r in rows if r['prediction']['status']=='ok']
        if (fitted['selected_pairs'],fitted['observed_distributions'],fitted['missing_distributions']) != (len(rows),len(observed),len(rows)-len(observed)):
            raise ValueError('Fitting coverage counts disagree')
        if fitted['precision_target'] != .95 or fitted['negative_fit_constraint'] != 'zero_training_false_clears':
            raise ValueError('Fitting objectives disagree')
        positives=sum(r['pair']['gold']=='contradiction' for r in observed)
        expected_cuts=sorted({0,1.000001,*(i/100 for i in range(101)),*(r['prediction']['raw_scores']['contradiction'] for r in observed)})
        if [r['threshold'] for r in fitted['frontier']] != expected_cuts:
            raise ValueError('Fitted cutoff frontier differs')
        eligible=False
        for point in fitted['frontier']:
            selected=[r for r in observed if r['prediction']['raw_scores']['contradiction']>=point['threshold']]
            tp=sum(r['pair']['gold']=='contradiction' for r in selected);fp=len(selected)-tp
            expected=dict(threshold=point['threshold'],tp=tp,fp=fp,precision=tp/(tp+fp) if tp+fp else None,recall=tp/positives)
            if point != expected: raise ValueError('Fitted frontier counts differ')
            eligible=eligible or bool(tp and tp/(tp+fp)>=.95)
        if fitted['precision_target_met'] != eligible: raise ValueError('Fit precision-target status differs')
    validation_dispatch = read(study/'validation-dispatch.json')
    if validation_dispatch['policy_freeze_sha256'] != digest((study/'policy-freeze.json').read_bytes()):
        raise ValueError('Validation did not bind frozen policies')
    if validation_dispatch['started_at'] <= receipt['frozen_at']:
        raise ValueError('Validation started before policy freeze')
    if digest((root/ARCHIVE).read_bytes()) != protocol['archive']['sha256']:
        raise ValueError('Original archive changed')
    archived = defaultdict(dict)
    for observation in observations(root/ARCHIVE):
        if observation['dataset'] in DATASETS:
            model, row = observation['model'], observation['row']
            if row['pair']['id'] in archived[model]:
                raise ValueError('Duplicate archived pair')
            archived[model][row['pair']['id']] = row
    if set(archived) != set(models) or any(len(c) != 880 for c in archived.values()):
        raise ValueError('Incomplete original public cohorts')
    cohorts['archive'] = archived
    scorecards = []
    for role in ('fit', 'validation', 'archive'):
        for model in models:
            original = cohorts[role][model]
            policy = policies['policies'][model]['policy']
            datasets = DATASETS if role == 'archive' else DATASETS[:-1]
            for dataset in (*datasets, 'all'):
                selected = {k:r for k,r in original.items() if dataset == 'all' or r['pair']['dataset'] == dataset}
                calibrated = {k:remap(r, policy) for k,r in selected.items()}
                a, b = (measures(counts(rows.values())) for rows in (calibrated, selected))
                transitions=Counter()
                for key, original_row in selected.items():
                    if original_row['pair']['gold']=='contradiction':
                        before=original_row['prediction'].get('verdict',original_row['prediction']['status'])
                        after=calibrated[key]['prediction'].get('verdict',calibrated[key]['prediction']['status'])
                        transitions[before+' -> '+after]+=1
                recovered=sum(v for k,v in transitions.items() if not k.startswith('contradiction -> ') and k.endswith(' -> contradiction'))
                lost=sum(v for k,v in transitions.items() if k.startswith('contradiction -> ') and not k.endswith(' -> contradiction'))
                missed=a['positive']-b['tp']
                scorecards.append(dict(role=role, model=model, dataset=dataset,
                                       assessment_status='no_successful_assessments' if not a['completed'] else 'complete_with_failures' if a['errors']+a['excluded'] else 'complete',
                                       positive_transitions=dict(sorted(transitions.items())),
                                       recovered_shipped_misses=recovered, lost_shipped_detections=lost,
                                       fraction_of_shipped_misses_recovered=recovered/missed if missed else None,
                                       calibrated=a, shipped=b,
                                       delta={key:a[key]-b[key] if a[key] is not None and b[key] is not None else None for key in METRICS},
                                       paired=None if role == 'fit' or dataset == 'all' else paired(calibrated, selected)))
    crosscheck=read(study/'metric-crosscheck.json')
    cross_sources=json.loads(gzip.decompress((study/'metric-crosscheck-sources.json.gz').read_bytes()))
    if set(cross_sources)!=set(crosscheck['source_files']) or any(digest(text.encode())!=crosscheck['source_files'][p] for p,text in cross_sources.items()):
        raise ValueError('Independent metric source snapshot differs')
    expected={(r['role'],r['model'],r['dataset']):r for r in scorecards}
    if len(crosscheck['scorecards'])!=len(expected):raise ValueError('Metric crosscheck coverage differs')
    seen=set()
    for row in crosscheck['scorecards']:
        key=(row['role'],row['model'],row['dataset'])
        if key in seen or key not in expected: raise ValueError('Duplicate/unknown metric crosscheck')
        seen.add(key)
        for policy in ('shipped','calibrated'):
            if row[policy]!=expected[key][policy]:raise ValueError('Independent TypeScript metric engine disagrees: '+str(key))
    total_observations = sum(len(c) for role in ('fit', 'validation') for c in cohorts[role].values())
    positive_ids={k for k,r in next(iter(archived.values())).items() if r['pair']['gold']=='contradiction'}
    caught={k for model,rows in archived.items() for k,r in rows.items() if k in positive_ids and r['prediction'].get('verdict')=='contradiction'}
    calibrated_caught={k for model,rows in archived.items() for k,r in rows.items() if k in positive_ids and remap(r,policies['policies'][model]['policy'])['prediction'].get('verdict')=='contradiction'}
    union=dict(native_positive_pairs=len(positive_ids), shipped_caught=len(caught), calibrated_caught=len(calibrated_caught),
               previously_never_caught=len(positive_ids-caught), previously_never_caught_recovered=len((positive_ids-caught)&calibrated_caught),
               qualification='Positive-only oracle union; no deployed ensemble or ensemble precision claim')
    return dict(schema_version=1, kind='separately-fitted-hosted-calibration-v1',
                positive_union_diagnostic=union,
                qualification='not_assessed', service_change=False, policies=policies['policies'],
                protocol_sha256=receipt['protocol_sha256'], policy_freeze_sha256=digest((study/'policy-freeze.json').read_bytes()),
                observations=total_observations, reservation_usd=total_observations*.002, actual_billed_cost=None,
                bootstrap=dict(replicates=REPLICATES, seed=SEED, unit='paired source group',
                               interval='pointwise exploratory percentile 95%; no multiplicity correction; fixed fitted policy, not fitting uncertainty'),
                interpretation='Separate-group calibration on previously used public datasets; archived 880 are reused development samples. Finance is transfer only. No production precision guarantee.',
                adjudication_status='packet prepared, not yet labelled', scorecards=scorecards)


def pct(value):
    return 'n/a' if value is None else f'{100*value:.1f}'


def render(result):
    lines = ['# Separately fitted nine-model calibration', '',
             '[Protocol](../calibration-preparation-2026-11-05/protocol.json) · [Approval](../calibration-preparation-2026-11-05/approval.json) · [Frozen policies](policy-freeze.json) · [Jev validation incident](../../../docs/evaluations/separate-calibration-validation-incident-2026-11-06.md)', '',
             'Offline verdict remapping only. The service, original archives and shipped-policy scorecards are unchanged. Thresholds were fitted on separate groups from four public train datasets, frozen before disjoint validation inference, then applied without new inference to the archived 880 pairs. These are reused development samples, not a fresh held-out test. Finance is transfer only.', '',
             f"Measured: {result['observations']:,} new pair observations; ${result['reservation_usd']:.2f} operator reservation at $0.002/call. Actual billed cost is unknown. One sequential pass, 3,000 ms kernel deadline, no retries or fallbacks. Errors remain in recall/coverage denominators.", '',
             'Positive cutoffs maximize fit recall at ≥95% observed fit precision. Negative gates maximize clear-negative count with zero fit false clears. This does not guarantee validation or population precision, or zero validation false clears. Raw four-way outputs remain preserved; operating-point fitting does not turn them into calibrated truth probabilities.', '',
             '## Frozen policies', '', 'Displayed cutoffs are rounded; use full precision from `policies.json` for reproduction. A positive cutoff above 1 disables positive verdicts; negative support above 1 disables negative verdicts. Raw scores are unchanged.', '', '| Model | Positive cutoff | Negative cutoff | Negative support | Fit distributions / selected |', '| --- | ---: | ---: | ---: | ---: |']
    archive_all=[r for r in result['scorecards'] if r['role']=='archive' and r['dataset']=='all']
    validation_all=[r for r in result['scorecards'] if r['role']=='validation' and r['dataset']=='all']
    recovered=sum(r['recovered_shipped_misses'] for r in archive_all)
    lost=sum(r['lost_shipped_detections'] for r in archive_all)
    missed=sum(r['shipped']['positive']-r['shipped']['tp'] for r in archive_all)
    improved=sum(r['delta']['recall']>0 for r in archive_all)
    declined=sum(r['delta']['recall']<0 for r in archive_all)
    unmeasured=[r['model'] for r in validation_all if not r['calibrated']['completed']]
    disabled=[model for model,fitted in result['policies'].items() if fitted['policy']['negative_support']>1]
    point_targets={}
    for role in ('validation','archive'):
        eligible=[r for r in result['scorecards'] if r['role']==role and r['dataset']!='all']
        point_targets[role]=sum(r['calibrated']['completed']>0 and r['calibrated']['precision'] is not None and r['calibrated']['precision']>=.95 and r['calibrated']['recall']>=.9 and r['calibrated']['clear_negative_coverage']>=.85 for r in eligible)
    findings=['## Findings', '',
              f'- On the archived probabilities, separately fitted policies recover **{recovered}/{missed} ({100*recovered/missed:.1f}%) previously missed native-positive model–pair outcomes**, while losing **{lost} previously detected outcomes**. Pooled recall improves for {improved} models and declines for {declined}; the rest tie. These correlated outcomes reuse 279 native-positive pairs across nine models.',
              f'- The zero-fit-false-clear budget disables negative verdicts for **{", ".join(disabled) or "no models"}**. The recall/precision trade-off alone does not describe the resulting negative coverage.',
              f'- All three point targets (precision ≥95%, recall ≥90%, negative coverage ≥85%) hold on **{point_targets["validation"]} validation model/domain scorecards** and **{point_targets["archive"]} archived model/domain scorecards**. These counts do not establish confidence-bound targets or production qualification.',
              f'- Validation semantic quality is **unmeasured** for **{", ".join(unmeasured) or "no models"}** because no assessments succeeded. Error counts remain in the execution-inclusive denominators; the incident is not hidden by dropping those rows.', '']
    lines[2:2]=findings
    for model, fitted in result['policies'].items():
        p=fitted['policy']
        lines.append(f"| {model} | {p['positive']:.6g} | {p['negative_cut']:.6g} | {p['negative_support']:.6g} | {fitted['observed_distributions']} / {fitted['selected_pairs']} |")
    lines += ['', '## Recovery of shipped-policy misses', '',
              'These native-positive transitions use the frozen policies and the same archived probabilities. Recovered misses isolate verdict-rule changes; they do not prove service-contract truth. Losses and precision changes must be considered alongside gains.', '',
              '| Model | Previously missed | Recovered | Recovered % | Existing detections lost | Net recall change, pp |', '| --- | ---: | ---: | ---: | ---: | ---: |']
    for row in result['scorecards']:
        if row['role']=='archive' and row['dataset']=='all':
            lines.append(f"| {row['model']} | {row['shipped']['positive']-row['shipped']['tp']} | {row['recovered_shipped_misses']} | {pct(row['fraction_of_shipped_misses_recovered'])} | {row['lost_shipped_detections']} | {pct(row['delta']['recall'])} |")
    union=result['positive_union_diagnostic']
    lines += ['', f"Positive-only oracle union: shipped policies catch {union['shipped_caught']}/{union['native_positive_pairs']}; calibrated policies catch {union['calibrated_caught']}/{union['native_positive_pairs']}. The calibrated union recovers {union['previously_never_caught_recovered']} of the {union['previously_never_caught']} previously never-caught pairs. This is not a deployed ensemble and establishes no ensemble precision."]
    for role, title in [('validation', 'Disjoint validation'), ('archive', 'Archived development samples')]:
        lines += ['', '## '+title, '', 'Each cell shows shipped → calibrated. Full native-gold confusion counts and paired metric intervals are in `scorecards.json`. If a model has zero successful assessments, its execution-inclusive recall is zero while semantic quality is unmeasured; do not interpret that as semantic errors on every pair. The pooled row is descriptive and dataset-composition dependent.', '', '| Dataset | Model | Precision % | Recall % | Negative coverage % | False clears | Errors |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |']
        for row in result['scorecards']:
            if row['role'] != role: continue
            a,b=row['shipped'],row['calibrated']
            lines.append(f"| {row['dataset']} | {row['model']} | {pct(a['precision'])} → {pct(b['precision'])} | {pct(a['recall'])} → {pct(b['recall'])} | {pct(a['clear_negative_coverage'])} → {pct(b['clear_negative_coverage'])} | {a['false_clears']} → {b['false_clears']} | {b['errors']} |")
    lines += ['', '## Paired changes on the archived samples', '',
              'Calibrated minus shipped, percentage points, with 95% source-group percentile intervals (20,000 resamples). These pointwise exploratory intervals condition on the fitted policy and the fixed provider outputs; they do not include fitting uncertainty, provider repeatability, training contamination or multiplicity correction. Undefined bootstrap precision is omitted from that metric only; valid replicate counts are recorded.', '',
              '| Dataset | Model | Precision Δ [95%] | Recall Δ [95%] | Negative coverage Δ [95%] |', '| --- | --- | ---: | ---: | ---: |']
    def interval(value):
        ci=value['percentile_95']
        return 'n/a' if ci is None else f"{pct(value['difference'])} [{pct(ci[0])}, {pct(ci[1])}]"
    for row in result['scorecards']:
        if row['role']=='archive' and row['dataset']!='all':
            m=row['paired']['metrics']
            lines.append(f"| {row['dataset']} | {row['model']} | {interval(m['precision'])} | {interval(m['recall'])} | {interval(m['clear_negative_coverage'])} |")
    lines += ['', '## Reproduction and limits', '',
              'Run `python3 -B scripts/verify-calibration-study.py`. Python standard library only: it verifies inventories, frozen source snapshots and protocol/approval receipts, independently refits thresholds from redacted fit predictions, cross-checks point metrics against the existing TypeScript metric engine, and reconstructs every scorecard and paired interval without network access, credentials or original dataset text. The existing release verifier remains unchanged and still verifies the original published summary.', '',
              'Packet status: **packet prepared, not yet labelled**. No AI adjudication or service-contract labels were added. Native dataset labels remain unchanged. All nine models are included whether calibration helps or hurts. Prompts were unchanged; their prior development was Jev-only. These public datasets may appear in model training. Neither the original comparison nor this study measures repeated inference or input-order robustness. Freeze-before-validation ordering is recorded by the operator dispatch receipt, not an independent timestamp authority. Source snapshots freeze our code, not provider weights behind unversioned aliases; reported model/revision metadata is retained in the checkpoints. The serial model order also limits inference about provider-load effects on timing and failures. No service policy or default-model promotion follows automatically.', '']
    return '\n'.join(lines).encode()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args=parser.parse_args()
    result=analyze()
    outputs={'scorecards.json':encoded(result), 'README.md':render(result)}
    for name,data in outputs.items():
        path=ROOT/STUDY/name
        if args.write:
            with path.open('xb') as handle: handle.write(data)
        elif path.read_bytes()!=data:
            raise ValueError('Recomputed artifact differs: '+name)
    print(json.dumps({'verified_calibration_models':len(result['policies']), 'verified_calibration_observations':result['observations'],
                      'verified_calibration_scorecards':len(result['scorecards']),
                      'verified_calibration_paired_comparisons':sum(r['paired'] is not None for r in result['scorecards']),
                      'bootstrap_replicates_per_comparison':REPLICATES, 'network_calls':0, 'raw_dataset_text_required':False}))


if __name__ == '__main__':
    main()
