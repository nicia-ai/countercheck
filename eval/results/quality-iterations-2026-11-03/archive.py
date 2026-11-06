#!/usr/bin/env python3
"""Append exact completed local iteration artifacts; no network/model calls.
Raw locked input is copied/hash-verified without JSON parsing or label inspection.
Locked EVALUATION outputs require explicit --include-locked-evaluation after authorization.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main(include_locked):
    inventory_path = HERE / 'artifact-sha256.json'
    inventory = json.loads(inventory_path.read_bytes()) if inventory_path.exists() else {'schema_version': 1, 'artifacts': []}
    entries = {e['archive']: e for e in inventory['artifacts']}

    def add(source, name, compress=False, note=None):
        original = source.read_bytes()  # Raw byte copying, never parsing the locked manifest.
        if compress:
            stream = io.BytesIO()
            with gzip.GzipFile(fileobj=stream, filename='', mode='wb', mtime=0, compresslevel=9) as handle:
                handle.write(original)
            stored = stream.getvalue()
        else:
            stored = original
        entry = dict(source=str(source.relative_to(ROOT)), archive=name, encoding='gzip-mtime0' if compress else 'identity', original_sha256=sha(original), original_bytes=len(original), stored_sha256=sha(stored), stored_bytes=len(stored))
        if note:
            entry['note'] = note
        target = HERE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            assert target.read_bytes() == stored, f'Refusing changed measured artifact {name}'
        else:
            with target.open('xb') as handle:
                handle.write(stored)
        if name in entries:
            assert entries[name] == entry, f'Refusing changed provenance {name}'
        entries[name] = entry

    for source in HERE.glob('*protocol.json'):
        add(source, 'protocols/' + source.name)
    for role in ('screen', 'fit', 'validation', 'locked-holdout'):
        source = ROOT / f'eval/data/iteration-{role}.json'
        add(source, f'inputs/{role}.manifest.gz', True, 'Raw locked input archived without parsing gold' if role == 'locked-holdout' else None)
    add(ROOT / 'eval/data/iteration-index.json', 'inputs/source-lock.json')
    add(ROOT / 'eval/fixtures/synthetic-smoke.json', 'inputs/synthetic-probe.manifest.gz', True)
    add(ROOT / 'eval/fixtures/prompt-ablation-contract.json', 'inputs/synthetic-contract.manifest.gz', True)
    for source in sorted((ROOT / 'eval/reports').glob('run-quality*.mjs')):
        add(source, 'orchestration/' + source.name + '.txt', False, 'Exact operator orchestration source; environment variable names and local paths are provenance, not credential values')
    for name, source in [('public-vitaminc', 'eval/data/vitaminc-combined-dev-200.json'), ('public-scifact', 'eval/data/scifact-dev-200.json'), ('expanded-fit','eval/data/iteration-expanded-fit.json'), ('expanded-extra-fit','eval/data/iteration-expanded-extra-fit.json')]:
        path = ROOT / source
        if path.exists():add(path, f'inputs/{name}.manifest.gz', True)
    if (ROOT / 'eval/data/iteration-expanded-index.json').exists():
        add(ROOT / 'eval/data/iteration-expanded-index.json', 'inputs/expanded-source-lock.json')
    if (HERE / 'concurrency-deviation.json').exists():
        add(HERE / 'concurrency-deviation.json', 'execution-audits/concurrency-deviation.json')
    if (HERE / 'archive-appender-incident.json').exists():
        add(HERE / 'archive-appender-incident.json', 'execution-audits/archive-appender-incident.json')
    if (HERE / 'extension-metadata-erratum.json').exists():
        add(HERE / 'extension-metadata-erratum.json', 'execution-audits/extension-metadata-erratum.json')
    completed = set()
    for source in sorted((ROOT / 'eval/reports').glob('quality-*.json')):
        if source.name.endswith(('.metadata.json', '.freeze.json')):
            continue
        if not include_locked and ('locked' in source.name or 'holdout' in source.name):
            continue
        value = json.loads(source.read_bytes())
        if value.get('kind') == 'decision-quality-iteration':
            assert value['source_stable'] is True
            multiplier = len(value['freeze']['profiles']) if value['freeze'].get('execution', {}).get('compiler_mode') == 'bundle' else 1
            assert len(value['observations']) == value['freeze']['planned_calls'] * multiplier
            stem = source.stem
            completed.add(stem)
            suffixes = (('.json', 'report.json.gz', True), ('.freeze.json', 'freeze.json', False), ('.sources.json.gz', 'sources.json.gz', False), ('.predictions.jsonl', 'predictions.jsonl.gz', True), ('.predictions.jsonl.metadata.json', 'metadata.json', False))
            for suffix, ending, compress in suffixes:
                add(source.with_name(stem + suffix), f'runs/{stem}/{ending}', compress)
        elif value.get('backend') and 'rows' in value:
            stem=source.stem
            for suffix, ending, compress in (('.json','report.json.gz',True),('.md','report.md.gz',True),('.predictions.jsonl','predictions.jsonl.gz',True),('.predictions.jsonl.metadata.json','metadata.json',False)):
                add(source.with_name(stem+suffix),f'ordinary/{stem}/{ending}',compress,'Ordinary eval:run has no separate inference source freeze; preserved report/checkpoint metadata is its recorded provenance')
        else:
            add(source, 'derived/' + source.name + '.gz', True)
    # Fitting implementation is supporting reproduction evidence captured after fitting.
    for name in ('eval/iteration/calibrate.ts', 'eval/iteration/fusion.ts', 'scripts/calibrate-iteration.ts', 'scripts/fuse-iteration.ts', 'eval/iteration/boost.ts', 'scripts/boost-iteration.ts', 'tests/iteration-boost.test.ts', 'eval/iteration/prepare.ts', 'eval/iteration/extend-fit.ts', 'tests/iteration-extend-fit.test.ts'):
        source = ROOT / name
        if source.exists():
            add(source, 'fitting-source/' + name.replace('/', '__') + '.' + sha(source.read_bytes())[:12] + '.source', False, 'Supporting implementation version captured after fitting/evaluation; inference snapshots and previously archived fitting versions remain authoritative')
    inventory['artifacts'] = sorted(entries.values(), key=lambda e: e['archive'])
    inventory_path.write_text(json.dumps(inventory, indent=2, sort_keys=True) + '\n')
    print(json.dumps(dict(artifacts=len(entries), complete_runs=sorted(completed), locked_evaluation_included=include_locked)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--include-locked-evaluation', action='store_true')
    main(parser.parse_args().include_locked_evaluation)
