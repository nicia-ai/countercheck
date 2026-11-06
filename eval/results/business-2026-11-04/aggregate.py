#!/usr/bin/env python3
"""Verify archived business metrics offline, including finance's text-redacted inputs."""
import csv
import gzip
import hashlib
import json
import math
from pathlib import Path
import runpy

HERE = Path(__file__).resolve().parent
# run_path compiles these pure helpers without artifact-directory __pycache__ imports.
HELPERS = runpy.run_path(str(HERE / 'metrics.py'), run_name='business_metric_helpers')
metrics, compose, close = (HELPERS[name] for name in ('metrics', 'compose', 'close'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify(actual, recorded):
    confusion = recorded['confusion']
    for name, field in [('tp', 'true_positive'), ('fp', 'false_positive'), ('tn', 'true_negative'), ('false_clears', 'definitive_false_negative')]:
        assert actual[name] == confusion[field], (name, actual[name], confusion[field])
    for name in ('precision', 'recall', 'clear_negative_coverage'):
        close(actual[name], recorded[name]['value'])
    for name in ('auroc', 'pr_auc_average_precision', 'brier'):
        close(actual[name], recorded[name])
    for name in ('f1',):close(actual[name], recorded[name])
    for name in ('coverage', 'false_positive_rate', 'completion'):close(actual[name], recorded[name]['value'])
    assert actual['probability_denominator'] == recorded['probability_denominator']
    assert actual['errors'] == recorded['errors'] and actual['excluded'] == recorded['excluded']


def main():
    inventory = json.loads((HERE / 'artifact-sha256.json').read_bytes())
    blobs, entries = {}, {}
    for entry in inventory['artifacts']:
        stored = (HERE / entry['archive']).read_bytes()
        assert len(stored) == entry['stored_bytes'] and sha(stored) == entry['stored_sha256']
        if entry['encoding'] == 'gzip-mtime0':
            assert stored[4:8] == b'\0' * 4
            content = gzip.decompress(stored)
        else:
            assert entry['encoding'] == 'identity'
            content = stored
        assert sha(content) == entry['content_sha256']
        if entry['transformation'] == 'none':
            assert sha(content) == entry['original_sha256'] and len(content) == entry['original_bytes']
        else:
            assert entry['transformation'] == 'finance-pair-text-redaction-v1'
            assert 'findver' in entry['archive']
        blobs[entry['archive']], entries[entry['archive']] = content, entry
    read = lambda name: json.loads(blobs[name])
    manifests = {}
    for domain in ('contractnli', 'mnli', 'findver', 'findver-individual'):
        name = f'inputs/{domain}.manifest.json.gz'
        if name in blobs:
            manifests[entries[name]['original_sha256']] = read(name)
            if domain.startswith('findver'):
                assert all('claim' not in pair and 'evidence' not in pair and len(pair['claim_sha256']) == len(pair['evidence_sha256']) == 64 for pair in manifests[entries[name]['original_sha256']]['pairs'])
    snapshots = {}
    for name in blobs:
        if name.startswith('execution/') and name.endswith('.freeze.json'):
            freeze = read(name)
            source_name = name.replace('.freeze.json', '.sources.json.gz')
            source = json.loads(gzip.decompress(blobs[source_name]))
            assert set(source) == set(freeze['source_files'])
            assert all(sha(source[file].encode()) == digest for file, digest in freeze['source_files'].items())
            snapshots[name] = dict(created_at=freeze['created_at'], files=len(source))
    summaries, csv_rows, requests = {}, [], {}
    for name in sorted(blobs):
        if not name.startswith('runs/') or not name.endswith('/report.json.gz'):
            continue
        run = name.split('/')[1]
        domain = run.split('-')[1]
        prefix = f'runs/{run}'
        report = read(name)
        iteration = report.get('kind') == 'decision-quality-iteration'
        if iteration:
            assert report['source_stable'] is True
            freeze = report['freeze']
            assert freeze == read(prefix + '/freeze.json')
            source = json.loads(gzip.decompress(blobs[prefix + '/sources.json.gz']))
            assert all(sha(source[file].encode()) == digest for file, digest in freeze['source_files'].items())
            manifest_sha = freeze['manifest_sha256']
            profile = freeze['profiles'][0]
            assert len(freeze['profiles']) == freeze['passes'] == 1
            recorded = report['summaries'][profile]['binary']['overall']
            observations = report['observations']
            row_data = [(observation['pair_id'], observation['prediction'], observation) for observation in observations]
            hosted = True
        else:
            manifest_sha = report['manifest_sha256']
            profile = report['protocol'].get('profile') or ('deberta-forced' if 'deberta' in run else 'balanced-v1')
            recorded = report['overall']
            row_data = [(row['pair']['id'], row['prediction'], row) for row in report['rows']]
            hosted = report['backend'] != 'replay'
        manifest = manifests[manifest_sha]
        pair_list = manifest['pairs']
        pairs = {pair['id']: pair for pair in pair_list}
        allowed = {'contractnli': ('Entailment','Contradiction'), 'mnli': ('entailment','neutral','contradiction'), 'findver': ('entailed','refuted')}[domain]
        assert all(pair['native_label'] in allowed and (pair['gold']=='contradiction')==(pair['native_label'] in ('Contradiction','contradiction','refuted')) for pair in pair_list)
        assert len(pairs) == len(pair_list) == len(row_data)
        checkpoint_bytes = blobs[prefix + '/predictions.jsonl.gz']
        checkpoint = [json.loads(line) for line in checkpoint_bytes.splitlines()]
        by_id = {prediction['pair_id']: prediction for prediction in checkpoint}
        assert len(checkpoint) == len(by_id) == len(pair_list)
        metadata_name = prefix + '/checkpoint-metadata.json'
        metadata = read(metadata_name)
        assert metadata['manifest_sha256'] == manifest_sha
        if not iteration:
            assert report['prediction_metadata'] == metadata
            assert report['prediction_artifact']['sha256'] == sha(checkpoint_bytes)
            assert report['prediction_artifact']['metadata_sha256'] == sha(blobs[metadata_name])
        else:
            assert metadata['protocol'] == freeze and metadata['freeze_sha256'] == sha(json.dumps(freeze, separators=(',', ':'), ensure_ascii=False).encode())
        verdicts, scores, models, returned, statuses = {}, {}, set(), set(), {}
        for pair_id, prediction, raw in row_data:
            assert pair_id in pairs and prediction['pair_id'] == pair_id and prediction['pass'] == 1
            saved = by_id[pair_id]
            assert all(saved[key] == value for key, value in prediction.items())
            status = prediction['status']
            statuses[status] = statuses.get(status, 0) + 1
            verdicts[pair_id] = prediction.get('verdict', status)
            models.add(prediction.get('model'))
            returned.add(prediction.get('reported_model'))
            if not iteration:
                assert raw['pair'] == pairs[pair_id]
            if status == 'ok':
                probabilities = prediction['probabilities']
                assert all(math.isfinite(value) and 0 <= value <= 1 for value in probabilities.values())
                assert math.isclose(sum(probabilities.values()), 1, abs_tol=.001)
                scores[pair_id] = probabilities['contradiction']
                if iteration:
                    assert prediction['prompt_hash'] == raw['prompt_sha256'] and raw['provider_calls'] == 1
                    assert verdicts[pair_id] == compose(raw['features'])
                elif hosted:
                    values = prediction['raw_scores']
                    expected = 'contradiction' if values['contradiction'] >= .8 else 'no_contradiction' if values['contradiction'] <= .2 and max(values['consistent'], values['different_scope']) >= .8 else 'uncertain'
                    assert verdicts[pair_id] == expected
                else:
                    nli = prediction['nli_probabilities']
                    label = max(('contradiction', 'entailment', 'neutral'), key=lambda label: nli[label])
                    assert verdicts[pair_id] == ('contradiction' if label == 'contradiction' else 'no_contradiction')
            if hosted:
                request_identity = prediction.get('request_id')
                if request_identity is None:
                    assert not iteration and status != 'ok'
                    matches = [request for request in report['request_observations'] if request['pair_ids'] == [pair_id] and request['pass'] == prediction['pass']]
                    assert len(matches) == 1
                    request_identity = 'observation:' + pair_id + ':' + str(prediction['pass'])
                key = (run, request_identity)
                assert key not in requests
                requests[key] = dict(backend=(freeze.get('execution', {}).get('backend') or prediction.get('provider')) if iteration else report['backend'], usage=prediction.get('request_usage', {'input_tokens': None, 'output_tokens': None}))
        # Errors stay in confusion/recall denominators. Scores are not imputed for missing predictions.
        actual = metrics(pair_list, verdicts, scores)
        verify(actual, recorded)
        slices = {}
        field = 'genre' if domain == 'mnli' else 'hypothesis_id' if domain == 'contractnli' else 'native_label'
        for label in sorted({pair.get('source_metadata', {}).get(field, pair['native_label']) for pair in pair_list}):
            subset = [pair for pair in pair_list if pair.get('source_metadata', {}).get(field, pair['native_label']) == label]
            subset_verdicts = {pair['id']: verdicts[pair['id']] for pair in subset}
            slices[label] = metrics(subset, subset_verdicts, scores)
        cohort = 'individual-supported-82' if 'individual' in run else 'whole-source-23' if domain == 'findver' else 'primary'
        summary = dict(domain=domain, cohort=cohort, profile=profile, hosted=hosted, pair_ids=sorted(pairs), excluded_pair_ids=sorted(pair_id for pair_id, verdict in verdicts.items() if verdict=='excluded'), payload_hashes={pair_id: prediction.get('prompt_hash') for pair_id, prediction, _ in row_data}, models=sorted(model for model in models if model is not None), returned_models=sorted(model for model in returned if model is not None), missing_returned_model_rows=sum(prediction.get('reported_model') is None for _, prediction, _ in row_data), input_manifest_sha256=manifest_sha, source_groups=len({pair['group_id'] for pair in pair_list}), statuses=statuses, metrics=actual, slice_field=field, slices=slices)
        summaries[run] = summary
        csv_rows.append(dict(run=run, domain=domain, cohort=cohort, profile=profile, **actual))
    finance = {name: summary for name, summary in summaries.items() if summary['domain']=='findver'}
    overlap = None
    if any('individual' in name for name in finance):
        first = next(summary for name,summary in finance.items()if 'individual' not in name)
        second = next(summary for name,summary in finance.items()if 'individual' in name)
        common = set(first['pair_ids']) & set(second['pair_ids'])
        assert len(common)==23 and len(set(second['pair_ids'])-common)==59
        finance_inputs = [manifest for manifest in manifests.values()if manifest['pairs'][0]['dataset']=='findver']
        maps = [{pair['id']:pair for pair in manifest['pairs']}for manifest in finance_inputs]
        assert len(maps)==2
        for identity in common:
            for field in ('claim_sha256','evidence_sha256','native_label','gold','group_id'):
                assert maps[0][identity][field]==maps[1][identity][field]
        payloads = {}
        for backend in ('jev','clef','decider'):
            first=finance[f'business-findver-{backend}-balanced'];second=finance[f'business-findver-individual-{backend}-balanced']
            payloads[backend]=sum(first['payload_hashes'][identity]==second['payload_hashes'][identity] for identity in common)
            assert payloads[backend]==23
        overlap=dict(shared_pairs=23,new_individual_pairs=59,claim_evidence_hashes_and_native_labels='identical',shared_payload_hashes=payloads,independent_new_cases=False)
    for summary in summaries.values():summary.pop('payload_hashes')
    usage = {}
    for request in requests.values():
        entry = usage.setdefault(request['backend'], dict(requests=0, input_tokens_reported=0, output_tokens_reported=0, unknown_input_requests=0, unknown_output_requests=0))
        entry['requests'] += 1
        for field in ('input_tokens', 'output_tokens'):
            value = request['usage'].get(field)
            entry['unknown_' + ('input' if field == 'input_tokens' else 'output') + '_requests'] += value is None
            entry['input_tokens_reported' if field == 'input_tokens' else 'output_tokens_reported'] += value or 0
    result = dict(schema_version=1, runs=summaries, hosted_attempts=len(requests), hosted_calls_definition='Single-comparison hosted attempt records; two deadlines do not establish upstream completion or billing. Missing provider request identity uses matched pass/pair observation, not an invented API request ID.', local_pair_observations=sum(summary['metrics']['cases'] for summary in summaries.values() if not summary['hosted']), request_usage=usage, distinct_input_pairs=len({identity for summary in summaries.values()for identity in summary['pair_ids']}), local_exclusion_observations=sum(summary['metrics']['excluded']for summary in summaries.values()if not summary['hosted']), local_distinct_excluded_pairs=len({identity for summary in summaries.values()if not summary['hosted']for identity in summary['excluded_pair_ids']}), finance_cohort_overlap=overlap, source_snapshots=snapshots, verification=dict(artifacts=len(blobs), stored_and_content_hashes='verified', originals='verified except withheld finance originals; their recorded raw SHA cannot be recreated from redacted bytes', snapshots='verified', checkpoints_and_pair_coverage='verified', default_decisions_counts_probabilities_auroc_ap_brier='independently_reproduced', finance='no assertion/evidence text parsed or required from archived inputs', existing_locked_evaluation_files_opened=False), qualification='Separate native dataset adaptations; no universal pooled business quality score, official leaderboard equivalence or service-contract release qualification')
    (HERE / 'summary.json').write_text(json.dumps(result, indent=2, sort_keys=True, allow_nan=False) + '\n')
    fields = ['run', 'domain', 'cohort', 'profile', 'cases', 'positive', 'negative', 'tp', 'fp', 'tn', 'false_clears', 'precision', 'recall', 'clear_negative_coverage', 'errors', 'excluded', 'auroc', 'brier']
    with (HERE / 'summary.csv').open('w', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction='ignore', lineterminator='\n')
        writer.writeheader()
        writer.writerows(csv_rows)
    print(json.dumps(dict(runs=len(summaries), hosted_attempts=len(requests), local_pairs=result['local_pair_observations'], artifacts=len(blobs), finance_text='redacted', existing_locked_evaluation_files_opened=False)))


if __name__ == '__main__':
    main()
