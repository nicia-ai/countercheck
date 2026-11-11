"""Fixture runs for the measurement archiver: redaction, comparability guards and offline verification."""
import gzip
import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
API = runpy.run_path(str(SCRIPTS / 'archive-measurement.py'), run_name='measurement_archive_fixture')
SCREEN = runpy.run_path(str(SCRIPTS / 'screen-models.py'), run_name='measurement_screen_fixture')
DATASET = 'fixture'
MODEL = 'vendor/new-model'
INPUT_ID = 'fixture-input'
REFERENCE_SOURCE = 'reference.jsonl.gz'
FROZEN_SOURCE = 'kernel.ts'
PAIR_COUNT = 12
PROMPT_VERSION = 'pair-relation-v1'
SECRET_CLAIM = 'Private claim text that must never be archived'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pair(index):
    return {'id': f'pair-{index}', 'dataset': DATASET, 'group_id': f'group-{index // 2}', 'native_label': 'fixture',
            'gold': 'contradiction' if index % 2 == 0 else 'non_contradiction',
            'claim': f'{SECRET_CLAIM} {index}', 'evidence': f'Private evidence {index}'}


def prediction(index, model, score):
    return {'pair_id': f'pair-{index}', 'pass': 1, 'status': 'ok', 'latency_ms': 100.0 + index, 'model': model,
            'reported_model': f'{model}-20261111', 'prompt_version': PROMPT_VERSION, 'threshold_version': 'evaluation-0.8-0.2-v1',
            'verdict': 'contradiction' if score >= .8 else 'no_contradiction',
            'probabilities': {'contradiction': score, 'no_contradiction': 1 - score, 'insufficient_context': 0.0}}


class MeasurementRun:
    """Writes the files `pnpm eval:measure` leaves behind, with full pair text, under a temporary root."""

    def __init__(self, root):
        self.root, self.run = root, root / 'run'
        self.run.mkdir()
        self.pairs = [pair(index) for index in range(PAIR_COUNT)]
        self.predictions = [prediction(index, MODEL, .9 if index % 2 == 0 else .1) for index in range(PAIR_COUNT)]
        self.status = 'complete'
        reference = [{'model': 'reference', 'dataset': DATASET, 'row': {
            'pair': {**item, 'claim': '[not archived]', 'evidence': '[not archived]'},
            'prediction': prediction(index, 'reference', .9 if index % 4 == 0 else .1),
            'text_provenance': API['text_provenance'](item)}} for index, item in enumerate(self.pairs)]
        (root / REFERENCE_SOURCE).write_bytes(gzip.compress('\n'.join(map(json.dumps, reference)).encode()))
        (root / FROZEN_SOURCE).write_text('frozen kernel')

    def write(self):
        manifest = json.dumps({'pairs': self.pairs}).encode()
        (self.root / 'input.json').write_bytes(manifest)
        cohort = {'id': 'fixture-cohort', 'description': 'fixture', 'datasets': [DATASET], 'sources': [REFERENCE_SOURCE],
                  'inputs': [{'id': INPUT_ID, 'path': 'input.json', 'sha256': sha(manifest), 'pairs': PAIR_COUNT}]}
        checkpoint = '\n'.join(map(json.dumps, self.predictions)).encode()
        files = {
            'protocol.json': {'backend': 'fixture-backend', 'created_at': '2026-11-11T00:00:00.000Z', 'cohort': cohort,
                              'frozen_sources': {FROZEN_SOURCE: sha(b'frozen kernel')}},
            'progress.json': {'status': self.status, 'probe': {'pairs': 8, 'completed': 8, 'errors': 0, 'excluded': 0}},
            'execution-sources.json': {FROZEN_SOURCE: 'frozen kernel'},
            f'{INPUT_ID}.json': {'manifest_sha256': sha(manifest), 'prediction_artifact': {'sha256': sha(checkpoint)},
                                 'prediction_metadata': {'model': MODEL},
                                 'rows': [{'pair': item, 'prediction': predicted} for item, predicted in zip(self.pairs, self.predictions)]},
        }
        for name, value in files.items():
            (self.run / name).write_text(json.dumps(value))
        (self.run / f'{INPUT_ID}.predictions.jsonl').write_bytes(checkpoint)
        (self.run / f'{INPUT_ID}.http-status.jsonl').write_text('\n'.join(json.dumps({'sequence': n, 'status': 200}) for n in range(PAIR_COUNT)))
        return cohort


class MeasurementArchiveTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.fixture = MeasurementRun(self.root)
        self.archive = self.root / 'archive'

    def create(self):
        cohort = self.fixture.write()
        return cohort, API['create'](self.fixture.run, self.archive, self.root)

    def assert_rejected(self, expected_message):
        with self.assertRaises(API['MeasurementArchiveError']) as raised:
            self.create()
        print(f'rejected: {raised.exception}')
        self.assertIn(expected_message, str(raised.exception))
        self.assertFalse(self.archive.exists(), 'a rejected run must leave no partial archive')

    def test_archive_contains_no_pair_text_and_feeds_the_screen(self):
        cohort, receipt = self.create()
        print(json.dumps(receipt))
        self.assertEqual(receipt, {'verified_model': MODEL, 'cohort': 'fixture-cohort', 'observations': PAIR_COUNT, 'network_calls': 0})
        for path in self.archive.iterdir():
            data = path.read_bytes()
            self.assertNotIn(SECRET_CLAIM.encode(), gzip.decompress(data) if path.suffix == '.gz' else data, path.name)
        (self.root / 'new.jsonl.gz').write_bytes((self.archive / API['OBSERVATIONS']).read_bytes())
        screened = SCREEN['screen']({'cohorts': [{**cohort, 'sources': [REFERENCE_SOURCE, 'new.jsonl.gz']}]},
                                    root=self.root, replicates=50, seed=3)
        measured = screened['cohorts'][0]['models'][MODEL]
        self.assertEqual((measured['selected'], measured['errors'], measured['macro_average_precision']), (PAIR_COUNT, 0, 1.0))
        summary = json.loads((self.archive / 'summary.json').read_bytes())
        self.assertEqual(summary['operation']['reported_models'], [f'{MODEL}-20261111'])
        self.assertEqual(summary['scorecards'][DATASET]['recall'], 1.0)

    def test_text_that_differs_from_the_frozen_cohort_is_rejected(self):
        self.fixture.pairs[3]['evidence'] = 'Edited evidence'
        self.assert_rejected('text differs')

    def test_relabelled_pair_is_rejected(self):
        self.fixture.pairs[3]['gold'] = 'contradiction'
        self.assert_rejected('label or group changed')

    def test_unreviewed_prediction_field_is_rejected_before_archiving(self):
        self.fixture.predictions[0]['upstream_error_body'] = 'provider text'
        self.assert_rejected('unreviewed prediction field')

    def test_prompt_version_drift_is_rejected(self):
        self.fixture.predictions[0]['prompt_version'] = 'pair-relation-v2'
        self.assert_rejected('prompt or threshold version differs')

    def test_incomplete_run_is_rejected(self):
        self.fixture.status = 'running'
        self.assert_rejected('incomplete')

    def test_partial_coverage_is_rejected(self):
        self.fixture.pairs.pop()
        self.fixture.predictions.pop()
        self.fixture.write()
        protocol = json.loads((self.fixture.run / 'protocol.json').read_text())
        self.assertEqual(protocol['cohort']['inputs'][0]['pairs'], PAIR_COUNT)
        with self.assertRaises(API['MeasurementArchiveError']):
            API['create'](self.fixture.run, self.archive, self.root)

    def test_verification_detects_an_edited_observation(self):
        self.create()
        path = self.archive / API['OBSERVATIONS']
        rows = [json.loads(line) for line in gzip.decompress(path.read_bytes()).splitlines()]
        rows[0]['row']['prediction']['probabilities']['contradiction'] = .01
        edited = API['packed_observations'](rows)
        path.write_bytes(edited)
        with self.assertRaises(API['MeasurementArchiveError']):
            API['verify'](self.archive, self.root)
        manifest = json.loads((self.archive / API['MANIFEST']).read_bytes())
        manifest[API['OBSERVATIONS']] = sha(edited)
        (self.archive / API['MANIFEST']).write_text(json.dumps(manifest))
        with self.assertRaises(API['MeasurementArchiveError']) as raised:
            API['verify'](self.archive, self.root)
        self.assertIn('Summary differs', str(raised.exception))


if __name__ == '__main__':
    unittest.main()
