import importlib.util
from pathlib import Path
import unittest
import runpy

path=Path(__file__).resolve().parents[1]/'scripts/analyze-calibration-study.py'
spec=importlib.util.spec_from_file_location('calibration_study',path)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def row(pair_id, positive, score, verdict='uncertain', group=None):
    return {'pair':dict(id=pair_id,dataset='scifact',gold='contradiction' if positive else 'non_contradiction',native_label='C' if positive else 'S',group_id=group or pair_id),
            'prediction':dict(status='ok',verdict=verdict,raw_scores=dict(contradiction=score,consistent=1-score,different_scope=0,insufficient_context=0))}


class CalibrationStudyTests(unittest.TestCase):
    def test_precision_constraint_selects_recall_with_tied_blocks(self):
        rows=[row(str(i),True,.6) for i in range(20)]+[row('high',True,.9),row('fp',False,.6),row('tn',False,.1)]
        policy=m.fitted_policy(rows)
        self.assertEqual(policy,dict(positive=.6,negative_cut=.1,negative_support=0))
        report=m.measures(m.counts([m.remap(r,policy) for r in rows]))
        self.assertEqual(report['tp'],21)
        self.assertGreaterEqual(report['precision'],.95)
        self.assertEqual(report['false_clears'],0)

    def test_no_precision_qualifier_disables_positive_gate(self):
        policy=m.fitted_policy([row('p',True,.5),row('n',False,1)])
        self.assertEqual(policy['positive'],1.000001)

    def test_tied_positive_negative_cannot_be_separated(self):
        policy=m.fitted_policy([row('p',True,.5),row('n',False,.5)])
        self.assertEqual(policy['positive'],1.000001)
        self.assertEqual(m.remap(row('n',False,.5),policy)['prediction']['verdict'],'uncertain')

    def test_negative_support_is_max_not_sum(self):
        r=row('n',False,.1)
        r['prediction']['raw_scores']=dict(contradiction=.1,consistent=.45,different_scope=.4,insufficient_context=.05)
        self.assertEqual(m.remap(r,dict(positive=.8,negative_cut=.2,negative_support=.8))['prediction']['verdict'],'uncertain')

    def test_errors_retain_full_denominators(self):
        error=row('error',True,.1);error['prediction']={'status':'error'}
        result=m.measures(m.counts([row('p',True,.9,'contradiction'),error,row('n',False,.1,'no_contradiction')]))
        self.assertEqual(result['recall'],.5)
        self.assertEqual(result['errors'],1)
        self.assertEqual(result['clear_negative_coverage'],1)
        self.assertIs(m.remap(error,dict(positive=.8,negative_cut=.2,negative_support=.8)),error)

    def test_bootstrap_keeps_both_policies_and_source_group_together(self):
        baseline={'a':row('a',True,.9,'uncertain','same'),'b':row('b',False,.1,'uncertain','same')}
        new={k:m.remap(v,dict(positive=.8,negative_cut=.2,negative_support=.8)) for k,v in baseline.items()}
        result=m.paired(new,baseline,replicates=20,seed=1)
        self.assertEqual(result['source_groups'],1)
        self.assertEqual(result['metrics']['recall']['percentile_95'],[1,1])
        self.assertEqual(result['metrics']['clear_negative_coverage']['percentile_95'],[1,1])
        self.assertIsNone(result['metrics']['precision']['difference'])
        self.assertEqual(result['metrics']['precision']['valid_replicates'],0)

    def test_shared_metrics_match_existing_release_bootstrap(self):
        original=runpy.run_path(str(path.parent/'analyze-eval-release.py'))
        baseline={'a':row('a',True,.9,'uncertain','x'),'b':row('b',False,.1,'uncertain','x'),'c':row('c',True,.8,'contradiction','y')}
        new={k:m.remap(v,dict(positive=.8,negative_cut=.2,negative_support=.8)) for k,v in baseline.items()}
        a=m.paired(new,baseline,100,20261105)['metrics']
        b=original['paired'](new,baseline,100,20261105)['metrics']
        for metric in ('f1','recall','clear_negative_coverage'):
            self.assertEqual(a[metric]['difference'],b[metric]['difference'])
            self.assertEqual(a[metric]['percentile_95'],b[metric]['percentile_95'])
            self.assertEqual(a[metric]['valid_replicates'],b[metric]['valid_replicates'])

    def test_bootstrap_requires_exact_paired_identity(self):
        a={'a':row('a',True,.5)};b={'b':row('b',True,.5)}
        with self.assertRaises(ValueError):m.paired(a,b,20)
        b={'a':row('a',False,.5)}
        with self.assertRaises(ValueError):m.paired(a,b,20)

    def test_missing_distributions_never_participate_in_cutoff_search(self):
        rows=[row('p',True,.4),row('n',False,.1)]
        error=row('e',True,.99);error['prediction']={'status':'error'}
        self.assertEqual(m.fitted_policy(rows),m.fitted_policy(rows+[error]))


if __name__=='__main__':unittest.main()
