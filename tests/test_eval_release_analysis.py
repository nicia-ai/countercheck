"""Analytic fixtures for retrospective thresholds and paired group resampling."""
import runpy
from pathlib import Path
import unittest

API = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/analyze-eval-release.py'),
                     run_name='analysis_fixture')


def row(identity, group, positive, score=None, verdict='uncertain'):
    return {'pair': {'id': identity, 'group_id': group,
                     'gold': 'contradiction' if positive else 'non_contradiction',
                     'native_label': 'positive' if positive else 'negative'},
            'prediction': {'status': 'error'} if score is None else
            {'status': 'ok', 'verdict': verdict, 'raw_scores': {'contradiction': score},
             'probabilities': {'contradiction': score}}}


class AnalysisTests(unittest.TestCase):
    def test_ties_cannot_be_split_to_manufacture_precision(self):
        values = [row('p1', 'a', True, .95), row('p2', 'b', True, .8),
                  row('n1', 'c', False, .8), row('n2', 'd', False, .2),
                  row('missing', 'e', True)]
        # Binary normalization must not split an identical provider-score tie.
        values[1]['prediction']['probabilities']['contradiction'] = .8000000000000002
        result = API['precision_frontier'](values)
        self.assertEqual((result['true_positive'], result['false_positive']), (1, 0))
        self.assertEqual(result['recall'], 1 / 3)
        self.assertEqual(result['threshold'], .95)
        self.assertEqual(result['probability_denominator'], 4)
        broader = API['precision_frontier'](values, .5)
        self.assertEqual((broader['true_positive'], broader['false_positive']), (2, 1))
        self.assertEqual(broader['recall'], 2 / 3)

    def test_no_qualifying_nonempty_threshold_is_explicit(self):
        result = API['precision_frontier']([row('p', 'a', True, .1), row('n', 'b', False, .9)])
        self.assertFalse(result['nonempty_qualifying_threshold'])
        self.assertIsNone(result['precision'])
        self.assertIsNone(result['threshold'])
        self.assertEqual(result['recall'], 0)

    def test_zero_score_is_a_real_candidate(self):
        result = API['precision_frontier']([row('p', 'a', True, 0)])
        self.assertEqual(result['threshold'], 0)
        self.assertEqual(result['recall'], 1)

    def test_recall_without_native_positives_is_undefined(self):
        self.assertIsNone(API['precision_frontier']([row('n', 'a', False, .1)])['recall'])

    def test_errors_and_abstentions_remain_in_shipped_denominators(self):
        rows = [row('tp', 'a', True, .9, 'contradiction'), row('error', 'b', True),
                row('tn', 'c', False, .1, 'no_contradiction'), row('uncertain', 'd', False, .4)]
        result = API['measures'](API['counts'](rows))
        self.assertEqual(result, {'f1': 2 / 3, 'recall': .5, 'clear_negative_coverage': .5})

    def test_identical_paired_outputs_have_zero_differences(self):
        values = {r['pair']['id']: r for r in [row('p', 'a', True, .9, 'contradiction'),
                                             row('n', 'a', False, .1, 'no_contradiction')]}
        result = API['paired'](values, values, replicates=100)
        self.assertEqual(result['source_groups'], 1)
        for value in result['metrics'].values():
            self.assertEqual(value['difference'], 0)
            self.assertEqual(value['percentile_95'], [0, 0])
            self.assertEqual(value['valid_replicates'], 100)

    def test_two_opposing_source_groups_have_known_extremes(self):
        a = [row('p1', 'one', True, .9, 'contradiction'), row('n1', 'one', False, .1, 'no_contradiction'),
             row('p2', 'two', True, .4), row('n2', 'two', False, .4)]
        b = [row('p1', 'one', True, .4), row('n1', 'one', False, .4),
             row('p2', 'two', True, .9, 'contradiction'), row('n2', 'two', False, .1, 'no_contradiction')]
        result = API['paired']({r['pair']['id']: r for r in a}, {r['pair']['id']: r for r in b}, replicates=1000)
        reversed_result = API['paired']({r['pair']['id']: r for r in reversed(a)},
                                        {r['pair']['id']: r for r in reversed(b)}, replicates=1000)
        self.assertEqual(result, reversed_result)
        for value in result['metrics'].values():
            self.assertEqual(value['difference'], 0)
            self.assertEqual(value['percentile_95'], [-1, 1])

    def test_mismatched_pairing_and_empty_data_are_rejected(self):
        a = {'p': row('p', 'a', True, .9)}
        for b in ({}, {'other': row('other', 'a', True, .9)}, {'p': row('p', 'a', False, .9)}):
            with self.assertRaises(ValueError):
                API['paired'](a, b, replicates=10)
        with self.assertRaises(ValueError):
            API['paired']({}, {}, replicates=10)


if __name__ == '__main__':
    unittest.main()
