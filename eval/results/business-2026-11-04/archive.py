#!/usr/bin/env python3
"""Append completed business artifacts locally; finance assertion text is withheld."""
import gzip
import hashlib
import io
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
REPORTS = ROOT / 'eval/reports'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def redact_pair(pair):
    keep = {key: value for key, value in pair.items() if key not in ('claim', 'evidence')}
    for field in ('claim', 'evidence'):
        keep[field + '_sha256'] = sha(pair[field].encode())
        keep[field + '_utf8_bytes'] = len(pair[field].encode())
    return keep


def redact_finance(value):
    if isinstance(value, list):
        return [redact_finance(item) for item in value]
    if isinstance(value, dict):
        if value.get('dataset') == 'findver' and 'claim' in value and 'evidence' in value:
            return redact_pair(value)
        return {key: redact_finance(item) for key, item in value.items()}
    return value


def main():
    inventory_path = HERE / 'artifact-sha256.json'
    inventory = json.loads(inventory_path.read_bytes()) if inventory_path.exists() else {'schema_version': 1, 'artifacts': []}
    entries = {entry['archive']: entry for entry in inventory['artifacts']}

    def add(source, name, compress=False, finance=False, note=None):
        raw = source.read_bytes()
        content = (json.dumps(redact_finance(json.loads(raw)), ensure_ascii=False, indent=2) + '\n').encode() if finance else raw
        stored = content
        if compress:
            stream = io.BytesIO()
            with gzip.GzipFile(fileobj=stream, mode='wb', filename='', mtime=0, compresslevel=9) as output:
                output.write(content)
            stored = stream.getvalue()
        entry = dict(source=str(source.relative_to(ROOT)), archive=name, encoding='gzip-mtime0' if compress else 'identity', transformation='finance-pair-text-redaction-v1' if finance else 'none', original_sha256=sha(raw), original_bytes=len(raw), content_sha256=sha(content), stored_sha256=sha(stored), stored_bytes=len(stored))
        if note:
            entry['note'] = note
        target = HERE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            assert target.read_bytes() == stored, f'Refusing changed archived artifact {name}'
        else:
            with target.open('xb') as output:
                output.write(stored)
        if name in entries:
            assert entries[name] == entry, f'Refusing changed provenance {name}'
        entries[name] = entry

    for source in sorted(HERE.glob('*protocol*.json')):
        add(source, 'protocols/' + source.name)
    for domain, filename in [('contractnli', 'contractnli-dev-200.json'), ('mnli', 'mnli-nonfiction-dev-200.json'), ('findver', 'findver-testmini-ie-23.json'), ('findver-individual', 'findver-testmini-ie-individual-82.json')]:
        source = ROOT / 'eval/data/business' / filename
        if source.exists():
            add(source, f'inputs/{domain}.manifest.json.gz', True, domain.startswith('findver'))
    for filename in ('LICENSE', 'TERMS', 'README.md', 'source.json'):
        add(ROOT / 'eval/data/business/contractnli' / filename, 'licenses/contractnli/' + filename)
    for source in sorted(REPORTS.glob('business-phase*')):
        if source.suffix == '.json' or source.name.endswith('.sources.json.gz'):
            add(source, 'execution/' + source.name)
    for source in sorted(REPORTS.glob('run-business*.mjs')):
        add(source, 'orchestration/' + source.name + '.txt', note='Exact operator launcher; environment names/paths are preserved, no credential values')
    for source in sorted(REPORTS.glob('business-*audit.*')):
        if source.suffix in ('.json', '.mjs'):
            add(source, 'audits/' + source.name + ('.txt' if source.suffix == '.mjs' else ''))
    receipt = REPORTS / 'business-mnli-rebuild-check.json'
    if receipt.exists():add(receipt, 'audits/' + receipt.name)
    completed = []
    for source in sorted(REPORTS.glob('business-*.json')):
        if source.name.endswith(('.metadata.json', '.freeze.json')):
            continue
        value = json.loads(source.read_bytes())
        if not (value.get('kind') == 'decision-quality-iteration' or 'rows' in value):
            continue
        stem = source.stem
        domain = stem.split('-')[1]
        if domain not in ('contractnli', 'mnli', 'findver'):
            continue
        finance = domain == 'findver'
        add(source, f'runs/{stem}/report.json.gz', True, finance)
        if value.get('kind') == 'decision-quality-iteration':
            assert value['source_stable'] is True
            for suffix, ending, compressed in [('.freeze.json', 'freeze.json', False), ('.sources.json.gz', 'sources.json.gz', False), ('.predictions.jsonl', 'predictions.jsonl.gz', True), ('.predictions.jsonl.metadata.json', 'checkpoint-metadata.json', False)]:
                add(source.with_name(stem + suffix), f'runs/{stem}/{ending}', compressed)
        else:
            prediction_stem = stem.replace('-deberta-replay', '-deberta')
            add(REPORTS / (prediction_stem + '.predictions.jsonl'), f'runs/{stem}/predictions.jsonl.gz', True)
            add(REPORTS / (prediction_stem + '.predictions.jsonl.metadata.json'), f'runs/{stem}/checkpoint-metadata.json')
            if not finance:
                add(source.with_suffix('.md'), f'runs/{stem}/report.md.gz', True)
        completed.append(stem)
    for path in ('eval/deberta.py', 'eval/business/common.ts', 'eval/business/contractnli.ts', 'eval/business/mnli.ts', 'eval/business/findver.ts', 'eval/business/fetch-findver.ts', 'eval/business/fetch-contractnli.py', 'eval/business/fetch-mnli.py', 'scripts/prepare-business.ts', 'scripts/prepare-finance-business.ts'):
        source = ROOT / path
        if source.exists():
            add(source, f'supporting-source/{path.replace("/", "__")}.{sha(source.read_bytes())[:12]}.source', note='Captured after preparation/execution; does not replace an absent pre-inference freeze')
    inventory['artifacts'] = sorted(entries.values(), key=lambda entry: entry['archive'])
    inventory_path.write_text(json.dumps(inventory, indent=2, sort_keys=True) + '\n')
    print(json.dumps(dict(artifacts=len(entries), completed_runs=completed, finance_text='redacted', model_calls=0)))


if __name__ == '__main__':
    main()
