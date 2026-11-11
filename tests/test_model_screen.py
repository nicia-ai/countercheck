"""Analytic fixtures for the decision-model viability screen."""
import gzip
import json
from pathlib import Path
import runpy
import tempfile
import unittest

API = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/screen-models.py'),
                     run_name='model_screen_fixture')
DATASET = 'fixture'
GROUPS = 12


def observation(model, index, positive, score, latency=100.0):
    prediction = ({'status': 'error', 'latency_ms': latency} if score is None else
                  {'status': 'ok', 'latency_ms': latency, 'probabilities': {'contradiction': score}})
    return {'model': model, 'dataset': DATASET, 'row': {
        'pair': {'id': f'pair-{index}', 'dataset': DATASET, 'group_id': f'group-{index // 2}',
                 'gold': 'contradiction' if positive else 'non_contradiction', 'native_label': 'fixture'},
        'prediction': prediction}}


def model_rows(model, separates, latency):
    """Each group holds one positive and one negative; a separating model ranks every positive first."""
    rows = []
    for group in range(GROUPS):
        ranks_correctly = separates or group % 2 == 0
        rows.append(observation(model, 2 * group, True, .9 if ranks_correctly else .1, latency))
        rows.append(observation(model, 2 * group + 1, False, .2, latency))
    return rows


def write_source(directory, name, observations):
    path = directory / name
    path.write_bytes(gzip.compress('\n'.join(json.dumps(item) for item in observations).encode()))
    return name


def cohort(identity, sources):
    return {'id': identity, 'description': identity, 'datasets': [DATASET], 'sources': sources}


def comparison(dominates, challenger_not_slower, candidate_faster):
    return {'quality_dominates': dominates, 'challenger_not_slower': challenger_not_slower,
            'candidate_faster': candidate_faster}


class ClassificationTests(unittest.TestCase):
    def test_replicated_dominance_by_a_no_slower_model_screens_out(self):
        evidence = {'a': comparison(True, True, False), 'b': comparison(True, True, False)}
        self.assertEqual(API['classify'](evidence), API['STATUS_SCREENED_OUT'])

    def test_single_cohort_dominance_only_deprioritizes(self):
        self.assertEqual(API['classify']({'a': comparison(True, True, False)}), API['STATUS_DEPRIORITIZED'])

    def test_inconsistent_latency_ordering_only_deprioritizes(self):
        evidence = {'a': comparison(True, True, False), 'b': comparison(True, False, True)}
        self.assertEqual(API['classify'](evidence), API['STATUS_DEPRIORITIZED'])

    def test_consistently_faster_model_keeps_its_place(self):
        evidence = {'a': comparison(True, False, True), 'b': comparison(True, False, True)}
        self.assertIsNone(API['classify'](evidence))

    def test_unreplicated_quality_gap_is_not_dominance(self):
        evidence = {'a': comparison(True, True, False), 'b': comparison(False, True, False)}
        self.assertIsNone(API['classify'](evidence))

    def test_models_without_a_shared_cohort_are_not_compared(self):
        self.assertIsNone(API['classify']({}))


class ScreenTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(tempfile.TemporaryDirectory()))

    def screen(self, cohorts):
        return API['screen']({'cohorts': cohorts}, root=self.directory, replicates=200, seed=7)

    def statuses(self, analysis):
        print(json.dumps([(item['model'], item['status'], [d['model'] for d in item['dominated_by']])
                          for item in analysis['decisions']]))
        return {item['model']: item['status'] for item in analysis['decisions']}

    def test_slower_weaker_model_is_screened_out_only_with_replication(self):
        strong_fast = model_rows('strong-fast', True, 100.0)
        weak_slow = model_rows('weak-slow', False, 300.0)
        weak_fast = model_rows('weak-fast', False, 50.0)
        first = write_source(self.directory, 'first.jsonl.gz', strong_fast + weak_slow + weak_fast)
        second = write_source(self.directory, 'second.jsonl.gz', strong_fast + weak_slow + weak_fast)
        replicated = self.statuses(self.screen([cohort('one', [first]), cohort('two', [second])]))
        self.assertEqual(replicated, {'strong-fast': API['STATUS_VIABLE'], 'weak-fast': API['STATUS_VIABLE'],
                                      'weak-slow': API['STATUS_SCREENED_OUT']})
        single = self.statuses(self.screen([cohort('one', [first])]))
        self.assertEqual(single['weak-slow'], API['STATUS_DEPRIORITIZED'])

    def test_later_source_replaces_a_remeasured_model(self):
        original = write_source(self.directory, 'original.jsonl.gz',
                                model_rows('strong-fast', True, 100.0) + model_rows('candidate', False, 300.0))
        remeasured = write_source(self.directory, 'remeasured.jsonl.gz', model_rows('candidate', True, 300.0))
        analysis = self.screen([cohort('one', [original, remeasured]), cohort('two', [original, remeasured])])
        self.assertEqual(self.statuses(analysis)['candidate'], API['STATUS_VIABLE'])

    def test_errors_are_flagged_instead_of_lowering_ranking_quality(self):
        unreliable = model_rows('unreliable', True, 100.0)
        unreliable[1] = observation('unreliable', 1, False, None)
        source = write_source(self.directory, 'errors.jsonl.gz', unreliable + model_rows('steady', True, 100.0))
        analysis = self.screen([cohort('one', [source])])
        measured = analysis['cohorts'][0]['models']['unreliable']
        self.assertEqual((measured['errors'], measured['macro_average_precision']), (1, 1.0))
        self.assertTrue(measured['reliability_flag'])
        self.assertEqual(analysis['decisions'][1]['reliability_flags'], ['one'])

    def test_models_measured_on_different_pairs_are_rejected(self):
        shifted = [observation('shifted', index + 100, index % 2 == 0, .5) for index in range(2 * GROUPS)]
        source = write_source(self.directory, 'mismatch.jsonl.gz', model_rows('steady', True, 100.0) + shifted)
        with self.assertRaises(API['ScreenError']):
            self.screen([cohort('one', [source])])

    def test_archived_screen_stays_verifiable_after_a_source_is_appended(self):
        first = write_source(self.directory, 'first.jsonl.gz', model_rows('steady', True, 100.0))
        files, _ = API['artifacts']({'cohorts': [cohort('one', [first])]}, root=self.directory)
        archive = self.directory / 'screen'
        archive.mkdir()
        for name, data in files.items():
            (archive / name).write_bytes(data)
        write_source(self.directory, 'later.jsonl.gz', model_rows('newcomer', True, 50.0))
        self.assertEqual(API['verify'](archive, root=self.directory)['verified_models'], 1)
        (self.directory / first).write_bytes(gzip.compress(b''))
        with self.assertRaises(API['ScreenError']):
            API['verify'](archive, root=self.directory)

    def test_repeated_pair_in_one_source_is_rejected(self):
        rows = model_rows('steady', True, 100.0)
        source = write_source(self.directory, 'repeat.jsonl.gz', rows + rows[:1])
        with self.assertRaises(API['ScreenError']):
            self.screen([cohort('one', [source])])


if __name__ == '__main__':
    unittest.main()
