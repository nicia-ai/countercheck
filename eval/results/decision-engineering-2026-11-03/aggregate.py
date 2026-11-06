#!/usr/bin/env python3
"""Offline capture/verification of exact measured artifacts; no inference/network.

Run --capture from any directory to append completed main reports, then rebuild.
Without --capture all inputs are read from the archive and source SHA-verified.
"""
import argparse
import csv
from collections import Counter
import gzip
import hashlib
import io
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PROFILES = ("balanced-v1", "semantic-v2", "structured-value-v1")
DATASETS = ("vitaminc-combined-dev", "scifact-dev", "contract-diagnostic", "batch20-original", "batch20-reversed")
PRICE_PER_MILLION_INPUT_USD = 0.042  # Root verified docs.typesafe.ai/models.md on 2026-11-03.


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n").encode()


def inventory():
    path = HERE / "artifact-sha256.json"
    return json.loads(path.read_bytes()) if path.exists() else {"schema_version": 1, "artifacts": []}


def capture():
    index = inventory()
    entries = {row["archived_path"]: row for row in index["artifacts"]}

    def add(source, target, compress=False):
        source = Path(source)
        original = source.read_bytes()
        if compress:
            stream = io.BytesIO()
            with gzip.GzipFile(fileobj=stream, filename="", mode="wb", mtime=0, compresslevel=9) as handle:
                handle.write(original)
            archived = stream.getvalue()
        else:
            archived = original
        row = {"source_path": str(source.relative_to(ROOT)), "archived_path": target,
               "encoding": "gzip-mtime-0" if compress else "identity", "original_sha256": digest(original),
               "original_bytes": len(original), "archived_sha256": digest(archived), "archived_bytes": len(archived)}
        destination = HERE / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            assert destination.read_bytes() == archived, f"Refusing to change immutable {target}"
        else:
            with destination.open("xb") as handle:
                handle.write(archived)
        if target in entries:
            assert entries[target] == row, f"Refusing changed source provenance {target}"
        entries[target] = row

    for name in ("protocol.json", "probe-protocol.json", "source-freeze.json", "source-snapshot.json.gz", "batch20.manifest"):
        add(HERE / name, name)
    add(ROOT / "eval/reports/run-decision-engineering.mjs", "provenance/run-decision-engineering.mjs.txt")
    previous = ROOT / "eval/results/prompt-ablation-2026-11-03"
    for dataset in DATASETS[:3]:
        add(previous / f"inputs/{dataset}.manifest", f"inputs/{dataset}.manifest")
    for dataset in DATASETS[:2]:
        add(ROOT / f"eval/results/jev-dev-2026-11-03/{dataset}.report.json", f"references/earlier-jev-{dataset}.report.json.gz", True)
    for profile in PROFILES:
        for dataset in DATASETS:
            source = ROOT / f"eval/reports/decision-engineering-{profile}-{dataset}"
            paths = [Path(str(source) + suffix) for suffix in (".json", ".md", ".predictions.jsonl", ".predictions.jsonl.metadata.json")]
            if not all(path.exists() for path in paths):
                continue
            # Summary is written after the complete checkpoint, then Markdown. Capture complete bundles only.
            report = json.loads(paths[0].read_bytes())
            assert len(report["rows"]) == (200 if dataset.startswith("vitaminc") else 199 if dataset.startswith("scifact") else 32 if dataset == "contract-diagnostic" else 20)
            prefix = f"runs/{profile}/{dataset}"
            for source_file, target, compressed in zip(paths, (prefix + ".report.json.gz", prefix + ".report.md", prefix + ".predictions.jsonl.gz", prefix + ".metadata.json"), (True, False, True, False)):
                add(source_file, target, compressed)
    index["artifacts"] = sorted(entries.values(), key=lambda row: row["archived_path"])
    (HERE / "artifact-sha256.json").write_bytes(json_bytes(index))


def read_artifacts():
    result = {}
    for row in inventory()["artifacts"]:
        data = (HERE / row["archived_path"]).read_bytes()
        assert len(data) == row["archived_bytes"] and digest(data) == row["archived_sha256"], row["archived_path"]
        if row["encoding"] == "gzip-mtime-0":
            assert data[4:8] == b"\0\0\0\0", "gzip timestamp is not deterministic"
            data = gzip.decompress(data)
        else:
            assert row["encoding"] == "identity"
        assert len(data) == row["original_bytes"] and digest(data) == row["original_sha256"], row["source_path"]
        result[row["archived_path"]] = data
    return result


def rate(numerator, denominator):
    return numerator / denominator if denominator else None


def close(actual, expected):
    assert actual is None and expected is None or actual is not None and expected is not None and math.isclose(actual, expected, abs_tol=1e-12), (actual, expected)


def ranking(rows):
    positive = sum(y for y, _ in rows)
    negative = len(rows) - positive
    tp = fp = roc = ap = 0
    ordered = sorted(rows, key=lambda row: -row[1])
    cursor = 0
    while cursor < len(ordered):
        score = ordered[cursor][1]
        p = n = 0
        while cursor < len(ordered) and ordered[cursor][1] == score:
            if ordered[cursor][0]:
                p += 1
            else:
                n += 1
            cursor += 1
        roc += n * (tp + p / 2)
        tp += p
        fp += n
        ap += p * tp / (tp + fp)
    return {"auroc": rate(roc, positive * negative), "pr_auc_average_precision": rate(ap, positive)}


def uncertain_proxy(pair):
    return pair["dataset"] == "synthetic-smoke" and pair["native_label"] == "uncertain" and pair.get("source_metadata", {}).get("expected_verdict") == "uncertain"


def quality(rows):
    binary = [row for row in rows if not uncertain_proxy(row["pair"])]
    positives = sum(row["pair"]["gold"] == "contradiction" for row in binary)
    negatives = len(binary) - positives
    tp = fp = tn = definitive_fn = uncertain = errors = excluded = 0
    scores = []
    for row in binary:
        p, y = row["prediction"], row["pair"]["gold"] == "contradiction"
        if p["status"] == "error":
            errors += 1
        elif p["status"] == "excluded":
            excluded += 1
        else:
            verdict = p["verdict"]
            tp += verdict == "contradiction" and y
            fp += verdict == "contradiction" and not y
            tn += verdict == "no_contradiction" and not y
            definitive_fn += verdict == "no_contradiction" and y
            uncertain += verdict == "uncertain"
            if "probabilities" in p:
                scores.append((y, p["probabilities"]["contradiction"]))
    result = {"binary_pairs": len(binary), "positive": positives, "negative": negatives, "tp": tp, "fp": fp, "tn": tn, "definitive_fn": definitive_fn,
              "positive_misses": positives - tp, "uncertain": uncertain, "errors": errors, "excluded": excluded,
              "precision": rate(tp, tp + fp), "recall": rate(tp, positives), "f1": rate(2 * tp, positives + tp + fp),
              "clear_negative_coverage": rate(tn, negatives), "false_positive_rate": rate(fp, negatives), "probability_denominator": len(scores),
              "brier": rate(sum((score - int(y)) ** 2 for y, score in scores), len(scores)), **ranking(scores)}
    expected = [(row["pair"].get("source_metadata", {}).get("expected_verdict"), row["prediction"]) for row in rows]
    expected = [(label, p) for label, p in expected if label in ("contradiction", "no_contradiction", "uncertain")]
    result["contract_expected_cases"] = len(expected)
    result["contract_expected_correct"] = sum(p["status"] == "ok" and p["verdict"] == label for label, p in expected)
    result["expected_uncertain_cases"] = sum(label == "uncertain" for label, _ in expected)
    result["expected_uncertain_correct"] = sum(label == "uncertain" and p["status"] == "ok" and p["verdict"] == "uncertain" for label, p in expected)
    return result


def usage(rows):
    requests = {}
    for row in rows:
        p = row["prediction"]
        if p["status"] == "excluded":
            continue
        key = (p["pass"], p["request_id"])
        value = p["request_usage"]
        assert key not in requests or requests[key] == value, "Inconsistent duplicated request usage"
        requests[key] = value
    return {"requests": len(requests), **{field: sum(v[field] for v in requests.values() if v[field] is not None) if all(v[field] is not None for v in requests.values()) else None for field in ("input_tokens", "output_tokens")},
            "known_input_subtotal": sum(v["input_tokens"] for v in requests.values() if v["input_tokens"] is not None),
            "unknown_input_requests": sum(v["input_tokens"] is None for v in requests.values()), "unknown_output_requests": sum(v["output_tokens"] is None for v in requests.values()),
            "request_ids": [key[1] for key in requests]}


def spans_verified(pair, signals):
    selected = signals["selected_pair"]
    if selected is None:
        return 0
    for key, text_key in (("claim", "claim"), ("against", "evidence")):
        span = selected[key]["span"]
        encoded = pair[text_key].encode("utf-16-le")
        actual = encoded[span["start"] * 2:span["end"] * 2].decode("utf-16-le")
        assert actual == span["text"], (pair["id"], key, "span attribution")
    return 1


def aggregate():
    blobs = read_artifacts()
    decode = lambda path: json.loads(blobs[path])
    frozen = decode("source-freeze.json")
    snapshot = json.loads(gzip.decompress(blobs["source-snapshot.json.gz"]))
    assert set(snapshot) == set(frozen["files"])
    for file, sha in frozen["files"].items():
        assert digest(snapshot[file].encode()) == sha, file
    assert digest(blobs["protocol.json"]) == frozen["protocol_sha256"]
    assert digest(blobs["probe-protocol.json"]) == frozen["probe_protocol_sha256"]
    manifests = {name: decode(f"inputs/{name}.manifest") for name in DATASETS[:3]}
    manifests.update({name: decode("batch20.manifest") for name in DATASETS[3:]})
    for path, sha in decode("protocol.json")["input_manifests"].items():
        assert digest(blobs[f"inputs/{Path(path).name}"]) == sha
    summaries, report_by_key, all_request_ids = [], {}, []
    span_count = 0
    for profile in PROFILES:
        for dataset in DATASETS:
            prefix = f"runs/{profile}/{dataset}"
            if prefix + ".report.json.gz" not in blobs:
                continue
            report = decode(prefix + ".report.json.gz")
            predictions = [json.loads(line) for line in blobs[prefix + ".predictions.jsonl.gz"].splitlines()]
            metadata = decode(prefix + ".metadata.json")
            rows = report["rows"]
            source_pairs = {pair["id"]: pair for pair in manifests[dataset]["pairs"]}
            assert set(source_pairs) == {row["pair"]["id"] for row in rows}
            assert len(rows) == len(source_pairs) == len(predictions)
            assert report["protocol"]["profile"] == profile
            assert report["manifest_sha256"] == metadata["manifest_sha256"] == digest(blobs[f"inputs/{dataset}.manifest"] if dataset in DATASETS[:3] else blobs["batch20.manifest"])
            assert report["prediction_artifact"]["sha256"] == digest(blobs[prefix + ".predictions.jsonl.gz"])
            assert report["prediction_artifact"]["metadata_sha256"] == digest(blobs[prefix + ".metadata.json"])
            assert report["prediction_metadata"] == metadata
            for row, checkpoint in zip(rows, predictions):
                pair, p = row["pair"], row["prediction"]
                assert pair == source_pairs[pair["id"]]
                assert checkpoint == p and p["pair_id"] == pair["id"]
                if p["status"] == "ok":
                    assert p["model"] == p["reported_model"] == "jev-1.14.0"
                    assert p["model_revision"] is None
                    assert len(p["prompt_hash"]) == 64
                    if profile == "structured-value-v1":
                        assert "structured_signals" in p and "probabilities" not in p and "raw_scores" not in p
                        span_count += spans_verified(pair, p["structured_signals"])
                    else:
                        assert "structured_signals" not in p
                        close(sum(p["raw_scores"].values()), 1)
            measured = quality(rows)
            overall = report["overall"]
            for field in ("precision", "recall", "clear_negative_coverage", "false_positive_rate"):
                close(overall[field]["value"], measured[field])
            for field in ("f1", "auroc", "pr_auc_average_precision", "brier", "probability_denominator"):
                close(overall[field], measured[field])
            assert overall["denominator"] == measured["binary_pairs"]
            for key, field in (("true_positive", "tp"), ("false_positive", "fp"), ("true_negative", "tn"), ("definitive_false_negative", "definitive_fn"), ("positive_misses_including_uncertain_errors_exclusions", "positive_misses")):
                assert overall["confusion"][key] == measured[field]
            diagnostics = report["diagnostics"]
            assert diagnostics["execution_observations"] == len(rows)
            assert diagnostics["expected_verdict_correct"] == measured["contract_expected_correct"]
            used = usage(rows)
            assert used["requests"] == report["protocol"]["planned_calls"]
            run_id = f"{profile}/{dataset}"
            all_request_ids.extend((run_id, request_id) for request_id in used.pop("request_ids"))
            entry = {"run_id": run_id, "profile": profile, "dataset": dataset, "all_pairs": len(rows), "completed": sum(row["prediction"]["status"] == "ok" for row in rows),
                     **measured, "usage": used, "compiled_payloads": len({r["prediction"].get("prompt_hash") for r in rows}),
                     "latency_ms_completed_p95": overall["latency_ms"]["completed_p95"], "interpretation": "public-development-native-labels" if dataset in DATASETS[:2] else "AI-authored-synthetic-diagnostic"}
            if profile == "structured-value-v1":
                signals = [r["prediction"]["structured_signals"] for r in rows if r["prediction"]["status"] == "ok"]
                entry["structured_diagnostics"] = {
                    "selected_choices": dict(Counter(x["selected_choice"] for x in signals)),
                    "decision_basis": dict(Counter(x["decision_basis"] for x in signals)),
                    "incomplete_candidate_coverage": sum(x["numeric_reason"] == "incomplete_candidate_coverage" for x in signals),
                    "any_unsupported_spans": sum(any(x["candidate_coverage"][side]["unsupported_spans"] > 0 for side in ("claim", "against")) for x in signals),
                    "selected_numeric_pairs": sum(x["selected_pair"] is not None for x in signals),
                    "numeric_relation": dict(Counter(str(x["numeric_relation"]) for x in signals)),
                }
            summaries.append(entry)
            report_by_key[(profile, dataset)] = report
    baseline_identity = {}
    for dataset in DATASETS[:2]:
        fresh = report_by_key.get(("balanced-v1", dataset))
        if not fresh:
            continue
        old = decode(f"references/earlier-jev-{dataset}.report.json.gz")
        previous = {r["pair"]["id"]: r for r in old["rows"]}
        assert len(previous) == len(fresh["rows"])
        baseline_identity[dataset] = {"pairs": len(previous), "payload_hash_matches": sum(previous[r["pair"]["id"]]["prediction"]["prompt_hash"] == r["prediction"]["prompt_hash"] for r in fresh["rows"]),
                                      "verdict_changes": sum(previous[r["pair"]["id"]]["prediction"]["verdict"] != r["prediction"]["verdict"] for r in fresh["rows"])}
    batch = {}
    for profile in PROFILES:
        original, reversed_run = report_by_key.get((profile, "batch20-original")), report_by_key.get((profile, "batch20-reversed"))
        if not original or not reversed_run:
            continue
        a = {r["pair"]["id"]: r["prediction"] for r in original["rows"]}
        b = {r["pair"]["id"]: r["prediction"] for r in reversed_run["rows"]}
        assert len(a) == len(b) == 20 and set(a) == set(b)
        batch[profile] = {"attributed_comparisons_each_request": 20, "provider_calls_each_request": 1, "identical_case_ids": True,
                          "original_compiled_hash": next(iter(a.values()))["prompt_hash"], "reversed_compiled_hash": next(iter(b.values()))["prompt_hash"],
                          "verdict_changes": [key for key in a if a[key]["verdict"] != b[key]["verdict"]],
                          "compatible_numeric_target_original": a["batch20-10"]["verdict"], "compatible_numeric_target_reversed": b["batch20-10"]["verdict"],
                          "interpretation": "Synthetic complete-attribution/order diagnostic; two requests do not establish immunity or capacity."}
    paired = {}
    for profile in PROFILES[1:]:
        for dataset in DATASETS[:3]:
            base = report_by_key.get(("balanced-v1", dataset))
            candidate = report_by_key.get((profile, dataset))
            if not base or not candidate:
                continue
            baseline = {r["pair"]["id"]: r for r in base["rows"]}
            counts = Counter()
            for row in candidate["rows"]:
                pair, p = row["pair"], row["prediction"]
                old = baseline[pair["id"]]["prediction"]
                counts["matched_cases"] += 1
                counts["verdict_changes"] += p.get("verdict") != old.get("verdict")
                if uncertain_proxy(pair):
                    counts["excluded_uncertain_targets_from_binary_changes"] += 1
                    continue
                positive = pair["gold"] == "contradiction"
                before, after = old.get("verdict"), p.get("verdict")
                counts["recovered_positive"] += positive and before != "contradiction" and after == "contradiction"
                counts["lost_positive"] += positive and before == "contradiction" and after != "contradiction"
                counts["new_false_positive"] += not positive and before != "contradiction" and after == "contradiction"
                counts["rescued_false_positive"] += not positive and before == "contradiction" and after != "contradiction"
                counts["gained_clear_negative"] += not positive and before != "no_contradiction" and after == "no_contradiction"
                counts["lost_clear_negative"] += not positive and before == "no_contradiction" and after != "no_contradiction"
            paired[f"{profile}/{dataset}"] = dict(counts)
    known_input = sum(row["usage"]["known_input_subtotal"] for row in summaries)
    result = {"schema_version": 1, "status": "complete-main-matrix" if len(summaries) == 15 else "partial-main-matrix", "runs": summaries,
              "baseline_against_earlier_jev": baseline_identity, "batch20": batch, "paired_against_fresh_baseline": paired,
              "usage": {"run_scoped_requests": len(all_request_ids), "unique_run_scoped_request_ids": len(set(all_request_ids)), "bare_request_ids": len({x[1] for x in all_request_ids}),
                        "input_tokens_known_subtotal": known_input, "unknown_input_requests": sum(row["usage"]["unknown_input_requests"] for row in summaries), "unknown_output_requests": sum(row["usage"]["unknown_output_requests"] for row in summaries),
                        "estimated_input_list_price_usd": known_input * PRICE_PER_MILLION_INPUT_USD / 1_000_000, "input_usd_per_million": PRICE_PER_MILLION_INPUT_USD,
                        "price_source": "https://docs.typesafe.ai/models.md", "actual_billing": "unknown", "scope": "main matrix only; workflow probes/calibration/holdout are separate additions"},
              "verification": {"archived_artifacts": len(blobs), "frozen_source_files": len(frozen["files"]), "selected_candidate_pair_spans_verified": span_count,
                               "raw_and_compressed_hashes": "verified", "quality_counts_probability_metrics": "independently-recomputed", "threshold_tuning": False},
              "qualification": {"human500_locked200": "unmet", "public_inputs": "previously-examined-development", "synthetic_cases": "AI-authored-not-human-adjudicated", "production": "not-qualified", "statistical_significance": "not-established"}}
    (HERE / "summary.json").write_bytes(json_bytes(result))
    fields = ("profile", "dataset", "all_pairs", "binary_pairs", "positive", "negative", "tp", "fp", "tn", "definitive_fn", "uncertain", "errors", "excluded", "precision", "recall", "f1", "clear_negative_coverage", "auroc", "brier", "probability_denominator", "contract_expected_cases", "contract_expected_correct", "expected_uncertain_correct")
    with (HERE / "summary.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(summaries)
    print(json.dumps({"matrix_runs": len(summaries), "calls": len(all_request_ids), "input_tokens": known_input, "artifacts_verified": len(blobs)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", action="store_true", help="Append completed source artifact bundles without changing existing archived bytes")
    arguments = parser.parse_args()
    if arguments.capture:
        capture()
    aggregate()
