#!/usr/bin/env python3
"""Verify original studies and the versioned follow-up using committed artifacts only."""
import gzip
import hashlib
import json
from pathlib import Path
import runpy
import sys
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'eval/results/calibration-followup-2026-11-06'


def sha(data):return hashlib.sha256(data).hexdigest()


def main():
    if len(sys.argv)!=1:raise ValueError('No arguments supported')
    inventory=json.loads((OUT/'archive-sha256.json').read_bytes())
    for name,expected in inventory.items():
        if Path(name).name!=name or sha((OUT/name).read_bytes())!=expected:raise ValueError('Follow-up archive inventory differs: '+name)
    receipt=json.loads((OUT/'analysis-provenance.json').read_bytes())
    snapshot=json.loads(gzip.decompress((OUT/'analysis-py-sources.json.gz').read_bytes()))
    if set(snapshot)!=set(receipt['source_files']) or any(sha(s.encode())!=receipt['source_files'][p] for p,s in snapshot.items()):raise ValueError('Follow-up analysis source snapshot differs')
    for path,expected in receipt['source_files'].items():
        if sha((ROOT/path).read_bytes())!=expected:raise ValueError('Follow-up analysis source differs: '+path)
    for name,expected in receipt['input_artifacts'].items():
        if Path(name).name!=name or sha((OUT/name).read_bytes())!=expected:raise ValueError('Follow-up input digest differs')
    runpy.run_path(str(ROOT/'scripts/verify-calibration-study.py'),run_name='__main__')
    runpy.run_path(str(ROOT/'scripts/analyze-calibration-followup.py'),run_name='__main__')


if __name__=='__main__':main()
