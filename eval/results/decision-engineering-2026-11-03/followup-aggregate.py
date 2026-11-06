#!/usr/bin/env python3
"""Offline append/verification of reviewed-source rerun and separate toy workflow.
Use --capture once source outputs are complete; default rebuilds from archived bytes.
No credentials, inference or network access. Initial matrix is never pooled with reruns.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import csv
import gzip
import importlib.util
import io
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("initial_aggregate", HERE / "aggregate.py")
initial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(initial)


def capture():
    index = initial.inventory()
    entries = {row["archived_path"]: row for row in index["artifacts"]}

    def add(source, target, compress=False):
        source = Path(source)
        data = source.read_bytes()
        if compress:
            stream = io.BytesIO()
            with gzip.GzipFile(fileobj=stream, filename="", mode="wb", mtime=0, compresslevel=9) as handle:
                handle.write(data)
            stored = stream.getvalue()
        else:
            stored = data
        stat = source.stat()
        entry = {"source_path": str(source.relative_to(ROOT)), "archived_path": target,
                 "encoding": "gzip-mtime-0" if compress else "identity", "original_sha256": initial.digest(data), "original_bytes": len(data),
                 "archived_sha256": initial.digest(stored), "archived_bytes": len(stored),
                 "source_mtime_ns": stat.st_mtime_ns, "source_birthtime": getattr(stat, "st_birthtime", None)}
        path = HERE / target
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            assert path.read_bytes() == stored, f"Refusing changed archive {target}"
        else:
            with path.open("xb") as handle:
                handle.write(stored)
        if target in entries:
            assert entries[target] == entry, f"Changed source provenance {target}"
        entries[target] = entry

    for name in ("post-review-protocol.json", "post-review-payload-check.json", "source-freeze-final-reviewed.json", "source-snapshot-final-reviewed.json.gz"):
        add(HERE / name, name)
    for name in ("run-decision-engineering-post-review.mjs", "run-engineering-workflow-live.mjs"):
        add(ROOT / "eval/reports" / name, f"provenance/{name}.txt")
    for name in ("verify-final-payloads.mjs.txt", "final-payload-identity.json"):
        add(HERE / "provenance" / name, "provenance/" + name)
    add(ROOT / "eval/engineering/synthetic-workflow.json", "workflow/input-synthetic-workflow.manifest")
    for file in (HERE / "workflow").glob("*.json"):
        add(file, "workflow/" + file.name)
    for dataset in initial.DATASETS:
        source = ROOT / f"eval/reports/decision-engineering-post-review-structured-value-v1-{dataset}"
        target = f"post-review/structured-value-v1/{dataset}"
        for suffix, ending, compress in ((".json", ".report.json.gz", True), (".md", ".report.md", False), (".predictions.jsonl", ".predictions.jsonl.gz", True), (".predictions.jsonl.metadata.json", ".metadata.json", False)):
            add(Path(str(source) + suffix), target + ending, compress)
    for role in ("dev", "holdout"):
        source = ROOT / f"eval/reports/decision-engineering-workflow-{role}"
        for suffix, ending, compress in ((".json", ".report.json.gz", True), (".md", ".report.md", False), (".predictions.jsonl", ".predictions.jsonl.gz", True), (".predictions.jsonl.metadata.json", ".metadata.json", False)):
            add(Path(str(source) + suffix), f"workflow/runs/{role}" + ending, compress)
    add(ROOT / "eval/reports/decision-engineering-workflow-calibration.json", "workflow/calibration.json")
    index["artifacts"] = sorted(entries.values(), key=lambda entry: entry["archived_path"])
    (HERE / "artifact-sha256.json").write_bytes(initial.json_bytes(index))


def verify_bundle(blobs, prefix):
    report = json.loads(blobs[prefix + ".report.json.gz"])
    metadata = json.loads(blobs[prefix + ".metadata.json"])
    checkpoint = [json.loads(line) for line in blobs[prefix + ".predictions.jsonl.gz"].splitlines()]
    if "prediction_artifact" in report:
        assert report["prediction_artifact"]["sha256"] == initial.digest(blobs[prefix + ".predictions.jsonl.gz"])
        assert report["prediction_artifact"]["metadata_sha256"] == initial.digest(blobs[prefix + ".metadata.json"])
        assert report["prediction_metadata"] == metadata
    else:
        assert report["checkpoint_sha256"] == initial.digest(blobs[prefix + ".predictions.jsonl.gz"])
        assert report["checkpoint_metadata_sha256"] == initial.digest(blobs[prefix + ".metadata.json"])
    return report, metadata, checkpoint


def verify_quality(measured, recorded):
    assert recorded["denominator"] == measured["binary_pairs"]
    for field in ("precision", "recall", "clear_negative_coverage", "false_positive_rate"):
        initial.close(recorded[field]["value"], measured[field])
    for field in ("f1", "brier", "auroc", "probability_denominator"):
        initial.close(recorded[field], measured[field])
    for key, field in (("true_positive", "tp"), ("false_positive", "fp"), ("true_negative", "tn"), ("definitive_false_negative", "definitive_fn")):
        assert recorded["confusion"][key] == measured[field]


def workflow_features(p, semantic):
    s = p["structured_signals"]
    scores = semantic["raw_scores"]
    coverage = s["candidate_coverage"]
    eligible = s["selected_pair"] is not None and all(coverage[side]["recognized_spans"] > 0 and coverage[side]["unsupported_spans"] == 0 and not coverage[side]["overflow"] for side in ("claim", "against"))
    forced = s["numeric_reason"] == "incomplete_candidate_coverage" or s["selected_choice"] in ("unknown", "insufficient_context") or any(coverage[side]["unsupported_spans"] > 0 or coverage[side]["overflow"] for side in ("claim", "against")) or s["selected_pair"] is not None and not eligible
    probabilities = s["selection"]["probabilities"]
    return {"semantic_positive": scores["contradiction"], "semantic_negative": scores["consistent"] + scores["different_scope"],
            "numeric_positive": (s["pair_probability"] or 0) if eligible and s["numeric_relation"] == "incompatible" else 0,
            "unknown_mass": max(scores["insufficient_context"], min(1, probabilities.get("unknown", 0) + probabilities.get("insufficient_context", 0))), "forced_uncertain": forced}


def verdict(features, policy):
    if features["forced_uncertain"] or features["unknown_mass"] > policy["max_unknown"]:
        return "uncertain"
    if features["semantic_positive"] >= policy["positive_threshold"] or policy["numeric_override"] and features["numeric_positive"] >= policy["positive_threshold"]:
        return "contradiction"
    if features["semantic_positive"] <= .2 and features["semantic_negative"] >= policy["negative_threshold"]:
        return "no_contradiction"
    return "uncertain"


def cell_id(features):
    return "".join(str(int(x)) for x in (max(features["semantic_positive"], features["numeric_positive"]) >= .8, features["numeric_positive"] >= .8, features["unknown_mass"] > .2))


def rebuild():
    blobs = initial.read_artifacts()
    read = lambda path: json.loads(blobs[path])
    entries = {row["archived_path"]: row for row in initial.inventory()["artifacts"]}
    frozen = read("source-freeze-final-reviewed.json")
    snapshot = json.loads(gzip.decompress(blobs["source-snapshot-final-reviewed.json.gz"]))
    assert set(snapshot) == set(frozen["files"])
    for file, sha in frozen["files"].items():
        assert initial.digest(snapshot[file].encode()) == sha
    assert initial.digest(blobs["post-review-protocol.json"]) == frozen["followup_protocol_sha256"]
    identity = read("provenance/final-payload-identity.json")
    assert identity["matched_pair_observations"] == 942 and identity["model_calls"] == 0
    assert identity["final_source_freeze_sha256"] == initial.digest(blobs["source-freeze-final-reviewed.json"])
    temporal = []
    freeze_time = entries["source-freeze-final-reviewed.json"]["source_mtime_ns"] / 1e9
    request_ids = []
    runs = []
    for dataset in initial.DATASETS:
        prefix = "post-review/structured-value-v1/" + dataset
        report, metadata, checkpoint = verify_bundle(blobs, prefix)
        expected = read(f"inputs/{dataset}.manifest") if dataset in initial.DATASETS[:3] else read("batch20.manifest")
        expected_by_id = {p["id"]: p for p in expected["pairs"]}
        rows = report["rows"]
        assert len(rows) == len(expected_by_id) == len(checkpoint)
        for row, p in zip(rows, checkpoint):
            assert row["pair"] == expected_by_id[row["pair"]["id"]]
            assert row["prediction"] == p and p["pair_id"] == row["pair"]["id"]
            assert p["status"] == "ok" and p["model"] == p["reported_model"] == "jev-1.14.0" and p["model_revision"] is None
            assert "structured_signals" in p and "probabilities" not in p
            initial.spans_verified(row["pair"], p["structured_signals"])
        measured = initial.quality(rows)
        verify_quality(measured, report["overall"])
        assert report["diagnostics"]["expected_verdict_correct"] == measured["contract_expected_correct"]
        used = initial.usage(rows)
        assert used["requests"] == (1 if dataset.startswith("batch20") else len(rows))
        run_id = "reviewed/structured-value-v1/" + dataset
        request_ids.extend((run_id, request_id) for request_id in used.pop("request_ids"))
        signals = [row["prediction"]["structured_signals"] for row in rows]
        before = read(f"runs/structured-value-v1/{dataset}.report.json.gz")
        before_by_id = {row["pair"]["id"]: row["prediction"] for row in before["rows"]}
        runs.append({"run_id": run_id, "dataset": dataset, "all_pairs": len(rows), "completed": len(rows), **measured, "usage": used,
                     "incomplete_candidate_coverage": sum(s["numeric_reason"] == "incomplete_candidate_coverage" for s in signals),
                     "any_unsupported_spans": sum(any(s["candidate_coverage"][side]["unsupported_spans"] for side in ("claim", "against")) for s in signals),
                     "selected_numeric_pairs": sum(s["selected_pair"] is not None for s in signals), "decision_basis": dict(Counter(s["decision_basis"] for s in signals)),
                     "compared_with_initial": {"matched_pairs": len(rows), "payload_hash_changes": sum(before_by_id[r["pair"]["id"]]["prompt_hash"] != r["prediction"]["prompt_hash"] for r in rows), "verdict_changes": sum(before_by_id[r["pair"]["id"]]["verdict"] != r["prediction"]["verdict"] for r in rows), "causal_interpretation": "Different source and another provider pass; changes are not isolated pure fix effects."}})
        time = entries[prefix + ".metadata.json"]["source_birthtime"]
        assert time is not None and freeze_time < time
        temporal.append({"artifact": prefix + ".metadata.json", "freeze_precedes_creation": True, "creation_utc": datetime.fromtimestamp(time, timezone.utc).isoformat()})
    workflow = {}
    index = read("workflow/split-lock.json")
    group_roles, contents = {}, {}
    for role, partition in index["partitions"].items():
        split = read(f"workflow/{role}.json")
        assert initial.digest(blobs[f"workflow/{role}.json"]) == partition["sha256"]
        for item in split["cases"]:
            boundary = role + ("-" + item["calibration_fold"] if role == "dev" else "")
            assert group_roles.get(item["group_sha256"], boundary) == boundary
            assert contents.get(item["content_sha256"], boundary) == boundary
            group_roles[item["group_sha256"]] = boundary
            contents[item["content_sha256"]] = boundary
            assert item["service_contract"] is None and item["pair"]["dataset"] == "synthetic-smoke"
    wf_freeze = read("workflow/freeze-final-reviewed.json")
    for file, sha in wf_freeze["files"].items():
        assert frozen["files"][file] == sha
    calibration = read("workflow/calibration.json")
    assert calibration["freeze_sha256"] == initial.digest(blobs["workflow/freeze-final-reviewed.json"])
    assert calibration["split_lock_sha256"] == initial.digest(blobs["workflow/split-lock.json"])
    assert calibration["selection_uses_validation"] is False and calibration["grid_size"] == 48
    clean = {}
    for role in ("dev", "holdout"):
        prefix = "workflow/runs/" + role
        report, metadata, checkpoint = verify_bundle(blobs, prefix)
        assert report["role"] == role and report["backend"] == "jev"
        assert report["freeze_sha256"] == calibration["freeze_sha256"]
        assert report["split_lock_sha256"] == calibration["split_lock_sha256"]
        assert report["split_manifest_sha256"] == initial.digest(blobs[f"workflow/{role}.json"])
        observations = report["observations"]
        assert len(observations) == len(checkpoint) == (84 if role == "dev" else 4)
        cases = {c["pair"]["id"]: c for c in read(f"workflow/{role}.json")["cases"]}
        by_key = {}
        for observation, p in zip(observations, checkpoint):
            target = observation["prediction"]
            assert target["pair_id"] == observation["case_id"]
            assert target["prompt_hash"] == observation["compiled_sha256"] == p["engineering"]["compiled_sha256"]
            assert 0 < observation["compiled_bytes"] <= 16384
            assert target["status"] == "ok" and target["model"] == target["reported_model"] == "jev-1.14.0"
            assert all(p[key] == value for key, value in target.items())
            assert observation["case_id"] in cases
            key = (observation["profile"], observation["case_id"], observation["probe"])
            assert key not in by_key
            by_key[key] = observation
            if observation["probe"] == "clean":
                clean[(role, observation["profile"], observation["case_id"])] = target
            for comparison in p["probe_comparisons"]:
                assert comparison["request_id"] == target["request_id"] and comparison["request_usage"] == target["request_usage"]
        usage_rows = [{"prediction": o["prediction"]} for o in observations]
        used = initial.usage(usage_rows)
        request_ids.extend(("workflow/" + role, request_id) for request_id in used.pop("request_ids"))
        variations = {}
        for profile in sorted({o["profile"] for o in observations}):
            values = {}
            for probe in ("repeat", "distractor", "order", "hostile", "criteria-order", "field-order"):
                pairs = [(o, by_key[(profile, o["case_id"], "distractor" if probe == "order" else "clean")]) for o in observations if o["profile"] == profile and o["probe"] == probe]
                if pairs:
                    values[probe] = {"matched_cases": len(pairs), "verdict_changes": sum(a["prediction"]["verdict"] != b["prediction"]["verdict"] for a, b in pairs), "identical_compiled_payloads": sum(a["compiled_sha256"] == b["compiled_sha256"] for a, b in pairs)}
                    recorded = report["by_profile"][profile]["paired_variation"][probe]
                    assert recorded["verdict_changes"] == values[probe]["verdict_changes"]
            variations[profile] = values
            rows = [{"pair": cases[o["case_id"]]["pair"], "prediction": o["prediction"]} for o in observations if o["profile"] == profile and o["probe"] == "clean"]
            verify_quality(initial.quality(rows), report["by_profile"][profile]["labels"]["native"]["binary"])
        assert report["completed"] == len(observations) and report["errors"] == report["excluded"] == 0
        workflow[role] = {"target_observations": len(observations), "distinct_cases": len(cases), "completed": len(observations), "errors": 0, "excluded": 0, "usage": used, "paired_variation": variations}
        time = entries[prefix + ".metadata.json"]["source_birthtime"]
        assert time is not None and freeze_time < time
        assert entries["workflow/freeze-final-reviewed.json"]["source_mtime_ns"] / 1e9 < time
        temporal.append({"artifact": prefix + ".metadata.json", "freeze_precedes_creation": True, "creation_utc": datetime.fromtimestamp(time, timezone.utc).isoformat()})
        if role == "dev":
            assert calibration["dev_run_sha256"] == initial.digest(blobs[prefix + ".report.json.gz"])
        else:
            assert report["calibration_sha256"] == initial.digest(blobs["workflow/calibration.json"])
    # Reproduce the selected policy on separate tune, validation and holdout cases.
    cells = calibration["joint_empirical_calibration"]["cells"]
    composition = {}
    for fold in ("tune", "validation", "holdout"):
        role = "holdout" if fold == "holdout" else "dev"
        cases = [item for item in read(f"workflow/{role}.json")["cases"] if role == "holdout" or item["calibration_fold"] == fold]
        results = []
        calibrated_errors = []
        for item in cases:
            p = clean[(role, calibration["profile"], item["pair"]["id"])]
            semantic = clean[(role, calibration["semantic_profile"], item["pair"]["id"])]
            features = workflow_features(p, semantic)
            output = verdict(features, calibration["policy"])
            results.append(output)
            cell = cells.get(cell_id(features), {"laplace_probability": .5})
            calibrated_errors.append((cell["laplace_probability"] - int(item["pair"]["gold"] == "contradiction")) ** 2)
        composition[fold] = {"cases": len(cases), "verdicts": dict(Counter(results)), "empirical_calibration_brier": sum(calibrated_errors) / len(calibrated_errors)}
        expected = calibration[fold] if fold != "holdout" else read("workflow/runs/holdout.report.json.gz")["composition"]["metrics"]
        assert expected["uncertain"] == results.count("uncertain")
    consumed = read("workflow/split-lock.json.holdout-opened.json")
    assert consumed["calibration_sha256"] == initial.digest(blobs["workflow/calibration.json"])
    assert consumed["freeze_sha256"] == calibration["freeze_sha256"]
    assert entries["workflow/calibration.json"]["source_mtime_ns"] < entries["workflow/split-lock.json.holdout-opened.json"]["source_mtime_ns"]
    workflow["calibration"] = {"policy": calibration["policy"], "selection_rule": calibration["selection_rule"], "tuning_groups": calibration["tuning_groups"], "validation_groups": calibration["validation_groups"], "selection_uses_validation": False, "composition_by_fold": composition,
                                "interpretation": "Twelve AI-authored workflow cases, not human release truth; two tuning, two validation, two heldout cases. No hidden holdout tuning or production promotion."}
    total_input = sum(r["usage"]["known_input_subtotal"] for r in runs) + sum(workflow[role]["usage"]["known_input_subtotal"] for role in ("dev", "holdout"))
    initial_usage = [initial.usage(read(f"runs/{profile}/{dataset}.report.json.gz")["rows"]) for profile in initial.PROFILES for dataset in initial.DATASETS]
    initial_calls = sum(used["requests"] for used in initial_usage)
    initial_tokens = sum(used["known_input_subtotal"] for used in initial_usage)
    result = {"schema_version": 1, "phase": "post-review-corrected-structured-rerun-plus-separate-toy-workflow", "post_review_runs": runs, "workflow": workflow,
              "source": {"final_review_graph_sha256": frozen["security_review_graph_sha256"], "frozen_files_verified": len(snapshot), "baseline_semantic_payload_observations_unchanged": 942},
              "temporal": {"evidence": "Captured local source mtime and checkpoint-metadata birthtime, plus operator orchestrator preflight hash checks; not external clock attestation.", "final_freeze_utc": datetime.fromtimestamp(freeze_time, timezone.utc).isoformat(), "checks": temporal},
              "usage": {"followup_requests": len(request_ids), "unique_run_scoped_requests": len(set(request_ids)), "bare_request_ids": len({x[1] for x in request_ids}), "input_tokens": total_input,
                        "estimated_input_list_price_usd": total_input * .042 / 1e6, "cumulative_initial_and_followup_requests": initial_calls + len(request_ids),
                        "cumulative_input_tokens": initial_tokens + total_input, "cumulative_estimated_input_list_price_usd": (initial_tokens + total_input) * .042 / 1e6,
                        "actual_billing": "unknown", "output_tokens": None},
              "verification": {"archived_artifacts": len(blobs), "all_hashes": "verified", "checkpoint_and_model_identity": "verified", "initial_and_rerun_quality_pooled": False}, "production_qualification": "unmet-human500-locked200; no-promotion-or-deployment"}
    (HERE / "followup-summary.json").write_bytes(initial.json_bytes(result))
    fields = ("dataset", "all_pairs", "binary_pairs", "positive", "negative", "tp", "fp", "tn", "uncertain", "precision", "recall", "f1", "clear_negative_coverage", "contract_expected_correct", "incomplete_candidate_coverage", "any_unsupported_spans", "selected_numeric_pairs")
    with (HERE / "followup-summary.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(runs)
    print(json.dumps({"followup_calls": len(request_ids), "followup_input_tokens": total_input, "cumulative_calls": result["usage"]["cumulative_initial_and_followup_requests"], "artifacts_verified": len(blobs)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", action="store_true")
    args = parser.parse_args()
    if args.capture:
        capture()
    rebuild()
