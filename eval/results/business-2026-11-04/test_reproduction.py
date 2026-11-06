"""Focused denominator regressions, plus checks on the three actual partial runs."""
import json
from pathlib import Path
import runpy
import unittest

HERE = Path(__file__).resolve().parent
metric = runpy.run_path(str(HERE / 'metrics.py'), run_name='metric_test_helpers')['metrics']


def pair(identity, positive):
    return dict(id=identity, dataset='mnli', gold='contradiction' if positive else 'non_contradiction', native_label='contradiction' if positive else 'entailment')


class Denominators(unittest.TestCase):
    def test_error_and_exclusion_keep_class_denominators_but_do_not_invent_scores(self):
        rows = [pair('p-score', True), pair('p-error', True), pair('n-score', False), pair('n-excluded', False)]
        actual = metric(rows, {'p-score': 'contradiction', 'p-error': 'error', 'n-score': 'no_contradiction', 'n-excluded': 'excluded'}, {'p-score': .9, 'n-score': .2})
        self.assertEqual((actual['cases'], actual['positive'], actual['negative'], actual['probability_denominator']), (4, 2, 2, 2))
        self.assertEqual((actual['recall'], actual['clear_negative_coverage']), (.5, .5))
        self.assertEqual((actual['errors'], actual['excluded']), (1, 1))
        self.assertAlmostEqual(actual['brier'], .025)
        self.assertEqual((actual['auroc'], actual['pr_auc_average_precision']), (1, 1))

    def test_entirely_unscored_has_no_probability_metrics(self):
        actual = metric([pair('p', True), pair('n', False)], {'p': 'error', 'n': 'excluded'}, {})
        self.assertEqual(actual['probability_denominator'], 0)
        self.assertEqual(actual['recall'], 0)
        self.assertIsNone(actual['brier'])
        self.assertIsNone(actual['auroc'])
        self.assertIsNone(actual['pr_auc_average_precision'])

    def test_actual_partial_run_denominators(self):
        runs = json.loads((HERE / 'summary.json').read_bytes())['runs']
        for name in ('business-mnli-decider-balanced', 'business-mnli-decider-evidence-refutation'):
            result = runs[name]['metrics']
            self.assertEqual((result['cases'], result['probability_denominator'], result['errors']), (200, 199, 1))
        finance = runs['business-findver-deberta-replay']['metrics']
        self.assertEqual((finance['cases'], finance['positive'], finance['negative'], finance['probability_denominator'], finance['excluded']), (23, 13, 10, 20, 3))


if __name__ == '__main__':
    unittest.main()
