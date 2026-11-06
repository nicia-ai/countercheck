#!/usr/bin/env python3
"""Extend original release verification with the separate calibration scorecards, offline."""
import gzip
import hashlib
import json
from pathlib import Path
import runpy
import sys

ROOT=Path(__file__).resolve().parents[1]
PREP=ROOT/'eval/results/calibration-preparation-2026-11-05'
STUDY=ROOT/'eval/results/separate-calibration-2026-11-05'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def verify_receipts():
    inventory=read(STUDY/'archive-sha256.json')
    for name, expected in inventory.items():
        if Path(name).name != name or digest((STUDY/name).read_bytes()) != expected:
            raise ValueError('Study inventory mismatch: '+name)
    protocol=read(PREP/'protocol.json')
    frozen=read(PREP/'freeze.json')
    approved=read(PREP/'approval.json')
    policy_freeze=read(STUDY/'policy-freeze.json')
    protocol_hash=digest((PREP/'protocol.json').read_bytes())
    if frozen['protocol_sha256'] != protocol_hash or approved['protocol_sha256'] != protocol_hash or approved['owner_approval'] != 'Approved':
        raise ValueError('Frozen protocol/approval differs')
    if approved['max_calls'] != 28800 or approved['reservation_usd'] != 57.6:
        raise ValueError('Approval budget differs')
    for filename,key in [('cohort-registry.json','registry_sha256'),('packet-registry.json','packet_registry_sha256')]:
        if digest((PREP/filename).read_bytes()) != protocol[key]:
            raise ValueError('Preparation registry differs')
    for filename,hashes,key in [('pre-inference-sources.json.gz',protocol['source_files'],'pre_inference_sources_sha256'),('fitting-sources.json.gz',policy_freeze['source_files'],'fitting_sources_sha256')]:
        data=(STUDY/filename).read_bytes()
        sources=json.loads(gzip.decompress(data))
        if digest(data) != policy_freeze[key] or set(sources) != set(hashes) or any(digest(text.encode()) != hashes[p] for p,text in sources.items()):
            raise ValueError('Source snapshot differs: '+filename)
    registry=read(PREP/'cohort-registry.json')
    fit=registry['rows']['fit']; validation=registry['rows']['validation']
    for field in ('id','content_sha256'):
        if set(r[field] for r in fit) & set(r[field] for r in validation):
            raise ValueError('Fit/validation identity/content leakage')
    for field in ('group_id','source_id'):
        if {(r['dataset'],r[field]) for r in fit} & {(r['dataset'],r[field]) for r in validation}:
            raise ValueError('Fit/validation source leakage')
    if any(r['dataset']=='findver' for r in fit+validation):
        raise ValueError('Finance in calibration cohort')
    dispatch=read(STUDY/'validation-dispatch.json')
    if dispatch['policy_freeze_sha256'] != digest((STUDY/'policy-freeze.json').read_bytes()) or dispatch['started_at'] <= policy_freeze['frozen_at']:
        raise ValueError('Validation dispatch does not follow freeze')
    count=0
    for role, rows in [('fit',fit),('validation',validation)]:
        execution=read(STUDY/f'{role}-execution.json')
        checkpoints=json.loads(gzip.decompress((STUDY/f'{role}-checkpoints.json.gz').read_bytes()))
        observed=[json.loads(line) for line in gzip.decompress((STUDY/f'{role}-observations.redacted.jsonl.gz').read_bytes()).splitlines()]
        by_model={}
        for observation in observed:
            by_model.setdefault(observation['model'],[]).append(observation['row']['prediction'])
        source=protocol['manifests'][role]
        if execution['manifest_sha256'] != source['sha256'] or len(rows) != source['pairs']:
            raise ValueError('Execution manifest mismatch')
        models={m['model']:m for m in protocol['accounting']['models']}
        if set(execution['artifacts']) != set(models):
            raise ValueError('Execution model coverage mismatch')
        for model,artifact in execution['artifacts'].items():
            checkpoint=checkpoints[model]
            if digest(checkpoint['predictions_utf8'].encode()) != artifact['predictions_sha256'] or digest(checkpoint['metadata_utf8'].encode()) != artifact['metadata_sha256']:
                raise ValueError('Original checkpoint digest differs')
            predictions=[json.loads(line) for line in checkpoint['predictions_utf8'].splitlines()]
            metadata=json.loads(checkpoint['metadata_utf8'])
            if metadata != artifact['metadata'] or predictions != by_model[model]:
                raise ValueError('Redacted observations differ from original checkpoint')
            source_protocol=metadata['source_protocol']
            if metadata['model'] != model or metadata['backend'] != models[model]['backend'] or metadata['manifest_sha256'] != source['sha256']:
                raise ValueError('Execution route/model/manifest mismatch')
            if metadata['selected_pair_ids'] != list(dict.fromkeys(metadata['selected_pair_ids'])) or set(metadata['selected_pair_ids']) != {r['id'] for r in rows}:
                raise ValueError('Selected pair coverage differs')
            expected=dict(profile='balanced-v1', passes=1, presentation='original', batch_size=1, concurrency=1, timeout_ms=3000)
            if any(source_protocol[k] != v for k,v in expected.items()):
                raise ValueError('Execution protocol differs')
            count+=metadata['expected_pair_observations']
            if metadata['expected_pair_observations'] != len(rows):
                raise ValueError('Execution observation count differs')
        if execution['observations'] != len(rows)*len(models):
            raise ValueError('Execution total differs')
    if count != approved['max_calls'] or count*.002 != approved['reservation_usd']:
        raise ValueError('Observed calls exceed/differ from approved plan')
    source_receipt=read(STUDY/'analysis-provenance.json')
    analysis_sources=json.loads(gzip.decompress((STUDY/'analysis-sources.json.gz').read_bytes()))
    if set(analysis_sources)!=set(source_receipt['source_files']) or any(digest(text.encode())!=source_receipt['source_files'][p] for p,text in analysis_sources.items()):
        raise ValueError('Analysis source snapshot differs')
    if source_receipt['protocol_sha256']!=protocol_hash or source_receipt['approval_sha256']!=digest((PREP/'approval.json').read_bytes()) or source_receipt['policy_freeze_sha256']!=digest((STUDY/'policy-freeze.json').read_bytes()):
        raise ValueError('Analysis receipt lineage differs')
    for name,expected in source_receipt['input_artifacts'].items():
        if Path(name).name!=name or digest((STUDY/name).read_bytes())!=expected:
            raise ValueError('Analysis input digest differs')
    for path,expected in source_receipt['source_files'].items():
        if digest((ROOT/path).read_bytes()) != expected:
            raise ValueError('Analysis implementation differs: '+path)


def main():
    if len(sys.argv)!=1:
        raise ValueError('No arguments supported; verify the frozen release and study')
    verify_receipts()
    runpy.run_path(str(ROOT/'scripts/verify-eval-release.py'),run_name='__main__')
    runpy.run_path(str(ROOT/'scripts/analyze-calibration-study.py'),run_name='__main__')


if __name__=='__main__':
    main()
