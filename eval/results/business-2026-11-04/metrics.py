#!/usr/bin/env python3
"""Independent business metrics, adapted from the earlier standard-library verifier.
No inference, model fitting, imports of artifact scripts, or locked-label reads.
"""
from collections import Counter
import hashlib
import math
def sha(data):
    return hashlib.sha256(data).hexdigest()

def close(a, b):
    assert a is None and b is None or (a is not None and b is not None and math.isclose(a, b, rel_tol=1e-10, abs_tol=1e-11)), (a, b)

def ratio(n, d):
    return n / d if d else None

def compose(f, p=None, compatible_veto=False):
    p = p or dict(positive=0.8, negative_cut=0.2, negative_support=0.8)
    if f['unknown'] > p.get('unknown_max', 1):
        return 'uncertain'
    quantitative = (f['quantitative_decisive'] or 0) >= 0.8
    if p.get('numeric_override', True) and quantitative and f['numeric_available'] and ((f['numeric_probability'] or 0) >= 0.8) and (f['numeric_relation'] == 'incompatible'):
        return 'contradiction'
    if p.get('quantitative_gate', True) and quantitative and (not f['numeric_available'] or (f['numeric_probability'] or 0) < 0.8 or f['numeric_relation'] in ('unknown', None)):
        return 'uncertain'
    if compatible_veto and quantitative and f['numeric_available'] and ((f['numeric_probability'] or 0) >= 0.8) and (f['numeric_relation'] == 'compatible') and (f['conflict'] >= p['positive']):
        return 'uncertain'
    if f['conflict'] >= p['positive']:
        return 'contradiction'
    if p.get('scope_negative', False) and f['applicability'] is not None and (f['applicability'] <= 0.2):
        return 'no_contradiction'
    if f['conflict'] <= p['negative_cut'] and f['negative'] >= p['negative_support'] and (f.get('determinable') is None or f['determinable'] >= 0.8):
        return 'no_contradiction'
    return 'uncertain'

def ranking_metrics(pairs, scores):
    groups = {}
    positive = sum((p['gold'] == 'contradiction' for p in pairs))
    negative = len(pairs) - positive
    for p in pairs:
        counts = groups.setdefault(scores[p['id']], [0, 0])
        counts[int(p['gold'] != 'contradiction')] += 1
    tp = fp = 0
    roc = ap = 0.0
    for score, (dp, dn) in sorted(groups.items(), reverse=True):
        old_tp, old_fp = (tp, fp)
        tp += dp
        fp += dn
        if positive and negative:
            roc += (fp - old_fp) / negative * (tp + old_tp) / (2 * positive)
        if positive:
            ap += dp / positive * tp / (tp + fp)
    return dict(auroc=roc if positive and negative else None, pr_auc_average_precision=ap if positive else None)

def metrics(pairs, verdicts, scores=None):
    all_pairs = pairs
    pairs = [p for p in pairs if not (p['dataset'] == 'synthetic-smoke' and p['native_label'] == 'uncertain' and (p.get('source_metadata', {}).get('expected_verdict') == 'uncertain'))]
    binary_verdicts = [verdicts[p['id']] for p in pairs]
    counts = Counter(((p['gold'] == 'contradiction', verdicts[p['id']]) for p in pairs))
    positive = sum((p['gold'] == 'contradiction' for p in pairs))
    negative = len(pairs) - positive
    tp, fp, tn = (counts[True, 'contradiction'], counts[False, 'contradiction'], counts[False, 'no_contradiction'])
    result = dict(cases=len(all_pairs), binary_cases=len(pairs), positive=positive, negative=negative, tp=tp, fp=fp, tn=tn, false_clears=counts[True, 'no_contradiction'], uncertain=sum((v == 'uncertain' for v in binary_verdicts)), errors=sum((v == 'error' for v in binary_verdicts)), excluded=sum((v == 'excluded' for v in binary_verdicts)), precision=ratio(tp, tp + fp), recall=ratio(tp, positive), clear_negative_coverage=ratio(tn, negative), npv=ratio(tn, tn + counts[True, 'no_contradiction']), brier=None)
    scored = [p for p in pairs if scores is not None and p['id'] in scores]
    result['probability_denominator'] = len(scored)
    result['f1'] = ratio(2 * tp, positive + tp + fp)
    result['positive_misses'] = positive - tp
    result['coverage'] = ratio(tp + fp + tn + result['false_clears'], len(pairs))
    result['false_positive_rate'] = ratio(fp, negative)
    result['completion'] = ratio(len(pairs) - result['errors'] - result['excluded'], len(pairs))
    result['brier'] = sum((scores[p['id']] - int(p['gold'] == 'contradiction')) ** 2 for p in scored) / len(scored) if scored else None
    result.update(ranking_metrics(scored, scores) if scored else dict(auroc=None, pr_auc_average_precision=None))
    return result
