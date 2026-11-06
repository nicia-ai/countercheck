#!/usr/bin/env python3
"""Offline Jev validation restoration and post-hoc negative-budget sensitivity.

Original zero-budget study stays immutable. No network, credentials, or dataset text.
"""
import argparse
import bisect
from collections import Counter, defaultdict
import gzip
import json
from pathlib import Path
import runpy

ROOT=Path(__file__).resolve().parents[1]
OUT=Path('eval/results/calibration-followup-2026-11-06')
PRIOR=Path('eval/results/separate-calibration-2026-11-05')
PREP=Path('eval/results/calibration-preparation-2026-11-05')
JEV='jev-1.14.0'
BASE=runpy.run_path(str(ROOT/'scripts/analyze-calibration-study.py'))
read=BASE['read'];encoded=BASE['encoded'];observations=BASE['observations'];remap=BASE['remap'];counts=BASE['counts'];measures=BASE['measures'];paired=BASE['paired']
SUPPORTS=BASE['SUPPORTS'];DATASETS=BASE['DATASETS']


sha=BASE['digest']


def fit_negative(rows,positive,budget):
    if not isinstance(budget,int) or budget<0:raise ValueError('Invalid budget')
    points=[(r['prediction']['raw_scores']['contradiction'],max(r['prediction']['raw_scores']['consistent'],r['prediction']['raw_scores']['different_scope']),r['pair']['gold']=='contradiction') for r in rows if r['prediction']['status']=='ok']
    cuts=sorted({0,1.000001,*(i/100 for i in range(101)),*(p[0] for p in points)})
    support_prefix={}
    for support in SUPPORTS:
        values=sorted(p for p in points if p[0]<positive and p[1]>=support)
        prefix=[0]
        for p in values:prefix.append(prefix[-1]+p[2])
        support_prefix[support]=([p[0] for p in values],prefix)
    best=-1;policy=dict(positive=positive,negative_cut=0,negative_support=1.001)
    for cut in (c for c in cuts if c<positive and c<=1):
        for support in SUPPORTS:
            values,prefix=support_prefix[support];index=bisect.bisect_right(values,cut)
            fc=prefix[index];tn=index-fc
            if fc<=budget and tn>best:
                best=tn;policy=dict(positive=positive,negative_cut=cut,negative_support=support)
    return policy


def timeout_sensitivity(rows):
    positives=sum(r['pair']['gold']=='contradiction' for r in rows)
    observed=[r for r in rows if r['prediction']['status']=='ok']
    successful_positives=sum(r['pair']['gold']=='contradiction' for r in observed)
    tp=sum(r['pair']['gold']=='contradiction' and r['prediction'].get('verdict')=='contradiction' for r in rows)
    missing_positive=sum(r['pair']['gold']=='contradiction' and r['prediction']['status']!='ok' for r in rows)
    codes=Counter(r['prediction'].get('error_code') for r in rows if r['prediction']['status']!='ok')
    return dict(selected=len(rows),successes=len(observed),failures=len(rows)-len(observed),error_codes=dict(codes),native_positives=positives,successful_native_positives=successful_positives,true_positives=tp,missing_native_positives=missing_positive,deadline_inclusive_recall=tp/positives if positives else None,successful_subset_recall=tp/successful_positives if successful_positives else None,missing_answer_recall_bounds=[tp/positives,(tp+missing_positive)/positives] if positives else None,qualification='Bounds assume none/all missing native-positive answers would detect contradiction. Conditional successful-subset recall changes the selected population. Neither imputes actual answers or proves provider slowdown.')


def verify_receipts(root):
    path=root/OUT;protocol=read(path/'protocol.json')
    prior=root/PRIOR
    if sha((prior/'archive-sha256.json').read_bytes())!=protocol['prior_archive_sha256'] or sha((prior/'policies.json').read_bytes())!=protocol['prior_policies_sha256'] or sha((prior/'policy-freeze.json').read_bytes())!=protocol['prior_policy_freeze_sha256']:raise ValueError('Original study changed')
    if (protocol['max_calls'],protocol['max_spend_usd'],protocol['model'],protocol['timeout_ms'])!=(688,1.38,JEV,3000):raise ValueError('Unauthorized rerun bounds/model')
    sources=json.loads(gzip.decompress((path/'rerun-execution-sources.json.gz').read_bytes()))
    if sha((path/'rerun-execution-sources.json.gz').read_bytes())!=protocol['rerun_execution_sources_sha256'] or set(sources)!=set(protocol['source_files']) or any(sha(s.encode())!=protocol['source_files'][p] for p,s in sources.items()):raise ValueError('Rerun inference source snapshot differs')
    original=read(root/PREP/'protocol.json')
    for name,expected in original['source_files'].items():
        if sha(sources[name].encode())!=expected:raise ValueError('Frozen inference source differs')
    if protocol['manifest']!=original['manifests']['validation']:raise ValueError('Rerun cohort differs')
    checkpoint=json.loads(gzip.decompress((path/'jev-checkpoint.json.gz').read_bytes()))
    receipt=read(path/'rerun-receipt.json')
    for key,field in [('predictions_utf8','predictions_sha256'),('metadata_utf8','metadata_sha256'),('http_status_utf8','http_status_sha256')]:
        if sha(checkpoint[key].encode())!=receipt[field]:raise ValueError('Rerun checkpoint digest differs')
    predictions=[json.loads(s) for s in checkpoint['predictions_utf8'].splitlines()]
    metadata=json.loads(checkpoint['metadata_utf8'])
    status=[json.loads(s) for s in checkpoint['http_status_utf8'].splitlines()]
    if len(predictions)!=688 or len(status)!=688 or any(set(r)!={'sequence','status'} or r['sequence']!=i+1 or r['status'] is not None and (not isinstance(r['status'],int) or not 100<=r['status']<=599) for i,r in enumerate(status)):raise ValueError('Unsafe/incomplete HTTP status telemetry')
    expected=dict(profile='balanced-v1',passes=1,presentation='original',batch_size=1,concurrency=1,timeout_ms=3000)
    if metadata['model']!=JEV or metadata['backend']!='hosted' or metadata['manifest_sha256']!=protocol['manifest']['sha256'] or metadata['expected_pair_observations']!=688 or any(metadata['source_protocol'][k]!=v for k,v in expected.items()):raise ValueError('Rerun execution protocol differs')
    redacted=observations(path/'jev-validation.redacted.jsonl.gz')
    if predictions!=[r['row']['prediction'] for r in redacted]:raise ValueError('Rerun redacted predictions differ')
    if set(metadata['selected_pair_ids'])!={p['pair_id'] for p in predictions} or len(metadata['selected_pair_ids'])!=688 or len(set(metadata['selected_pair_ids']))!=688:raise ValueError('Rerun selected IDs differ')
    actual_success=sum(p['status']=='ok' for p in predictions)
    if receipt['assessments']!=688 or receipt['successes']!=actual_success or receipt['max_calls']!=688 or receipt['reservation_usd']!=1.38:raise ValueError('Rerun accounting differs')
    ts_receipt=read(path/'analysis-ts-receipt.json');ts_snapshot=(path/'analysis-ts-sources.json.gz').read_bytes();ts_sources=json.loads(gzip.decompress(ts_snapshot))
    if sha(ts_snapshot)!=ts_receipt['snapshot_sha256'] or set(ts_sources)!=set(ts_receipt['source_files']) or any(sha(s.encode())!=ts_receipt['source_files'][p] for p,s in ts_sources.items()):raise ValueError('Negative policy/metric source snapshot differs')
    return protocol,redacted,status


def analyze(root=ROOT):
    protocol,rerun,status=verify_receipts(root)
    path=root/OUT;prior=root/PRIOR
    old=read(prior/'policies.json')['policies'];models=list(old)
    registry=read(root/PREP/'cohort-registry.json')
    cohorts={}
    cohorts['fit']=BASE['checked_cohort'](observations(prior/'fit-observations.redacted.jsonl.gz'),registry['rows']['fit'],models)
    replacement=BASE['checked_cohort'](rerun,registry['rows']['validation'],[JEV])[JEV]
    original_validation=observations(prior/'validation-observations.redacted.jsonl.gz')
    composite=[r for r in original_validation if r['model']!=JEV]+rerun
    cohorts['validation']=BASE['checked_cohort'](composite,registry['rows']['validation'],models)
    archive=defaultdict(dict)
    for o in observations(root/BASE['ARCHIVE']):
        if o['dataset'] in DATASETS:archive[o['model']][o['row']['pair']['id']]=o['row']
    if set(archive)!=set(models) or any(len(c)!=880 for c in archive.values()):raise ValueError('Original archive coverage differs')
    cohorts['archive']=archive
    supplied=read(path/'negative-policies.json')
    if supplied['protocol_sha256']!=sha((path/'protocol.json').read_bytes()) or not supplied['primary_chosen_after_validation_seen'] or not supplied['positive_cutoffs_unchanged']:raise ValueError('Post-hoc policy disclosure differs')
    policies=supplied['policies']
    expected_variants={'primary',*(f'rate_{rate:g}' for rate in protocol['negative_analysis']['sensitivity_rates'])}
    # JavaScript spells 0.005 as the same shortest decimal string used here.
    if set(policies)!=set(models):raise ValueError('Policy model coverage differs')
    for model in models:
        rows=list(cohorts['fit'][model].values());ship=measures(counts(rows));positive=old[model]['policy']['positive']
        if ship['positive']!=771 or ship['false_clears']!=protocol['negative_analysis']['primary_budget_counts'][model]:raise ValueError('User-supplied baseline budget differs')
        if set(policies[model])!=expected_variants:raise ValueError('Sensitivity grid differs')
        for variant,entry in policies[model].items():
            budget=ship['false_clears'] if variant=='primary' else int(float(variant.removeprefix('rate_'))*771)
            if entry['allowed_fit_false_clears']!=budget or entry['policy']!=fit_negative(rows,positive,budget):raise ValueError('Independent negative refit disagrees')
            if variant=='rate_0' and entry['policy']!=old[model]['policy']:raise ValueError('Zero-budget control differs from prior frozen policy')
            if measures(counts([remap(r,entry['policy']) for r in rows]))['false_clears']>budget:raise ValueError('Fit budget exceeded')
    cards=[]
    for role in ('fit','validation','archive'):
        for model in models:
            original=cohorts[role][model]
            for dataset in (*(DATASETS if role=='archive' else DATASETS[:-1]),'all'):
                selected={k:r for k,r in original.items() if dataset=='all' or r['pair']['dataset']==dataset}
                shipped=measures(counts(selected.values()))
                zero={k:remap(r,policies[model]['rate_0']['policy']) for k,r in selected.items()}
                for variant,entry in policies[model].items():
                    mapped={k:remap(r,entry['policy']) for k,r in selected.items()}
                    if any((mapped[k]['prediction'].get('verdict')=='contradiction')!=(zero[k]['prediction'].get('verdict')=='contradiction') for k in mapped):raise ValueError('Negative-only refit changed positive verdicts')
                    point=measures(counts(mapped.values()))
                    cards.append(dict(role=role,model=model,dataset=dataset,variant=variant,calibrated=point,shipped=shipped,
                                      delta_from_shipped={key:point[key]-shipped[key] if point[key] is not None and shipped[key] is not None else None for key in BASE['METRICS']},
                                      paired_vs_zero=paired(mapped,zero) if role!='fit' and dataset!='all' and variant=='primary' else None,
                                      paired_vs_shipped=paired(mapped,selected) if role!='fit' and dataset!='all' and variant=='primary' else None))
    ts_cards=read(path/'metric-crosscheck.json')['scorecards'];expected={(r['role'],r['model'],r['dataset'],r['variant']):r for r in cards}
    if len(ts_cards)!=len(expected):raise ValueError('TypeScript metric crosscheck coverage differs')
    seen=set()
    for r in ts_cards:
        key=tuple(r[k] for k in ('role','model','dataset','variant'))
        if key in seen or key not in expected or r['calibrated']!=expected[key]['calibrated'] or r['shipped']!=expected[key]['shipped']:raise ValueError('Independent metric crosscheck differs')
        seen.add(key)
    glide=list(cohorts['validation']['fastino/GLiDE'].values())
    glide_calibrated=[remap(r,old['fastino/GLiDE']['policy']) for r in glide]
    old_glide=[o['row'] for o in observations(root/BASE['ARCHIVE']) if o['model']=='fastino/GLiDE']
    return dict(schema_version=1,kind='posthoc-negative-budget-followup-v1',qualification='not_assessed',service_change=False,
                protocol_sha256=sha((path/'protocol.json').read_bytes()),new_inference_attempts=688,reservation_usd=1.38,actual_billed_cost=None,
                jev_rerun=dict(successes=len([r for r in replacement.values() if r['prediction']['status']=='ok']),selected=688,http_status_counts=dict(Counter(str(r['status']) for r in status)),original_failed_run_retained=True,original_failure_cause='Unconfirmed historical status; user reports adding credits before successful rerun'),
                primary_choice='Per-model shipped-fit false-clear count, selected after seeing zero-budget validation; exploratory, not confirmatory',
                sensitivity_rates=protocol['negative_analysis']['sensitivity_rates'],policies=policies,scorecards=cards,
                glide_timeout_sensitivity=dict(validation_shipped=timeout_sensitivity(glide),validation_positive_calibrated=timeout_sensitivity(glide_calibrated),original_920=dict(selected=len(old_glide),failures=sum(r['prediction']['status']!='ok' for r in old_glide),cohort='880 public pairs plus 40 synthetic diagnostics; no pooled semantic score computed')),
                bootstrap=dict(replicates=BASE['REPLICATES'],seed=BASE['SEED'],unit='paired source group',qualification='Pointwise exploratory intervals; conditions on fitted policy, excludes fitting uncertainty, no multiplicity correction'),
                adjudication_status='packet prepared, not yet labelled')


def pct(v):return 'n/a' if v is None else f'{100*v:.1f}'


def render(result):
    cards=result['scorecards']
    lines=['# Calibration follow-up: restored Jev validation and negative budgets','',
           '**Post-hoc exploratory analysis.** The per-model primary budget was chosen after the original zero-budget validation was seen. Negative cutoffs are fitted only on original fit outputs. The primary criterion was chosen post hoc; no subsequent validation-driven grid search or reselection is performed. Positive cutoffs remain frozen. The service is unchanged. Finance is transfer only. Native labels remain unchanged.','',
           '[Original zero-budget study](../separate-calibration-2026-11-05/README.md) · [Protocol and authorization](protocol.json) · [Full metrics and paired intervals](analysis.json) · [Review response](../../../docs/evaluations/calibration-review-response-2026-11-06.md)','',
           f"The owner reported adding TypeSafe credits. The fresh Jev run produced **{result['jev_rerun']['successes']}/688 successful assessments**, HTTP statuses **{result['jev_rerun']['http_status_counts']}**. The original 688-failure run remains intact. The rerun uses the original manifest, prompts, 3,000 ms deadline and frozen policies; only status-only diagnostics were added. There were 688 new calls with a $1.38 reservation; measured billing is unknown. No other models were rerun. This supports the billing explanation but cannot establish the historical HTTP status.",'',
           '## Primary rule and findings','',
           'For each model, maximize fit clear-negative count subject to no more fit false clears than its shipped balanced-v1 rule made on the same 771 selected native-positive fit pairs. The cap is an aggregate count, not protection for each subgroup or the same individual pairs. Missing distributions are not imputed. Grid order and tie breaks match the original negative fitter. A zero-budget control exactly reproduces all nine original policies.','',
           '| Model | Allowed fit false clears | Rate over 771 |','| --- | ---: | ---: |']
    for model,variants in result['policies'].items():
        n=variants['primary']['allowed_fit_false_clears'];lines.append(f'| {model} | {n} | {100*n/771:.2f}% |')
    pooled=[r['calibrated'] for r in cards if r['role']=='validation' and r['dataset']=='all' and r['variant']=='primary']
    target_counts={role:sum(r['calibrated']['completed']>0 and (r['calibrated']['precision'] or 0)>=.95 and r['calibrated']['recall']>=.9 and r['calibrated']['clear_negative_coverage']>=.85 for r in cards if r['role']==role and r['dataset']!='all' and r['variant']=='primary') for role in ('validation','archive')}
    lines+=['',f"Primary pooled validation negative coverage is **{pct(min(r['clear_negative_coverage'] for r in pooled))}–{pct(max(r['clear_negative_coverage'] for r in pooled))}%**. All three point targets hold on **{target_counts['validation']} validation** and **{target_counts['archive']} archived model/domain scorecards**. Coverage recovery is a policy trade-off, not proof of corrected labels or population safety.",'']
    for role,title in [('validation','Restored validation'),('archive','Archived development samples')]:
        lines+=['','## '+title,'','Each coverage/count cell is zero-budget → primary. Positive precision and recall are identical across negative budgets because the positive gate is fixed. Pooled rows are descriptive mixtures; per-domain details and paired precision/recall/F1/coverage/false-clear intervals are in JSON. All errors remain in selected-case recall/coverage denominators.','',
                '| Model | Precision % | Recall % | Negative coverage % | False clears | Shipped negative coverage % / false clears |','| --- | ---: | ---: | ---: | ---: | ---: |']
        for r in cards:
            if r['role']!=role or r['dataset']!='all' or r['variant']!='primary':continue
            z=next(x for x in cards if x['role']==role and x['dataset']=='all' and x['model']==r['model'] and x['variant']=='rate_0')['calibrated'];m=r['calibrated'];ship=r['shipped']
            lines.append(f"| {r['model']} | {pct(m['precision'])} | {pct(m['recall'])} | {pct(z['clear_negative_coverage'])} → {pct(m['clear_negative_coverage'])} | {z['false_clears']} → {m['false_clears']} | {pct(ship['clear_negative_coverage'])} / {ship['false_clears']} |")
    lines+=['','## Fixed sensitivity grid','',
            'Budgets are floor(rate × 771) for 0%, 0.5%, 1%, 2% and 5%. These are prespecified sensitivity points within this post-hoc follow-up; no winner is selected on validation. The primary budget exceeds 5% for some models and is not implied by the grid. Full grid/domain counts are in JSON; grid point estimates have no separate bootstrap intervals.','',
            '| Model | Budget | Fit false clears | Validation negative coverage % | Validation false clears | Archived negative coverage % | Archived false clears |','| --- | --- | ---: | ---: | ---: | ---: | ---: |']
    for model in result['policies']:
        for rate in result['sensitivity_rates']:
            variant=f'rate_{rate:g}'
            select=lambda role:next(r['calibrated'] for r in cards if r['role']==role and r['model']==model and r['dataset']=='all' and r['variant']==variant)
            f,v,a=map(select,('fit','validation','archive'))
            lines.append(f"| {model} | {100*rate:g}% | {f['false_clears']} | {pct(v['clear_negative_coverage'])} | {v['false_clears']} | {pct(a['clear_negative_coverage'])} | {a['false_clears']} |")
    s=result['glide_timeout_sensitivity']['validation_positive_calibrated'];o=result['glide_timeout_sensitivity']['original_920']
    lines+=['','## GLiDE timeout interpretation','',
            f"GLiDE had {s['failures']}/688 failed validation assessments versus {o['failures']}/920 in the original comparison. The cohorts differ in domains, source splits and input lengths, and serial runs occurred at different times. The counts do not establish that Fastino became slower. Calibration cannot recover absent distributions.", '',
            f"Using the frozen positive gate, deadline-inclusive validation recall is **{pct(s['deadline_inclusive_recall'])}%**. Recall on successful native-positive assessments alone is **{pct(s['successful_subset_recall'])}%**, but that conditions on a different, potentially easier subset. There are {s['missing_native_positives']} failed native-positive cases. If none/all would have been correctly detected, recall would be bounded by **{pct(s['missing_answer_recall_bounds'][0])}–{pct(s['missing_answer_recall_bounds'][1])}%**. These are counterfactual bounds, not imputed predictions or a corrected score.", '',
            '## Interpretation and reproduction','',
            'The zero-false-clear constraint explains the coverage collapse in that policy. It does not establish that the native labels responsible are wrong; both label mismatch/noise and model mistakes remain possible. The 204-item blinded packet remains prepared, not yet labelled. Better prompt/representation choices and domain-aware operating policies also remain untested; this study does not exhaust every harness improvement.', '',
            'Run `python3 -B scripts/verify-calibration-followup.py`. Standard library only, no network or raw dataset text. It verifies original archives, new immutable receipts and HTTP-status-only logs; independently refits every negative policy, checks 864 point-metric tables against the existing TypeScript metric engine, and recomputes 162 primary paired comparisons at 20,000 source-group resamples each. The original failed Jev validation is retained; only this new version uses the successful rerun. No service threshold, default model or prompt changed.','']
    return '\n'.join(lines).encode()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--write',action='store_true');args=parser.parse_args()
    result=analyze();outputs={'analysis.json':encoded(result),'README.md':render(result)}
    for name,data in outputs.items():
        path=ROOT/OUT/name
        if args.write:
            with path.open('xb') as f:f.write(data)
        elif path.read_bytes()!=data:raise ValueError('Recomputed artifact differs: '+name)
    print(json.dumps(dict(verified_followup_models=len(result['policies']),verified_new_jev_assessments=688,verified_negative_policies=sum(len(p) for p in result['policies'].values()),verified_followup_scorecards=len(result['scorecards']),verified_primary_paired_comparisons=sum(r['paired_vs_zero'] is not None for r in result['scorecards'])*2,bootstrap_replicates=20000,network_calls=0,raw_dataset_text_required=False)))


if __name__=='__main__':main()
