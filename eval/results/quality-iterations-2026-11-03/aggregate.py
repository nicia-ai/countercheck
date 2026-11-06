#!/usr/bin/env python3
"""Rebuild independent measured-run/fit/validation summaries from exact archive bytes.
No network, model calls, model fitting, threshold selection, or locked-label parsing.
Use --include-locked-evaluation only after the final evaluation is explicitly authorized.
"""
import argparse
from collections import Counter
import csv
import gzip
import hashlib
import json
import math
import re
import unicodedata
from pathlib import Path
HERE=Path(__file__).resolve().parent


def sha(data):return hashlib.sha256(data).hexdigest()
def close(a,b):assert a is None and b is None or a is not None and b is not None and math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-11),(a,b)
def compact(value):return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
def ratio(n,d):return n/d if d else None


def compose(f,p=None,compatible_veto=False):
    p=p or dict(positive=.8,negative_cut=.2,negative_support=.8)
    if f['unknown']>p.get('unknown_max',1):return 'uncertain'
    quantitative=(f['quantitative_decisive'] or 0)>=.8
    if p.get('numeric_override',True) and quantitative and f['numeric_available'] and (f['numeric_probability'] or 0)>=.8 and f['numeric_relation']=='incompatible':return 'contradiction'
    if p.get('quantitative_gate',True) and quantitative and (not f['numeric_available'] or (f['numeric_probability'] or 0)<.8 or f['numeric_relation'] in ('unknown',None)):return 'uncertain'
    if compatible_veto and quantitative and f['numeric_available'] and (f['numeric_probability'] or 0)>=.8 and f['numeric_relation']=='compatible' and f['conflict']>=p['positive']:return 'uncertain'
    if f['conflict']>=p['positive']:return 'contradiction'
    if p.get('scope_negative',False) and f['applicability'] is not None and f['applicability']<=.2:return 'no_contradiction'
    if f['conflict']<=p['negative_cut'] and f['negative']>=p['negative_support'] and (f.get('determinable') is None or f['determinable']>=.8):return 'no_contradiction'
    return 'uncertain'


def ranking_metrics(pairs,scores):
    groups={}
    positive=sum(p['gold']=='contradiction'for p in pairs);negative=len(pairs)-positive
    for p in pairs:
        counts=groups.setdefault(scores[p['id']],[0,0]);counts[int(p['gold']!='contradiction')]+=1
    tp=fp=0;roc=ap=0.0
    for score,(dp,dn) in sorted(groups.items(),reverse=True):
        old_tp,old_fp=tp,fp;tp+=dp;fp+=dn
        if positive and negative:roc+=(fp-old_fp)/negative*(tp+old_tp)/(2*positive)
        if positive:ap+=dp/positive*tp/(tp+fp)
    return dict(auroc=roc if positive and negative else None,pr_auc_average_precision=ap if positive else None)


def metrics(pairs,verdicts,scores=None):
    all_pairs=pairs
    pairs=[p for p in pairs if not(p['dataset']=='synthetic-smoke' and p['native_label']=='uncertain' and p.get('source_metadata',{}).get('expected_verdict')=='uncertain')]
    binary_verdicts=[verdicts[p['id']]for p in pairs]
    counts=Counter((p['gold']=='contradiction',verdicts[p['id']]) for p in pairs)
    positive=sum(p['gold']=='contradiction' for p in pairs);negative=len(pairs)-positive
    tp,fp,tn=counts[(True,'contradiction')],counts[(False,'contradiction')],counts[(False,'no_contradiction')]
    result=dict(cases=len(all_pairs),binary_cases=len(pairs),positive=positive,negative=negative,tp=tp,fp=fp,tn=tn,false_clears=counts[(True,'no_contradiction')],uncertain=sum(v=='uncertain' for v in binary_verdicts),errors=sum(v=='error' for v in binary_verdicts),excluded=sum(v=='excluded' for v in binary_verdicts),precision=ratio(tp,tp+fp),recall=ratio(tp,positive),clear_negative_coverage=ratio(tn,negative),npv=ratio(tn,tn+counts[(True,'no_contradiction')]),brier=ratio(sum((scores[p['id']]-int(p['gold']=='contradiction'))**2 for p in pairs),len(pairs)) if scores else None)
    if scores:result.update(ranking_metrics(pairs,scores))
    return result


def verify_metrics(actual,recorded):
    for key in ('tp','fp','tn','false_clears'):assert actual[key]==recorded[key],(key,actual[key],recorded[key])
    for key in ('precision','recall','clear_negative_coverage'):close(actual[key],recorded[key]['value'])
    for key in ('brier','auroc','pr_auc_average_precision'):
        if key in recorded:close(actual[key],recorded[key])


def vector(o):
    f=o['features'];raw=o['raw_answers'].get('q_0_relation',{}).get('probabilities',{});total=sum(raw.values()) or 1
    def logit(p):p=max(.001,min(.999,p));return math.log(p/(1-p))
    return [f['conflict'],logit(f['conflict']),f['negative'],logit(f['negative']),f['unknown'],f['scope'],f['applicability'] or 0,int(f['applicability'] is None),f.get('determinable') or 0,int(f.get('determinable') is None),f['quantitative_decisive'] or 0,int(f['quantitative_decisive'] is None),f['numeric_probability'] or 0,int(f['numeric_probability'] is None),int(f['numeric_relation']=='incompatible'),int(f['numeric_relation']=='compatible'),int(f['numeric_available']),raw.get('entailment',0)/total,raw.get('neutral',0)/total]


def predict(model,x):
    assert len(x)==len(model['coefficients'])==len(model['mean'])==len(model['scale'])
    z=model['intercept']+sum((v-model['mean'][j])/model['scale'][j]*model['coefficients'][j] for j,v in enumerate(x))
    return 1/(1+math.exp(-z)) if z>=0 else math.exp(z)/(1+math.exp(z))


def predict_boost(model,x):
    assert len(x)==model['dimensions'] and len(model['trees'])==model['rounds']==50
    def tree_value(tree):
        if tree['kind']=='leaf':return tree['value']
        assert tree['kind']=='split' and 0<=tree['feature']<len(x)
        return tree_value(tree['left'] if x[tree['feature']]<=tree['threshold'] else tree['right'])
    z=model['intercept']+model['rate']*sum(tree_value(tree)for tree in model['trees'])
    return 1/(1+math.exp(-z)) if z>=0 else math.exp(z)/(1+math.exp(z))


def main(include_locked):
    inventory=json.loads((HERE/'artifact-sha256.json').read_bytes());blobs={}
    for entry in inventory['artifacts']:
        data=(HERE/entry['archive']).read_bytes();assert len(data)==entry['stored_bytes'] and sha(data)==entry['stored_sha256']
        if entry['encoding']=='gzip-mtime0':assert data[4:8]==b'\0'*4;data=gzip.decompress(data)
        else:assert entry['encoding']=='identity'
        assert len(data)==entry['original_bytes'] and sha(data)==entry['original_sha256']
        blobs[entry['archive']]=data
    read=lambda path:json.loads(blobs[path])
    manifests={}
    for role in ('screen','fit','validation'):
        if role=='validation' and not any('/quality-'in name and 'validation/report.json' in name for name in blobs):continue
        manifests[sha(blobs[f'inputs/{role}.manifest.gz'])]=read(f'inputs/{role}.manifest.gz')
    if include_locked:manifests[sha(blobs['inputs/locked-holdout.manifest.gz'])]=read('inputs/locked-holdout.manifest.gz')
    for name in ('inputs/synthetic-probe.manifest.gz','inputs/synthetic-contract.manifest.gz','inputs/public-vitaminc.manifest.gz','inputs/public-scifact.manifest.gz','inputs/expanded-fit.manifest.gz','inputs/expanded-extra-fit.manifest.gz'):
        if name in blobs:manifests[sha(blobs[name])]=read(name)
    runs={};rows=[];requests={};request_backends={};all_summaries={}
    for name in sorted(blobs):
        if not name.startswith('runs/') or not name.endswith('/report.json.gz'):continue
        run_id=name.split('/')[1]
        if not include_locked and any(k in run_id for k in ('locked','holdout')):continue
        report=read(name);freeze=report['freeze'];prefix=f'runs/{run_id}'
        assert report['source_stable'] is True and freeze==read(prefix+'/freeze.json')
        metadata=read(prefix+'/metadata.json');assert metadata['protocol']==freeze
        assert metadata['freeze_sha256']==sha(compact(freeze))
        source=json.loads(gzip.decompress(blobs[prefix+'/sources.json.gz']))
        assert set(source)==set(freeze['source_files'])
        for file,hash in freeze['source_files'].items():assert sha(source[file].encode())==hash,(run_id,file)
        compatible_veto='An eligible, decisive interval comparison' in source['eval/iteration/runner.ts']
        manifest=manifests[freeze['manifest_sha256']];pairs={p['id']:p for p in manifest['pairs']};obs=report['observations']
        checkpoint=[json.loads(line)for line in blobs[prefix+'/predictions.jsonl.gz'].splitlines()]
        by_identity={(p['iteration']['profile'],p['pair_id'],p['pass']):p for p in checkpoint};assert len(by_identity)==len(obs)==len(pairs)*len(freeze['profiles'])*freeze['passes']
        execution=freeze.get('execution'); model=(execution or {}).get('model','jev-1.14.0');backend=(execution or {}).get('backend','jev');actual_calls=0
        seen=set();bundles={}
        for i,o in enumerate(obs):
            assert o['pair_id']in pairs and(o['profile'],o['pair_id'],o['pass'])not in seen
            seen.add((o['profile'],o['pair_id'],o['pass']));p=o['prediction'];assert p['pair_id']==o['pair_id'] and p['pass']==o['pass'] and p['prompt_hash']==o['prompt_sha256']
            check=by_identity[(o['profile'],o['pair_id'],o['pass'])];assert all(check[k]==v for k,v in p.items())
            actual_calls+=o['provider_calls']
            bundles.setdefault(p['request_id'],[]).append(o)
            if p['status']=='ok':
                assert p['model']==model
                reported=p.get('reported_model')
                assert reported is None or reported==model or model=='perplexity/pplx-decider-v1.2' and reported=='perplexity/pplx-decider-v1.2-20261016'
                assert p['verdict']==compose(o['features'],compatible_veto=compatible_veto)
                assert 0<o['compiled_bytes']<=16384
            if p.get('request_usage') is not None:
                usage=p['request_usage'];key=(run_id,p['request_id'])
                assert key not in requests or requests[key]==usage
                requests[key]=usage
                request_backends[key]=backend
        assert len(seen)==len(pairs)*len(freeze['profiles'])*freeze['passes']
        if execution and execution['compiler_mode']=='bundle':
            assert len(bundles)==freeze['planned_calls']
            for request_id,heads in bundles.items():
                assert {o['profile'] for o in heads}==set(freeze['profiles']) and len(heads)==len(freeze['profiles'])
                assert len({(o['pair_id'],o['pass'],o['prompt_sha256'],o['compiled_bytes']) for o in heads})==1
                assert sum(o['provider_calls'] for o in heads)==1
        by_profile={}
        for profile in freeze['profiles']:
            first=[o for o in obs if o['profile']==profile and o['pass']==1]
            decisions={o['pair_id']:o['prediction'].get('verdict',o['prediction']['status']) for o in first};actual=metrics(list(pairs.values()),decisions,{o['pair_id']:o['features']['conflict']for o in first})
            recorded=report['summaries'][profile]['binary']['overall']
            for k,field in [('tp','true_positive'),('fp','false_positive'),('tn','true_negative'),('false_clears','definitive_false_negative')]:assert actual[k]==recorded['confusion'][field]
            for k in ('precision','recall','clear_negative_coverage'):close(actual[k],recorded[k]['value'])
            expected=[p for p in pairs.values()if p.get('source_metadata',{}).get('expected_verdict') is not None]
            actual['expected_verdict_cases']=len(expected)
            actual['expected_verdict_correct']=sum(decisions[p['id']]==p['source_metadata']['expected_verdict']for p in expected)
            if expected:
                assert actual['expected_verdict_cases']==report['summaries'][profile]['expected_verdict_cases']
                assert actual['expected_verdict_correct']==report['summaries'][profile]['expected_verdict_correct']
            for key in ('brier','auroc','pr_auc_average_precision'):close(actual[key],recorded[key])
            by_profile[profile]=actual
            rows.append(dict(run=run_id,profile=profile,**actual))
        per_run_requests=[usage for (name,id),usage in requests.items()if name==run_id]
        by_profile_usage={field:sum(usage[field] or 0 for usage in per_run_requests)for field in ('input_tokens','output_tokens')}
        assert actual_calls==len(per_run_requests) or any(o['prediction']['status']!='ok' for o in obs)
        source_binding=sha(compact(dict(files=dict(sorted(freeze['source_files'].items())),execution=execution))) if execution else sha(compact(dict(sorted(freeze['source_files'].items()))))
        runs[run_id]=dict(manifest=manifest,report=report,observations=obs,source_binding=source_binding,compatible_veto=compatible_veto,global_component_groups='return p.group_id;' in source.get('eval/iteration/calibrate.ts',''))
        all_summaries[run_id]=dict(calls=actual_calls,planned_calls=freeze['planned_calls'],head_observations=len(obs),passes=freeze['passes'],distinct_cases=len(pairs),source_files=len(source),recorded_execution=execution,candidate_source_sha256=source_binding,backend=backend,model=model,purpose=freeze['purpose'],usage=by_profile_usage,by_profile=by_profile)
    # Ordinary balanced-v1 reports retain their own checkpoint protocol, not an invented source freeze.
    for name in sorted(blobs):
        if not name.startswith('ordinary/')or not name.endswith('/report.json.gz'):continue
        run_id=name.split('/')[1];report=read(name);prefix=f'ordinary/{run_id}'
        manifest=manifests[report['manifest_sha256']];pairs={p['id']:p for p in manifest['pairs']}
        metadata=read(prefix+'/metadata.json');assert report['prediction_metadata']==metadata
        assert metadata['manifest_sha256']==report['manifest_sha256']
        assert report['protocol']['batch_size']==report['protocol']['passes']==1
        checkpoint=[json.loads(line)for line in blobs[prefix+'/predictions.jsonl.gz'].splitlines()]
        assert len(checkpoint)==len(report['rows'])==len(pairs)==len(report['request_observations'])
        by_id={p['pair_id']:p for p in checkpoint};assert len(by_id)==len(pairs)
        decisions={};scores={}
        for row in report['rows']:
            pair,p=row['pair'],row['prediction'];id=pair['id'];assert pair==pairs[id] and p==by_id[id]
            assert p['status']=='ok' and p['model']==p['reported_model']=='jev-1.14.0'
            raw=p['raw_scores'];v='contradiction'if raw['contradiction']>=.8 else 'no_contradiction'if raw['contradiction']<=.2 and max(raw['consistent'],raw['different_scope'])>=.8 else'uncertain'
            assert p['verdict']==v
            decisions[id]=v;scores[id]=p['probabilities']['contradiction']
            key=(run_id,p['request_id']);assert key not in requests
            requests[key]=p['request_usage'];request_backends[key]=report['backend']
        actual=metrics(list(pairs.values()),decisions,scores);recorded=report['overall']
        for k,field in [('tp','true_positive'),('fp','false_positive'),('tn','true_negative'),('false_clears','definitive_false_negative')]:assert actual[k]==recorded['confusion'][field]
        for k in ('precision','recall','clear_negative_coverage'):close(actual[k],recorded[k]['value'])
        for k in ('brier','auroc','pr_auc_average_precision'):close(actual[k],recorded[k])
        profile=report['protocol']['profile'];rows.append(dict(run=run_id,profile=profile,**actual))
        usages=[usage for(name,id),usage in requests.items()if name==run_id]
        all_summaries[run_id]=dict(calls=len(usages),planned_calls=report['protocol']['planned_calls'],head_observations=len(report['rows']),passes=1,distinct_cases=len(pairs),source_files=None,recorded_execution=None,source_freeze='not_recorded_for_ordinary_eval_cli',backend=report['backend'],model=metadata['model'],purpose=report['purpose'],usage={f:sum(u[f]or 0 for u in usages)for f in ('input_tokens','output_tokens')},by_profile={profile:actual})
    # Frozen scalar and logistic evaluations are independently recomputed, not refit.
    derived={};models={}
    for path,data in blobs.items():
        if path.startswith('derived/') and path.endswith('.json.gz'):
            value=json.loads(data)
            if value.get('kind')in ('iteration-threshold-model','iteration-logistic-fusion','iteration-boosted-fusion'):models[sha(data)]=value
    for model in models.values():
        training=[r for name,r in runs.items()if sha(blobs[f'runs/{name}/report.json.gz'])==model['training_run_sha256']]
        assert len(training)==1
        training=training[0];pair_list=training['manifest']['pairs']
        def group_key(p):
            if training['global_component_groups'] and p.get('source_metadata',{}).get('iteration_component_sha256') is not None:
                assert p['group_id']=='iteration:'+p['source_metadata']['iteration_component_sha256']
                return p['group_id']
            return p['dataset']+':'+p['group_id']
        expected_groups=sorted({group_key(p)for p in pair_list})
        assert model['training_groups']==expected_groups and model['training_groups_sha256']==sha(compact(expected_groups))
        assert model['candidate_source_sha256']==training['source_binding']
        if model.get('cross_validation') is not None:
            cv=model['cross_validation'];lookup={p['id']:p for p in pair_list};seen_oof=set()
            for fold in cv['folds']:
                assert not set(fold['fit_groups'])&set(fold['check_groups'])
                assert sorted(fold['fit_groups']+fold['check_groups'])==expected_groups
                for role in ('fit','check'):assert fold[role+'_groups_sha256']==sha(compact(fold[role+'_groups']))
            for o in cv['oof_predictions']:
                assert o['pair_id'] not in seen_oof and o['group']==group_key(lookup[o['pair_id']])
                seen_oof.add(o['pair_id']);assert o['group']in cv['folds'][o['fold']]['check_groups']
            assert seen_oof==set(lookup)
    for path,data in blobs.items():
        if not path.startswith('derived/')or not path.endswith('.json.gz'):continue
        value=json.loads(data);kind=value.get('kind','')
        if kind not in ('iteration-frozen-validation','iteration-frozen-fusion-validation','iteration-frozen-boost-validation'):continue
        if not include_locked and any(k in path for k in ('locked','holdout')):continue
        # Reports hash the exact formatted original bytes, not canonicalized JSON.
        candidates=[x for name,x in runs.items()if sha(blobs[f'runs/{name}/report.json.gz'])==value['run_sha256']]
        assert len(candidates)==1
        run=candidates[0];manifest=run['manifest'];pair_list=manifest['pairs'];obs={(o['profile'],o['pair_id']):o for o in run['observations']if o['pass']==1}
        model_matches=[m for hash,m in models.items()if sha(compact(m))==value['model_sha256'] or hash==value['model_sha256']]
        assert len(model_matches)==1,(path,value['model_sha256'],[m['kind']for m in models.values()])
        model=model_matches[0]
        assert model['candidate_source_sha256']==run['source_binding'], (path,'source/execution binding')
        if kind=='iteration-frozen-validation':
            output={}
            for profile,entry in value['profiles'].items():
                policy=model['profiles'][profile]['policy'];decisions={p['id']:compose(obs[(profile,p['id'])]['features'],policy,run['compatible_veto'])for p in pair_list};actual=metrics(pair_list,decisions);verify_metrics(actual,entry['metrics']);output[profile]=actual
            derived[path]=output
        else:
            scorer=predict_boost if kind=='iteration-frozen-boost-validation' else predict
            scores={p['id']:scorer(model['model'],[v for profile in model['profiles']for v in vector(obs[(profile,p['id'])])])for p in pair_list}
            reported={o['pair_id']:o['calibrated_estimate']['contradiction'] for o in value['observations']}
            for id,score in scores.items():close(score,reported[id])
            output={}
            for name,entry in value['policies'].items():
                policy=model['selection']['policies'][name];decisions={id:'contradiction'if score>=policy['positive']else'no_contradiction'if score<=policy['negative_cut']else'uncertain'for id,score in scores.items()};actual=metrics(pair_list,decisions,scores);verify_metrics(actual,entry['metrics']);output[name]=actual
            derived[path]=output
    totals={field:sum(u[field]or 0 for u in requests.values())for field in ('input_tokens','output_tokens')}
    by_backend={}
    for backend in sorted(set(request_backends.values())):
        usages=[u for key,u in requests.items() if request_backends[key]==backend]
        tokens={field:sum(u[field] or 0 for u in usages) for field in ('input_tokens','output_tokens')}
        by_backend[backend]=dict(requests=len(usages),**tokens,estimated_input_list_price_usd=tokens['input_tokens']*.042/1e6 if backend=='jev' else None,actual_billing='unknown')
    result=dict(schema_version=1,runs=all_summaries,frozen_evaluations=derived,usage=dict(requests=len(requests),bare_request_ids=len({id for run,id in requests}),**totals,unknown_input_requests=sum(u['input_tokens']is None for u in requests.values()),unknown_output_requests=sum(u['output_tokens']is None for u in requests.values()),by_backend=by_backend,estimated_input_list_price_usd=totals['input_tokens']*.042/1e6 if set(by_backend)=={'jev'} else None,actual_billing='unknown'),verification=dict(artifacts=len(blobs),all_original_and_stored_hashes='verified',runtime_snapshots='verified',versioned_frozen_training_group_and_oof_bindings='verified',bundle_shared_payload_and_dispatch_attribution='verified',checkpoints='verified',recorded_default_composition='independently_reproduced',frozen_scalar_logistic_and_boosted_predictions='independently_reproduced',locked_labels_parsed=include_locked),qualification='Native public-train development experiment; human500/locked200 service-contract release gate unmet; no production promotion')
    (HERE/'summary.json').write_text(json.dumps(result,indent=2,sort_keys=True,allow_nan=False)+'\n')
    fields=['run','profile','cases','binary_cases','expected_verdict_cases','expected_verdict_correct','positive','negative','tp','fp','tn','false_clears','precision','recall','clear_negative_coverage','errors','excluded']
    with(HERE/'summary.csv').open('w',newline='')as handle:
        writer=csv.DictWriter(handle,fieldnames=fields,extrasaction='ignore',lineterminator='\n');writer.writeheader();writer.writerows(rows)
    print(json.dumps(dict(runs=len(all_summaries),requests=len(requests),artifacts=len(blobs),locked_labels_parsed=include_locked)))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--include-locked-evaluation',action='store_true');main(parser.parse_args().include_locked_evaluation)
