#!/usr/bin/env python3
"""Offline NLI baseline. Outputs replay JSONL; never truncates or reads labels for inference."""
import argparse
import hashlib
import importlib.metadata
import json
import pathlib
import platform
import os
import subprocess
import sys
from datetime import datetime, timezone
import re
import time

MODEL = 'cross-encoder/nli-deberta-v3-base'
REVISION = '6c749ce3425cd33b46d187e45b92bbf96ee12ec7'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest', required=True)
    p.add_argument('--out', required=True, help='JSONL predictions; metadata written beside it')
    p.add_argument('--revision', default=REVISION, help='Pinned 40-character Hugging Face commit')
    p.add_argument('--allow-download', action='store_true', help='Explicitly permit model/tokenizer network downloads')
    p.add_argument('--cache-dir', default='eval/data/huggingface', help='Project-local checkpoint cache')
    p.add_argument('--threads', type=int, default=4, help='CPU intra-op threads (recorded, default 4)')
    p.add_argument('--device', default='cpu', choices=['cpu', 'cuda', 'mps'])
    p.add_argument('--max-pairs', type=int, default=200, help='Hard preflight cap; prepare a smaller manifest to sample')
    p.add_argument('--batch-size', type=int, default=8)
    p.add_argument('--max-tokens', type=int, default=512)
    p.add_argument('--policy', choices=['forced', 'fixed-0.8'], default='forced', help='Always report forced argmax; fixed-0.8 is a diagnostic, not dev-tuned matched coverage')
    a = p.parse_args()
    run_start = time.perf_counter()
    started_at = datetime.now(timezone.utc).isoformat()
    if not re.fullmatch('[a-f0-9]{40}', a.revision):
        p.error('revision must be an immutable Hugging Face commit')
    if a.threads < 1 or a.batch_size < 1 or a.max_pairs < 1 or not 1 <= a.max_tokens <= 512:
        p.error('invalid resource cap; this checkpoint supports at most 512 tokens')
    manifest_bytes = pathlib.Path(a.manifest).read_bytes()
    manifest = json.loads(manifest_bytes)
    pairs = manifest['pairs']
    if manifest.get('schema_version') != 1 or len(pairs) > a.max_pairs:
        p.error('invalid manifest or pair cap exceeded; use eval:prepare to select complete groups')
    out = pathlib.Path(a.out)
    metadata_path = pathlib.Path(str(out) + '.metadata.json')
    if out.exists() or metadata_path.exists():
        p.error('output already exists')
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    torch.set_num_threads(a.threads)
    load_start = time.perf_counter()
    load = dict(cache_dir=a.cache_dir, revision=a.revision, local_files_only=not a.allow_download, trust_remote_code=False)
    tokenizer = AutoTokenizer.from_pretrained(MODEL, **load)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL, use_safetensors=True, **load).to(a.device).eval()
    load_seconds = time.perf_counter() - load_start
    tokenization_start = time.perf_counter()
    # Check the actual checkpoint config, never infer label order from another NLI model.
    labels = {int(k): str(v).lower() for k, v in model.config.id2label.items()}
    if labels != {0: 'contradiction', 1: 'entailment', 2: 'neutral'}:
        raise SystemExit('Unexpected model label order; refusing to score')
    if a.max_tokens > model.config.max_position_embeddings:
        raise SystemExit('Token cap exceeds checkpoint position envelope')
    rows = []
    accepted = []
    for pair in pairs:
        encoded = tokenizer(pair['evidence'], pair['claim'], truncation=False, padding=False)
        count = len(encoded['input_ids'])
        if count > a.max_tokens:
            rows.append(dict(pair_id=pair['id'], pass_=1, status='excluded', error_code='encoder_token_envelope', latency_ms=0, input_tokens=count))
        else:
            accepted.append((pair, count))
    tokenization_seconds = time.perf_counter() - tokenization_start
    inference_start = time.perf_counter()
    inference_forward_seconds = 0
    batches = []
    for i in range(0, len(accepted), a.batch_size):
        batch = accepted[i:i + a.batch_size]
        inputs = tokenizer([r[0]['evidence'] for r in batch], [r[0]['claim'] for r in batch], padding=True, truncation=False, return_tensors='pt').to(a.device)
        if a.device == 'cuda':
            torch.cuda.synchronize()
        start = time.perf_counter()
        with torch.inference_mode():
            probabilities = torch.softmax(model(**inputs).logits.float(), dim=-1).cpu().tolist()
        if a.device == 'cuda':
            torch.cuda.synchronize()
        elapsed = (time.perf_counter() - start) * 1000
        inference_forward_seconds += elapsed / 1000
        batches.append(dict(batch_index=len(batches), pairs=len(batch), elapsed_ms=elapsed, max_pair_tokens=max(r[1] for r in batch)))
        for (pair, tokens), prob in zip(batch, probabilities):
            contradiction, entailment, neutral = prob
            total = sum(prob)
            projected = dict(contradiction=contradiction / total, no_contradiction=(entailment + neutral) / total, insufficient_context=0)
            # NLI neutral is a labeled negative, not automatically semantic insufficient-context.
            forced = 'contradiction' if contradiction >= max(entailment, neutral) else 'no_contradiction'
            verdict = forced
            if a.policy == 'fixed-0.8':
                verdict = 'contradiction' if contradiction >= .8 else 'no_contradiction' if 1 - contradiction >= .8 else 'uncertain'
            rows.append(dict(pair_id=pair['id'], pass_=1, status='ok', verdict=verdict, probabilities=projected, nli_probabilities=dict(contradiction=contradiction, entailment=entailment, neutral=neutral), latency_ms=elapsed, input_tokens=tokens, model=f'{MODEL}@{a.revision}', engine_release='offline-nli-v1', presentation='premise-evidence,hypothesis-claim', forced_nli_verdict=forced))
    inference_seconds = time.perf_counter() - inference_start
    # pass is a Python keyword; use a distinct local key then serialize the protocol key.
    for row in rows:
        row['pass'] = row.pop('pass_')
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open('x') as f:
        for row in rows:
            f.write(json.dumps(row, sort_keys=True) + '\n')
    metadata = dict(model=MODEL, revision=a.revision, model_card=f'https://huggingface.co/{MODEL}/blob/{a.revision}/README.md', label_order=labels, training='SNLI and MultiNLI, per model card; MultiNLI evaluation is an in-domain reference, not zero-shot transfer. Other datasets are adapted evaluations; absence from pretraining is not established.', manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest(), device=a.device, batch_size=a.batch_size, policy=a.policy, max_tokens=a.max_tokens, excluded=len(pairs) - len(accepted), truncation=False, timing='batch model forward wall time copied to each pair, excludes model load/tokenization; not service request latency', cost_usd=None, packages={name: importlib.metadata.version(name) for name in ['torch', 'transformers', 'sentencepiece']})
    chip = None
    if platform.system() == 'Darwin':
        try:
            chip = subprocess.check_output(['sysctl', '-n', 'machdep.cpu.brand_string'], text=True).strip()
        except (OSError, subprocess.CalledProcessError):
            pass
    metadata.update(weight_format='safetensors', cpu_model=chip, logical_cpu_count=os.cpu_count(), started_at=started_at, completed_at=datetime.now(timezone.utc).isoformat(), machine=dict(platform=platform.platform(), architecture=platform.machine(), processor=platform.processor(), python=sys.version, torch_threads=torch.get_num_threads(), route='local PyTorch CPU, no hosted inference' if a.device == 'cpu' else f'local PyTorch {a.device}, no hosted inference'), runtime_seconds=dict(model_load_including_download=load_seconds, preflight_tokenization=tokenization_seconds, inference_loop=inference_seconds, model_forward_total=inference_forward_seconds, total_before_metadata=time.perf_counter() - run_start), batch_observations=batches, max_observed_accepted_tokens=max((r[1] for r in accepted), default=None), downloads_allowed=a.allow_download)
    metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
    print(f'Wrote {len(rows)} predictions; {metadata["excluded"]} explicit token exclusions. Not a deployed service score.')


if __name__ == '__main__':
    main()
