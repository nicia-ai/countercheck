#!/usr/bin/env python3
"""Training-only retrospective R1 error audit. No validation/holdout or model access."""
from collections import Counter
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]


def stats(pairs, observations):
    pairs = {p['id']: p for p in pairs}
    n = Counter()
    for o in observations:
        positive = pairs[o['pair_id']]['gold'] == 'contradiction'
        n[('p' if positive else 'n', o['prediction']['verdict'])] += 1
    positives = sum(p['gold'] == 'contradiction' for p in pairs.values())
    negatives = len(pairs)-positives
    tp,fp,tn = n[('p','contradiction')],n[('n','contradiction')],n[('n','no_contradiction')]
    return dict(positive=positives,negative=negatives,tp=tp,fp=fp,tn=tn,precision=tp/(tp+fp) if tp+fp else None,recall=tp/positives,clear_negative_coverage=tn/negatives)


def frontier(pairs, observations):
    by_id = {p['id']:p for p in pairs}
    buckets={}
    for o in observations:
        counts=buckets.setdefault(o['features']['conflict'],[0,0]);counts[0 if by_id[o['pair_id']]['gold']=='contradiction' else 1]+=1
    positive=sum(p['gold']=='contradiction' for p in pairs)
    tp=fp=0;points=[]
    for cut,(p,n) in sorted(buckets.items(),reverse=True):
        tp+=p;fp+=n;points.append(dict(cut=cut,tp=tp,fp=fp,precision=tp/(tp+fp),recall=tp/positive))
    return dict(best_recall_at_95precision=max((p for p in points if 20*p['tp']>=19*(p['tp']+p['fp'])),key=lambda p:p['recall'],default=None),best_precision_at_90recall=max((p for p in points if 10*p['tp']>=9*positive),key=lambda p:p['precision'],default=None),all_thresholds_group_complete=True,in_sample_training_only=True)


def main():
    manifest_path=ROOT/'eval/data/iteration-screen.json'; report_path=ROOT/'eval/reports/quality-r1-screen.json'
    manifest=json.loads(manifest_path.read_bytes());report=json.loads(report_path.read_bytes())
    assert manifest['iteration_protocol']['role']=='screen' and manifest['iteration_protocol']['optimization_allowed'] is True
    assert report['source_stable'] is True
    pairs=manifest['pairs']; by_id={p['id']:p for p in pairs}; grouped={}
    assert len(pairs)==160 and len(report['observations'])==960
    for o in report['observations']:
        assert o['pair_id'] in by_id and o['prediction']['status']=='ok'
        grouped.setdefault(o['profile'],[]).append(o)
    summaries={}
    by_case={}
    for profile,obs in grouped.items():
        assert len(obs)==len(pairs)
        summaries[profile]={}
        for dataset in ['combined','vitaminc','scifact']:
            subset=[p for p in pairs if dataset=='combined' or p['dataset']==dataset];ids={p['id'] for p in subset};subset_obs=[o for o in obs if o['pair_id'] in ids]
            summaries[profile][dataset]=dict(recorded=stats(subset,subset_obs),frontier=frontier(subset,subset_obs))
        for o in obs:by_case.setdefault(o['pair_id'],{})[profile]=o
    fp=[];hard_fn=[];numeric_veto=[]
    for id,variants in by_case.items():
        pair=by_id[id];positive=pair['gold']=='contradiction'
        scores={p:o['features']['conflict'] for p,o in variants.items()};decisions={p:o['prediction']['verdict'] for p,o in variants.items()}
        case=dict(pair=pair,scores=scores,decisions=decisions,provenance='Upstream native training labels; diagnostic text review is not new human service-contract adjudication')
        if not positive and any(v=='contradiction' for v in decisions.values()):fp.append(case)
        if positive and max(scores.values())<.5:hard_fn.append(case)
        numeric=variants['semantic-numeric']
        if positive and numeric['features']['conflict']>=.8 and numeric['prediction']['verdict']!='contradiction':numeric_veto.append(dict(**case,numeric_features=numeric['features']))
    result=dict(scope='R1 optimization-train screen only. No validation or holdout read.',manifest_sha256=hashlib.sha256(manifest_path.read_bytes()).hexdigest(),report_sha256=hashlib.sha256(report_path.read_bytes()).hexdigest(),summaries=summaries,unique_native_false_positive_cases=fp,all_six_conflict_score_below_0_5_positive_cases=hard_fn,semantic_numeric_raw_positive_but_abstained=numeric_veto,target_resolution=dict(positives=50,minimum_tp_for_90recall=45,fp_budget_at_45_to_50_tp=2))
    Path(__file__).with_suffix('.json').write_text(json.dumps(result,indent=2,ensure_ascii=False,sort_keys=True)+'\n')
    print('Training-only audit:',len(fp),'unique native FP,',len(hard_fn),'hard native positive misses,',len(numeric_veto),'raw-positive numeric abstentions')
    for profile,summary in summaries.items():print(profile,{ds:v['frontier']['best_recall_at_95precision'] for ds,v in summary.items()})


if __name__=='__main__':main()
