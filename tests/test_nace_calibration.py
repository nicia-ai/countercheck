"""The optimized bootstrap must reproduce the existing source-group algorithm exactly."""
import copy
from pathlib import Path
import runpy
import unittest

ROOT=Path(__file__).resolve().parents[1]
MODULE=runpy.run_path(str(ROOT/'scripts/analyze-nace-calibration.py'),run_name='nace_calibration_test')


def cohort():
    first={}
    verdicts=('contradiction','no_contradiction','uncertain','error')
    for index in range(30):
        pair=dict(id=str(index),dataset='scifact',group_id=str(index//4),
                  gold='contradiction' if index%3==0 else 'non_contradiction',native_label='native-'+str(index%3))
        verdict=verdicts[index%4]
        prediction=dict(status='error') if verdict=='error' else dict(status='ok',verdict=verdict)
        first[str(index)]=dict(pair=pair,prediction=prediction)
    second=copy.deepcopy(first)
    for index,row in enumerate(second.values()):
        if index%5==0:row['prediction']=dict(status='ok',verdict='contradiction')
    return first,second


class NaceCalibrationBootstrap(unittest.TestCase):
    def test_identical_resamples_and_metrics(self):
        first,second=cohort()
        for seed in (1,20261106):
            expected=MODULE['BASE']['paired'](first,second,replicates=1000,seed=seed)
            actual=MODULE['paired_calibration'](first,second,replicates=1000,seed=seed)
            self.assertEqual(actual,expected)

    def test_missing_precision_and_single_large_group(self):
        first,second=cohort()
        for rows in (first,second):
            for row in rows.values():
                row['pair']['group_id']='one-group'
                row['prediction']=dict(status='ok',verdict='uncertain')
        self.assertEqual(MODULE['paired_calibration'](first,second,replicates=100),
                         MODULE['BASE']['paired'](first,second,replicates=100,seed=MODULE['SEED']))

    def test_mismatched_groups_or_coverage_rejected(self):
        first,second=cohort()
        with self.assertRaises(ValueError):MODULE['paired_calibration'](first,{})
        second['0']['pair']['group_id']='wrong'
        with self.assertRaises(ValueError):MODULE['paired_calibration'](first,second)

    def test_contract_controls_do_not_invent_four_way_gold_for_binary_smoke(self):
        policy=dict(positive=.8,negative_cut=.2,negative_support=.8)
        policies={model:dict(variants=dict(primary=dict(policy=policy))) for model in MODULE['MODELS']}
        controls=MODULE['synthetic_controls'](policies)
        self.assertEqual(len(controls),2)
        for control in controls:
            self.assertEqual(control['dataset'],'synthetic-contract')
            self.assertEqual(control['cases'],32)
            self.assertEqual(control['expected_uncertain'],4)
            self.assertEqual(control['shipped_correct'],control['calibrated_correct'])
            self.assertEqual(control['regression_ids'],[])
            self.assertEqual(control['improvement_ids'],[])


if __name__=='__main__':unittest.main()
