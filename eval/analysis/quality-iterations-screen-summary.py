#!/usr/bin/env python3
"""R1/R2 training-only candidate and rank-fusion diagnostics; no model calls.
Raw conflict frontiers are separate from the actual frozen quantitative composition.
Rank/score aggregates below are exploratory scores, never calibrated probabilities.
"""
from collections import Counter
import hashlib
import json
from pathlib import Path
from statistics import mean, median
ROOT = Path(__file__).resolve().parents[2]
PROFILES_R1 = ('local-mini','literal-contract','nli-three-way','noul-conflict','semantic-numeric')
PROFILES_R2 = ('rich-control','aligned-roles','evidence-refutation','semantic-numeric-v2')


def compose(f,cut=.8):
    quantitative=(f['quantitative_decisive'] or 0)>=.8
    if quantitative and f['numeric_available'] and (f['numeric_probability'] or 0)>=.8 and f['numeric_relation']=='incompatible':return 'contradiction'
    if quantitative and (not f['numeric_available'] or (f['numeric_probability'] or 0)<.8 or f['numeric_relation'] in ('unknown',None)):return 'uncertain'
    if f['conflict']>=cut:return 'contradiction'
    if f['conflict']<=.2 and f['negative']>=.8 and (f.get('determinable') is None or f['determinable']>=.8):return 'no_contradiction'
    return 'uncertain'


def stats(ids,truth,decisions):
    c=Counter((truth[id],decisions[id]) for id in ids);p=sum(truth[id] for id in ids);n=len(ids)-p
    tp,fp,tn=c[(True,'contradiction')],c[(False,'contradiction')],c[(False,'no_contradiction')]
    return dict(cases=len(ids),positive=p,negative=n,tp=tp,fp=fp,tn=tn,precision=tp/(tp+fp) if tp+fp else None,recall=tp/p,clear_negative_coverage=tn/n,false_clears=c[(True,'no_contradiction')],uncertain=sum(decisions[id]=='uncertain' for id in ids))


def frontier(ids,truth,scores,features=None):
    candidates=[]
    for cutoff in sorted(set(scores.values())|{0,.8,1.000001},reverse=True):
        decisions={id:compose(features[id],cutoff) if features else 'contradiction' if scores[id]>=cutoff else 'uncertain' for id in ids}
        m=stats(ids,truth,decisions);candidates.append(dict(cutoff=cutoff,**m))
    acceptable=[p for p in candidates if p['tp'] and 20*p['tp']>=19*(p['tp']+p['fp'])]
    high_recall=[p for p in candidates if 10*p['tp']>=9*p['positive']]
    return dict(best_recall_at_95precision=max(acceptable,key=lambda p:(p['recall'],p['precision']),default=None),best_precision_at_90recall=max(high_recall,key=lambda p:(p['precision'] or 0,p['recall']),default=None),composition='frozen quantitative override/gate and negative-only determinability gate preserved' if features else 'raw score threshold only, not composed verdict',training_only=True)


def midranks(values):
    ordered=sorted(values,key=values.get);ranks={};cursor=0
    while cursor<len(ordered):
        end=cursor+1
        while end<len(ordered) and values[ordered[end]]==values[ordered[cursor]]:end+=1
        value=((cursor+end-1)/2)/(len(ordered)-1)
        for id in ordered[cursor:end]:ranks[id]=value
        cursor=end
    return ranks


def main():
    manifest_path=ROOT/'eval/data/iteration-screen.json';paths=[ROOT/'eval/reports/quality-r1-screen.json',ROOT/'eval/reports/quality-r2-screen.json']
    manifest=json.loads(manifest_path.read_bytes());pairs={p['id']:p for p in manifest['pairs']};ids=list(pairs);truth={id:p['gold']=='contradiction' for id,p in pairs.items()}
    assert manifest['iteration_protocol']['role']=='screen'
    runs=[json.loads(path.read_bytes()) for path in paths];heads={};all_summaries={}
    for phase,run in zip(('round1','round2'),runs):
        assert run['source_stable'] is True and run['freeze']['manifest_sha256']==hashlib.sha256(manifest_path.read_bytes()).hexdigest()
        for profile in run['freeze']['profiles']:
            obs={o['pair_id']:o for o in run['observations'] if o['profile']==profile}
            assert set(obs)==set(ids)
            features={id:o['features'] for id,o in obs.items()};scores={id:f['conflict'] for id,f in features.items()}
            assert all(compose(features[id])==obs[id]['prediction']['verdict'] for id in ids)
            report={}
            for dataset in ('combined','vitaminc','scifact'):
                subset=[id for id in ids if dataset=='combined' or pairs[id]['dataset']==dataset];subset_scores={id:scores[id] for id in subset};subset_features={id:features[id] for id in subset}
                report[dataset]=dict(recorded=stats(subset,truth,{id:obs[id]['prediction']['verdict'] for id in subset}),raw_conflict_frontier=frontier(subset,truth,subset_scores),actual_composed_frontier=frontier(subset,truth,subset_scores,subset_features))
            report['raw_positive_abstentions']=sum(features[id]['conflict']>=.8 and obs[id]['prediction']['verdict']=='uncertain' for id in ids)
            all_summaries[f'{phase}/{profile}']=report
            if phase=='round1' and profile in PROFILES_R1 or phase=='round2' and profile in PROFILES_R2:heads[profile]=scores
    assert len(heads)==9
    ranks={name:midranks(values) for name,values in heads.items()}
    fused={
        'mean_conflict':{id:mean(values[id] for values in heads.values()) for id in ids},
        'median_conflict':{id:median(values[id] for values in heads.values()) for id in ids},
        'mean_midrank':{id:mean(values[id] for values in ranks.values()) for id in ids},
        'median_midrank':{id:median(values[id] for values in ranks.values()) for id in ids},
    }
    fusion={name:frontier(ids,truth,scores) for name,scores in fused.items()}
    output=dict(scope='Only optimization-train screen. No validation/locked labels opened.',candidate_summaries=all_summaries,rank_fusion_diagnostics=fusion,fusion_heads=list(heads),fusion_interpretation='Unweighted score/rank aggregation across nine saved heads; raw-score diagnostic, not a model probability. Cross-round source identities preserved. Method comparison/thresholds use same training labels, not independent evaluation.',input_sha256={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [manifest_path,*paths]})
    Path(__file__).with_suffix('.json').write_text(json.dumps(output,indent=2,sort_keys=True,allow_nan=False)+'\n')
    for name,summary in all_summaries.items():
        if name.startswith('round2'):print(name,summary['combined']['recorded'],'composed_frontier',summary['combined']['actual_composed_frontier']['best_recall_at_95precision'])
    print('unweighted_fusion',json.dumps(fusion))


if __name__=='__main__':main()
