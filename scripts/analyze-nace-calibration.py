#!/usr/bin/env python3
"""Publish/verify the two-model Nace calibration extension without inference or raw text.

Publish: --archive DIR --write --private-run-dir ignored/run/path
Verify: --archive DIR (requires only committed redacted artifacts)
"""
import argparse
import collections
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
import runpy
import random
import sys

ROOT = Path(__file__).resolve().parents[1]
PREP = ROOT / 'eval/results/calibration-preparation-2026-11-05'
BENCH = ROOT / 'eval/results/nace-2026-11-06'
PRIOR = ROOT / 'eval/results/calibration-followup-2026-11-06'
BASE = runpy.run_path(str(ROOT / 'scripts/analyze-calibration-study.py'), run_name='nace_calibration_base')
FOLLOW = runpy.run_path(str(ROOT / 'scripts/analyze-calibration-followup.py'), run_name='nace_negative_base')
MODELS = ('drex-max', 'drex-max-finance')
DATASETS = ('vitaminc', 'scifact', 'contractnli', 'mnli')
RATES = (0, .005, .01, .02, .05)
REPLICATES = 20000
SEED = 20261106
read, rows_from, remap, counts, measures, paired = (BASE[k] for k in ('read', 'observations', 'remap', 'counts', 'measures', 'paired'))
sha = lambda b: hashlib.sha256(b).hexdigest()
encoded = lambda v: (json.dumps(v, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode()
close = lambda a, b: a is None and b is None or a is not None and b is not None and abs(a-b) <= 1e-10


def inventory(folder):
    hashes = read(folder / 'archive-sha256.json')
    for name, expected in hashes.items():
        assert Path(name).name == name and sha((folder/name).read_bytes()) == expected, name
    return hashes


def status_rows(text, expected):
    values = [json.loads(s) for s in text.splitlines()]
    assert len(values) == expected
    for i, value in enumerate(values):
        assert set(value) == {'sequence', 'status'} and value['sequence'] == i+1
        s = value['status']
        assert s is None or type(s) is int and 100 <= s <= 599
        assert s not in (401, 402, 403, 429), 'Account/rate rejection invalidates a completed phase'
    return values


def verify_inputs(folder):
    protocol = read(folder/'protocol.json')
    assert tuple(protocol['models']) == MODELS
    assert protocol['planned_calls'] == 6400 and protocol['max_calls'] >= 6400
    reservation, cap = protocol['reservation_per_call_usd'], protocol['reservation_cap_usd']
    assert math.isfinite(reservation) and reservation > 0 and math.isfinite(cap) and cap > 0
    assert 6400 * reservation <= cap
    assert (protocol['profile'], protocol['timeout_ms'], protocol['passes'], protocol['batch_size'], protocol['concurrency']) == ('balanced-v1', 3000, 1, 1, 1)
    assert protocol['presentation'] == 'original' and protocol['retries'] == 0 and protocol['fallback'] is False
    assert protocol['interval_ms'] >= 550 and protocol['cross_cohort_gap_ms'] >= 550
    assert protocol['sensitivity_rates'] == list(RATES)
    assert protocol['recorded_before_inference'] is True
    original = read(PREP/'protocol.json')
    assert protocol['manifests'] == original['manifests']
    assert sha((PREP/'protocol.json').read_bytes()) == protocol['parent_preparation']['protocol_sha256']
    assert sha((PREP/'cohort-registry.json').read_bytes()) == original['registry_sha256'] == protocol['parent_preparation']['registry_sha256']
    assert sha((BENCH/'archive-sha256.json').read_bytes()) == protocol['benchmark']['archive_sha256']
    assert sha((PRIOR/'archive-sha256.json').read_bytes()) == protocol['prior_followup_archive_sha256']
    inventory(BENCH); inventory(PRIOR)
    snapshot = json.loads(gzip.decompress((folder/'execution-sources.json.gz').read_bytes()))
    assert set(snapshot) == set(protocol['source_files'])
    assert all(sha(text.encode()) == protocol['source_files'][path] for path, text in snapshot.items())
    for path in ('src/kernel/index.ts', 'src/providers/transport.ts', 'src/providers/response.ts', 'src/contracts/limits.ts', 'eval/metrics.ts', 'eval/calibration-study/scoring.ts', 'eval/iteration/calibrate.ts'):
        if path in original['source_files']:
            assert protocol['source_files'][path] == original['source_files'][path], path
    registry = read(PREP/'cohort-registry.json')['rows']
    for key in ('group_id', 'content_sha256'):
        assert not {r[key] for r in registry['fit']} & {r[key] for r in registry['validation']}
    assert not {(r['dataset'],r['source_id']) for r in registry['fit']} & {(r['dataset'],r['source_id']) for r in registry['validation']}
    cohorts, statuses = {}, []
    for role, size in (('fit',2512), ('validation',688)):
        observations = rows_from(folder/f'{role}-observations.redacted.jsonl.gz')
        cohorts[role] = BASE['checked_cohort'](observations, registry[role], list(MODELS))
        checkpoints = json.loads(gzip.decompress((folder/f'{role}-checkpoints.json.gz').read_bytes()))
        assert set(checkpoints) == set(MODELS)
        for model in MODELS:
            saved = checkpoints[model]
            for name in ('predictions', 'metadata', 'http_status'):
                assert sha(saved[name+'_utf8'].encode()) == saved[name+'_sha256']
            predictions = [json.loads(s) for s in saved['predictions_utf8'].splitlines()]
            selected = list(cohorts[role][model].values())
            assert predictions == [r['prediction'] for r in selected]
            assert len(selected) == size
            for p in predictions:
                if p['status'] == 'ok':
                    assert p['reported_model'] == model and p['provider'] == 'nace'
                    assert p['prompt_version'] == 'pair-relation-v1' and p['threshold_version'] == 'evaluation-0.8-0.2-v1'
            meta = json.loads(saved['metadata_utf8'])
            assert meta['model'] == model and meta['backend'] == 'nace' and meta['manifest_sha256'] == protocol['manifests'][role]['sha256']
            assert meta['expected_pair_observations'] == size
            assert len(meta['selected_pair_ids']) == len(set(meta['selected_pair_ids'])) == size
            assert set(meta['selected_pair_ids']) == set(cohorts[role][model])
            for k, v in dict(profile='balanced-v1',passes=1,presentation='original',batch_size=1,concurrency=1,timeout_ms=3000,interval_ms=protocol['interval_ms']).items():
                assert meta['source_protocol'][k] == v
            codes = status_rows(saved['http_status_utf8'], size-sum(p['status']=='excluded' for p in predictions))
            statuses.append(dict(model=model, role=role, selected=size,
                                 counts=dict(collections.Counter(str(v['status']) for v in codes)),
                                 error_codes=dict(collections.Counter(r['prediction'].get('error_code','unknown') for r in selected if r['prediction']['status']!='ok'))))
    freeze = read(folder/'policy-freeze.json')
    for name, field in [('policies.json','policies_sha256'),('protocol.json','protocol_sha256'),('fit-observations.redacted.jsonl.gz','fit_observations_sha256'),('fit-checkpoints.json.gz','fit_checkpoints_sha256')]:
        assert sha((folder/name).read_bytes()) == freeze[field]
    assert freeze['validation_inference_started'] is False
    execution = read(folder/'execution.json')
    assert execution['publication_paths_redacted'] is True
    assert len(execution['original_execution_sha256']) == 64
    completed = execution['completed']
    assert [(r['role'],r['model']) for r in completed] == [(role,m) for role in ('fit','validation') for m in MODELS]
    assert execution['total_assessments'] == sum(r['pairs'] for r in completed) == 6400
    frozen_at = datetime.fromisoformat(freeze['frozen_at'].replace('Z','+00:00'))
    for r in completed:
        assert set(r) == {'model','role','pairs','errors','started_at','completed_at','prefix_sha256'}
        assert len(r['prefix_sha256']) == 64
        start = datetime.fromisoformat(r['started_at'].replace('Z','+00:00'))
        end = datetime.fromisoformat(r['completed_at'].replace('Z','+00:00'))
        assert start <= end
        assert end <= frozen_at if r['role']=='fit' else start >= frozen_at
        assert r['pairs'] == len(cohorts[r['role']][r['model']])
        assert r['errors'] == sum(row['prediction']['status']!='ok' for row in cohorts[r['role']][r['model']].values())
    policies = read(folder/'policies.json')
    assert policies['selection_uses_validation'] is False and set(policies['policies']) == set(MODELS)
    for model, entry in policies['policies'].items():
        rows = list(cohorts['fit'][model].values())
        zero = BASE['fitted_policy'](rows)
        shipped = measures(counts(rows))
        assert entry['selected_pairs'] == 2512 and shipped['positive'] == entry['positive_fit_pairs'] == 771
        assert entry['positive'] == zero['positive']
        assert entry['precision_target_met'] == (zero['positive'] <= 1)
        assert entry['primary_budget'] == shipped['false_clears']
        assert set(entry['variants']) == {'primary',*(f'rate_{r:g}' for r in RATES)}
        for variant, fitted in entry['variants'].items():
            allowance = shipped['false_clears'] if variant=='primary' else int(float(variant.removeprefix('rate_'))*771)
            assert fitted['allowed_fit_false_clears'] == allowance
            assert fitted['policy'] == FOLLOW['fit_negative'](rows,zero['positive'],allowance)
            assert measures(counts(remap(r,fitted['policy']) for r in rows))['false_clears'] <= allowance
            if variant=='rate_0': assert fitted['policy'] == zero
    benchmarks = collections.defaultdict(dict)
    for observation in rows_from(BENCH/'observations.redacted.jsonl.gz'):
        if observation['model'] in MODELS and observation['dataset'] in (*DATASETS,'findver'):
            benchmarks[observation['model']][observation['row']['pair']['id']] = observation['row']
    assert set(benchmarks) == set(MODELS) and all(len(v)==880 for v in benchmarks.values())
    cohorts['archive'] = benchmarks
    return protocol, policies['policies'], cohorts, statuses


def paired_calibration(first, second, replicates=REPLICATES, seed=SEED):
    """Same resamples as BASE.paired; pack bounded integer counters to avoid nested Python sums."""
    if not first or set(first) != set(second) or replicates < 1:
        raise ValueError('Identical nonempty paired coverage and positive replicate count required')
    groups = collections.defaultdict(lambda: [[], []])
    for pair_id in sorted(first):
        a, b = first[pair_id], second[pair_id]
        if any(a['pair'][key] != b['pair'][key] for key in ('gold', 'native_label', 'group_id')):
            raise ValueError('Paired labels/groups differ')
        group = a['pair']['dataset'] + ':' + a['pair']['group_id']
        groups[group][0].append(a); groups[group][1].append(b)
    ordered = [groups[g] for g in sorted(groups)]
    # Every field is a count <= sampled pairs. This width prevents carries even if
    # every draw selects the largest group; integer addition then sums all fields at once.
    width = (len(ordered) * max(len(g[0]) for g in ordered)).bit_length()
    mask = (1 << width)-1
    packed = [sum(value << (i*width) for i,value in enumerate(counts(g[0])+counts(g[1]))) for g in ordered]
    points = [measures(counts(side.values())) for side in (first,second)]
    differences = {key: [] for key in BASE['METRICS']}
    rng = random.Random(seed)
    for _ in range(replicates):
        total = sum(packed[rng.randrange(len(packed))] for _ in packed)
        unpacked = [(total >> (i*width)) & mask for i in range(18)]
        a,b = measures(unpacked[:9]),measures(unpacked[9:])
        for key, values in differences.items():
            if a[key] is not None and b[key] is not None:
                values.append(a[key]-b[key])
    intervals = {}
    for key,values in differences.items():
        values.sort();a,b = (point[key] for point in points)
        intervals[key] = dict(calibrated=a,shipped=b,difference=a-b if a is not None and b is not None else None,
                              percentile_95=[values[math.floor((len(values)-1)*q)] for q in (.025,.975)] if values else None,
                              valid_replicates=len(values))
    return dict(selected_pairs=len(first),source_groups=len(groups),metrics=intervals)


def analyze(folder):
    protocol, policies, cohorts, statuses = verify_inputs(folder)
    cards = []
    for role in ('fit','validation','archive'):
        datasets = (*DATASETS,'findver') if role=='archive' else DATASETS
        for model in MODELS:
            for dataset in (*datasets,'all'):
                selected = {k:r for k,r in cohorts[role][model].items() if dataset=='all' or r['pair']['dataset']==dataset}
                baseline = measures(counts(selected.values()))
                for variant, fitted in policies[model]['variants'].items():
                    mapped = {k:remap(r,fitted['policy']) for k,r in selected.items()}
                    calibrated = measures(counts(mapped.values()))
                    cards.append(dict(role=role,model=model,dataset=dataset,variant=variant,shipped=baseline,calibrated=calibrated))
    cross = read(folder/'metric-crosscheck.json')['scorecards']
    by_key = {tuple(c[k] for k in ('role','model','dataset','variant')):c for c in cards}
    assert len(cross) == len(by_key) == len(cards) == 192
    for c in cross:
        expected = by_key[tuple(c[k] for k in ('role','model','dataset','variant'))]
        for method in ('shipped','calibrated'):
            assert set(c[method]) == set(expected[method])
            assert all(close(v,expected[method][k]) for k,v in c[method].items())
    comparisons = []
    comparator = 'perplexity/pplx-decider-v1.2'
    prior_validation = {o['row']['pair']['id']:o['row'] for o in rows_from(ROOT/'eval/results/separate-calibration-2026-11-05/validation-observations.redacted.jsonl.gz') if o['model']==comparator}
    prior_policy = read(PRIOR/'negative-policies.json')['policies'][comparator]['primary']['policy']
    prior_mapped = {k:remap(r,prior_policy) for k,r in prior_validation.items()}
    for model in MODELS:
        primary = policies[model]['variants']['primary']['policy']
        zero = policies[model]['variants']['rate_0']['policy']
        for role in ('validation','archive'):
            for dataset in (*((*DATASETS,'findver') if role=='archive' else DATASETS),'all'):
                # Archive/all is a mixed-domain diagnostic, not an aggregate quality rank.
                original = {k:r for k,r in cohorts[role][model].items() if dataset=='all' or r['pair']['dataset']==dataset}
                first = {k:remap(r,primary) for k,r in original.items()}
                for control, second in [('shipped',original),('zero_budget',{k:remap(r,zero) for k,r in original.items()})]:
                    comparisons.append(dict(model=model,role=role,dataset=dataset,control=control,
                                            result=paired_calibration(first,second,replicates=REPLICATES,seed=SEED)))
                if role=='validation':
                    second = {k:r for k,r in prior_mapped.items() if dataset=='all' or r['pair']['dataset']==dataset}
                    comparisons.append(dict(model=model,role=role,dataset=dataset,control='decider_primary',
                                            result=paired_calibration(first,second,replicates=REPLICATES,seed=SEED)))
    old_cards = read(PRIOR/'metric-crosscheck.json')['scorecards']
    prior_points = [dict(model=c['model'],**c['calibrated']) for c in old_cards if c['role']=='validation' and c['dataset']=='all' and c['variant']=='primary']
    return dict(schema_version=1,models=list(MODELS),new_assessments=6400,policies=policies,scorecards=cards,
                reservation={k:protocol[k] for k in ('max_calls','reservation_per_call_usd','reservation_cap_usd')},
                status_summary=statuses,paired_comparisons=comparisons,bootstrap_replicates=REPLICATES,seed=SEED,
                previous_validation_primaries=prior_points,selection_uses_validation=False,
                reused_public_cohort=True,production_qualification='not_assessed',synthetic_controls=synthetic_controls(policies),
                paired_metric_units={k:('count' if k=='false_clears' else 'fraction') for k in BASE['METRICS']})


def synthetic_controls(policies):
    archived=rows_from(BENCH/'observations.redacted.jsonl.gz')
    results=[]
    for model in MODELS:
        for dataset in ('synthetic-contract',):
            selected=[o['row'] for o in archived if o['model']==model and o['dataset']==dataset]
            assert len(selected)==32
            for variant,entry in policies[model]['variants'].items():
                before=after=uncertain=uncertain_correct=0;regressions=[];improvements=[]
                for row in selected:
                    expected=row['pair']['source_metadata']['expected_verdict']
                    expected='no_contradiction' if expected=='no_contradiction_detected' else expected
                    mapped=remap(row,entry['policy'])
                    old=row['prediction']['status']=='ok' and row['prediction'].get('verdict')==expected
                    new=mapped['prediction']['status']=='ok' and mapped['prediction'].get('verdict')==expected
                    before+=old;after+=new
                    if expected=='uncertain':uncertain+=1;uncertain_correct+=new
                    if old and not new:regressions.append(row['pair']['id'])
                    if new and not old:improvements.append(row['pair']['id'])
                results.append(dict(model=model,dataset=dataset,variant=variant,cases=len(selected),
                                    shipped_correct=before,calibrated_correct=after,expected_uncertain=uncertain,
                                    calibrated_uncertain_correct=uncertain_correct,regression_ids=sorted(regressions),improvement_ids=sorted(improvements)))
    return results


def render(result):
    pct=lambda v:'—' if v is None else f'{100*v:.1f}'
    point=lambda model,role,dataset,variant='primary':next(c for c in result['scorecards'] if (c['model'],c['role'],c['dataset'],c['variant'])==(model,role,dataset,variant))
    text='''# Nace Max calibration extension

Measured November 6, 2026. Drex Max and Drex Max Finance advance from the [five-model fixed-policy benchmark](../nace-2026-11-06/README.md) to separately fitted thresholds. **6,400 new calls:** the original 2,512 fit pairs and 688 group-disjoint validation pairs per model. No inference rerun on the original 880 benchmark pairs; their stored outputs are rescored for transfer, including finance. Every phase has a three-second kernel deadline, one unchanged prompt, original order, isolated pairs, sequential client attempts, free-tier pacing, no retries and no fallback.

__NACE_CALIBRATION_FINDINGS__

## What this study establishes

The model selection followed the Nace benchmark and the earlier nine-model calibration results. This is an exploratory extension on previously studied public train cohorts, **not a newly untouched test** or human-adjudicated contract validation. The two cohorts are group/source/content disjoint. Positive cutoffs and negative policies are fitted using fit outputs only and hash-frozen before any Nace validation call. Validation never chooses or revises a cutoff or budget. No production default, model catalog or threshold changes follow automatically.

The primary maximizes fit clear negatives while allowing no more native-positive false clears than that model's shipped policy made on the same 771 fit positives. This budget definition inherits the earlier post-hoc nine-model follow-up, but is fixed **before Nace fit and validation results**. A fixed 0%, 0.5%, 1%, 2% and 5% allowance grid is sensitivity, not a validation-selected policy. Positive cutoffs target ≥95% observed fit precision; this is a point constraint, not a confidence guarantee. Errors stay misses and never receive invented scores. Budget constraints hold on fit, not automatically on validation. Model-specific budgets compare each model with its own shipped baseline; they are not an equal-risk allowance across models. This fits decision cutoffs: raw probabilities remain unchanged and are not newly calibrated truth probabilities.

Nicia has no commercial relationship with any evaluated model provider. Native public labels can disagree with the service contract; no new human-adjudicated labels are used. Finance remains transfer-only and length-conditioned. Public training contamination remains possible, and the measurements do not reproduce the vendor's broader decision index.

## Frozen policies and fit budgets

| Model | Positive cutoff | Shipped fit false-clear allowance / 771 | Primary negative cut | Primary negative support |
| --- | ---: | ---: | ---: | ---: |
'''
    for model in MODELS:
        entry=result['policies'][model];p=entry['variants']['primary']['policy']
        text+=f"| {model} | {p['positive']:.9g} | {entry['primary_budget']} | {p['negative_cut']:.9g} | {p['negative_support']:.9g} |\n"
    text+='\n## Validation: shipped versus primary\n\nSame 688 selected cases per model: 212 native positives and 476 negatives. Values are percentages. The negative sensitivity grid cannot change positive detections because the positive gate stays fixed and takes precedence.\n\n| Model | Precision, shipped → fitted | Recall, shipped → fitted | Clear negatives, shipped → fitted | False clears, shipped → fitted | Errors |\n| --- | ---: | ---: | ---: | ---: | ---: |\n'
    for model in MODELS:
        c=point(model,'validation','all');a,b=c['shipped'],c['calibrated']
        text+=f"| {model} | {pct(a['precision'])} → {pct(b['precision'])} | {pct(a['recall'])} → {pct(b['recall'])} | {pct(a['clear_negative_coverage'])} → {pct(b['clear_negative_coverage'])} | {a['false_clears']} → {b['false_clears']} | {b['errors']} |\n"
    text+='\n## Comparison with the previous calibrated models\n\nEach model has its own frozen primary policy on the same validation cohort. The earlier nine-model primary was chosen after its zero-budget validation had been seen; this extension inherits that definition prospectively for the Nace calls. Different dates, policy-development histories and model selection prevent a single confirmatory eleven-model ranking.\n\n| Model | Precision | Recall | Clear negatives | False clears / 212 | Errors |\n| --- | ---: | ---: | ---: | ---: | ---: |\n'
    all_points=result['previous_validation_primaries']+[dict(model=m,**point(m,'validation','all')['calibrated']) for m in MODELS]
    for r in all_points:text+=f"| {r['model']} | {pct(r['precision'])} | {pct(r['recall'])} | {pct(r['clear_negative_coverage'])} | {r['false_clears']} | {r['errors']} |\n"
    text+='\n## Primary per-domain validation and archive transfer\n\nTargets 95% precision / 90% recall / 85% negative coverage must hold together on the same scorecard. Point estimates and exploratory bootstrap intervals do not qualify the service contract. Archive/all is a mixed-domain sensitivity diagnostic, not a quality ranking. The 23-pair strict finance subset is not added to the 82-pair denominator.\n\n| Model | Role | Dataset | Precision | Recall | Clear negatives | False clears | Errors | All three point targets |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |\n'
    for c in result['scorecards']:
        if c['role']=='fit' or c['variant']!='primary':continue
        r=c['calibrated'];passed=all(r[k] is not None and r[k]>=v for k,v in [('precision',.95),('recall',.9),('clear_negative_coverage',.85)])
        text+=f"| {c['model']} | {c['role']} | {c['dataset']} | {pct(r['precision'])} | {pct(r['recall'])} | {pct(r['clear_negative_coverage'])} | {r['false_clears']} | {r['errors']} | {'Yes' if passed else 'No'} |\n"
    text+='\n## Validation negative-budget sensitivity\n\nNo grid entry is selected from validation. The zero-budget control remains published, including any lost coverage.\n\n| Model | Variant | Allowed fit false clears | Validation clear negatives | Validation false clears |\n| --- | --- | ---: | ---: | ---: |\n'
    for model in MODELS:
        for variant,entry in result['policies'][model]['variants'].items():
            r=point(model,'validation','all',variant)['calibrated'];text+=f"| {model} | {variant} | {entry['allowed_fit_false_clears']} | {pct(r['clear_negative_coverage'])} | {r['false_clears']} |\n"
    text+='\n## Synthetic contract controls\n\nThe 32 previously published explicit four-way contract cases are replayed after the policy freeze, never used for fitting or reselection. The eight binary smoke fixtures have no explicit four-way expectations and are not assigned new gold labels here. They test known four-way expectations, including abstention, rather than binary proxy labels. They do not establish real-world quality. Regression and improvement IDs for all sensitivity variants are retained in `analysis.json`.\n\n| Model | Suite | Shipped correct | Primary correct | Expected-uncertain cases preserved |\n| --- | --- | ---: | ---: | ---: |\n'
    for c in result['synthetic_controls']:
        if c['variant']=='primary':text+=f"| {c['model']} | {c['dataset']} | {c['shipped_correct']}/{c['cases']} | {c['calibrated_correct']}/{c['cases']} | {c['calibrated_uncertain_correct']}/{c['expected_uncertain']} |\n"
    text+='\n## Paired validation intervals\n\nDifferences are Nace primary minus the named control, in percentage points. Intervals use 20,000 paired source-group resamples, seed 20261106, and match the named metric. These exploratory intervals are unadjusted for multiple comparisons. JSON stores rate differences as fractions and false-clear differences as counts. All per-domain validation and archive controls are in `analysis.json`; an interval containing zero does not establish equivalence.\n\n| Model | Control | Precision difference [95%] | Recall difference [95%] | Clear-negative difference [95%] |\n| --- | --- | ---: | ---: | ---: |\n'
    for c in result['paired_comparisons']:
        if c['role']!='validation' or c['dataset']!='all':continue
        cells=[]
        for key in ('precision','recall','clear_negative_coverage'):
            r=c['result']['metrics'][key];ci=r['percentile_95'];cells.append('—' if ci is None or r['difference'] is None else f"{100*r['difference']:+.1f} [{100*ci[0]:+.1f}, {100*ci[1]:+.1f}]")
        text+=f"| {c['model']} | {c['control']} | "+' | '.join(cells)+' |\n'
    text+='''
## Reproduce without model calls

```sh
python3 -B scripts/analyze-nace-calibration.py --archive eval/results/nace-calibration-2026-11-06
```

The verifier requires committed scoring artifacts and Python's standard library only. It checks every cohort against the original registry, status-only diagnostics, exact returned identity, fit-before-validation freeze receipts, source snapshots and checkpoint hashes; independently refits every cutoff/budget and recomputes the TypeScript point metrics and paired intervals. Text stays redacted, with original claim/evidence hashes. Full input-containing reports and the unsanitized operational execution receipt stay in ignored storage. Publication removes operational paths, retaining their hashes and the original receipt hash. Neither API credentials nor upstream error bodies are published.

The protocol records the operator call/spend reservation; it is not a measured charge or provider-enforced spending limit. No new financial source text, locked-role labels, prompt variants or human judgments were obtained. Quality promotion remains a separate decision.
'''
    findings = '## Findings\n\n'
    for model in MODELS:
        c=point(model,'validation','all');a,b=c['shipped'],c['calibrated']
        findings += f"- **{model}:** validation precision {pct(b['precision'])}%, recall {pct(b['recall'])}% (shipped {pct(a['recall'])}%), and negative coverage {pct(b['clear_negative_coverage'])}%. False clears {a['false_clears']} → {b['false_clears']} on 212 native-positive cases; {b['errors']} failures stay in denominators.\n"
    passes=[]
    for c in result['scorecards']:
        if c['role'] not in ('validation','archive') or c['variant']!='primary' or c['dataset']=='all':continue
        r=c['calibrated']
        if all(r[k] is not None and r[k]>=v for k,v in [('precision',.95),('recall',.9),('clear_negative_coverage',.85)]):passes.append(c['model']+'/'+c['role']+'/'+c['dataset'])
    findings += '- **Joint point targets:** ' + (', '.join(passes)+'.' if passes else 'No primary per-domain validation or archive-transfer scorecard meets all three.') + ' These native-label results do not qualify the production contract.\n'
    findings += '- **Comparison:** the previous calibrated Decider primary validates at 96.0% precision, 67.5% recall and 74.2% negative coverage on the same cases. Consult the paired intervals below; model selection, repeated public-cohort use and non-contemporaneous calls make this exploratory evidence.\n'
    return text.replace('__NACE_CALIBRATION_FINDINGS__',findings)


def normalize_execution(folder, private):
    raw=(folder/'execution.json').read_bytes();value=json.loads(raw)
    if value.get('publication_paths_redacted'):return value['original_execution_sha256']
    assert private is not None and private.resolve().is_relative_to((ROOT/'eval/reports').resolve())
    (private/'execution.original.json').write_bytes(raw)
    fields=('model','role','pairs','errors','started_at','completed_at')
    published=dict(completed=[dict(**{k:r[k] for k in fields},prefix_sha256=sha(r['prefix'].encode())) for r in value['completed']],
                   completed_at=value['completed_at'],total_assessments=value['total_assessments'],
                   publication_paths_redacted=True,original_execution_sha256=sha(raw))
    (folder/'execution.json').write_bytes(encoded(published))
    return sha(raw)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',type=Path,required=True)
    parser.add_argument('--write',action='store_true')
    parser.add_argument('--private-run-dir',type=Path)
    args=parser.parse_args();folder=args.archive
    paths=['scripts/analyze-nace-calibration.py','scripts/analyze-calibration-study.py','scripts/analyze-calibration-followup.py']
    source={p:(ROOT/p).read_text() for p in paths}
    if args.write:
        assert not (folder/'archive-sha256.json').exists(), 'Published archives are immutable'
        original_execution=normalize_execution(folder,args.private_run_dir)
    else:
        inventory(folder)
        receipt=read(folder/'analysis-provenance.json')
        assert receipt['original_execution_sha256'] == read(folder/'execution.json')['original_execution_sha256']
        for p,h in receipt['source_files'].items():assert sha((ROOT/p).read_bytes())==h,p
        snapshot=json.loads(gzip.decompress((folder/'analysis-sources.json.gz').read_bytes()))
        assert set(snapshot)==set(receipt['source_files'])
        assert all(sha(t.encode())==receipt['source_files'][p] for p,t in snapshot.items())
    result=analyze(folder);markdown=render(result)
    assert all((ROOT/p).read_text()==text for p,text in source.items()), 'Analysis source changed during execution'
    if args.write:
        (folder/'analysis.json').write_bytes(encoded(result))
        (folder/'README.md').write_text(markdown)
        (folder/'analysis-sources.json.gz').write_bytes(gzip.compress(encoded(source),mtime=0))
        (folder/'analysis-provenance.json').write_bytes(encoded(dict(created_at=datetime.now(timezone.utc).isoformat(),python=sys.version,
            phase='Post-validation analysis; no policy reselection',original_execution_sha256=original_execution,
            source_files={p:sha(t.encode()) for p,t in source.items()})))
        (folder/'archive-sha256.json').write_bytes(encoded({p.name:sha(p.read_bytes()) for p in sorted(folder.iterdir())}))
    else:
        assert read(folder/'analysis.json')==result
        assert (folder/'README.md').read_text()==markdown
    print(json.dumps(dict(verified_models=2,new_assessments=6400,scorecards=len(result['scorecards']),paired_comparisons=len(result['paired_comparisons']),network_calls=0)))


if __name__=='__main__':main()
