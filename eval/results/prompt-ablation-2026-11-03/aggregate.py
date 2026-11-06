#!/usr/bin/env python3
"""Rebuild descriptive summaries from this immutable archive. Standard library; offline only."""
import csv
import gzip
import hashlib
import itertools
import json
from collections import Counter
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RATE = Decimal("0.042")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    data = (ROOT / path).read_bytes()
    return json.loads(gzip.decompress(data) if path.endswith(".gz") else data)


def usage(observations, run):
    seen = set()
    inputs = outputs = 0
    unknown_input = unknown_output = 0
    for row in observations:
        prediction = row["prediction"]
        identity = (run, prediction["request_id"])
        if identity in seen:
            raise ValueError("Duplicate request identity within a run")
        seen.add(identity)
        counts = prediction.get("request_usage", {})
        a = counts.get("input_tokens", prediction.get("input_tokens"))
        b = counts.get("output_tokens", prediction.get("output_tokens"))
        if a is None:
            unknown_input += 1
        else:
            inputs += a
        if b is None:
            unknown_output += 1
        else:
            outputs += b
    total = None if unknown_input else inputs
    return dict(requests=len(seen), input_tokens=total, known_input_subtotal=inputs, unknown_input_requests=unknown_input, output_tokens=None if unknown_output else outputs, known_output_subtotal=outputs, unknown_output_requests=unknown_output, estimated_input_list_cost_usd=None if total is None else float(Decimal(total) * RATE / Decimal(1000000)), actual_billed_cost_usd=None)


def comparison(a, b):
    first = {row["pair"]["id"]: row for row in a}
    second = {row["pair"]["id"]: row for row in b}
    if set(first) != set(second):
        raise ValueError("Paired comparison inputs differ")
    counts = Counter()
    score_deltas = []
    for key, prior in first.items():
        current = second[key]
        if prior["pair"] != current["pair"]:
            raise ValueError("Paired gold/text differs")
        x, y = prior["prediction"], current["prediction"]
        counts["pairs"] += 1
        counts["identical_payload_hash"] += prior["compiled"]["sha256"] == current["compiled"]["sha256"]
        counts["verdict_changes"] += x.get("verdict") != y.get("verdict")
        if x["status"] != "ok" or y["status"] != "ok":
            counts["not_both_completed"] += 1
            continue
        counts["both_completed"] += 1
        score_deltas.append(abs(y["probabilities"]["contradiction"] - x["probabilities"]["contradiction"]))
        counts["native_scores_changed"] += x.get("raw_scores", x.get("raw_noul")) != y.get("raw_scores", y.get("raw_noul"))
        expected = prior["pair"].get("source_metadata", {}).get("expected_verdict")
        if expected == "uncertain":
            counts["expected_uncertain_cases"] += 1
            counts["recovered_expected_uncertain"] += x["verdict"] != "uncertain" and y["verdict"] == "uncertain"
            counts["lost_expected_uncertain"] += x["verdict"] == "uncertain" and y["verdict"] != "uncertain"
            continue
        positive = prior["pair"]["gold"] == "contradiction"
        counts["recovered_positive"] += positive and x["verdict"] != "contradiction" and y["verdict"] == "contradiction"
        counts["lost_positive"] += positive and x["verdict"] == "contradiction" and y["verdict"] != "contradiction"
        counts["new_false_positive"] += not positive and x["verdict"] != "contradiction" and y["verdict"] == "contradiction"
        counts["removed_false_positive"] += not positive and x["verdict"] == "contradiction" and y["verdict"] != "contradiction"
    return dict(counts=dict(counts), mean_absolute_contradiction_score_change=sum(score_deltas) / len(score_deltas) if score_deltas else None, max_absolute_contradiction_score_change=max(score_deltas) if score_deltas else None)


def positive_selection(rows, gated):
    tp = fp = 0
    positives = sum(row["pair"]["gold"] == "contradiction" for row in rows)
    for row in rows:
        p = row["prediction"]
        if p["status"] != "ok":
            continue
        raw = p["raw_noul"]
        selected = raw["q_conflict"] >= .8 and (not gated or raw["q_determinable"] >= .8)
        if selected:
            if row["pair"]["gold"] == "contradiction":
                tp += 1
            else:
                fp += 1
    return dict(true_positive=tp, false_positive=fp, precision=tp / (tp + fp) if tp + fp else None, recall=tp / positives)


def main():
    inventory = load("artifact-sha256.json")
    for item in inventory["artifacts"]:
        blob = (ROOT / item["file"]).read_bytes()
        if digest(blob) != item["archived_sha256"] or len(blob) != item["archived_bytes"]:
            raise ValueError("Archived byte hash mismatch")
        original = gzip.decompress(blob) if item["encoding"] == "gzip" else blob
        if digest(original) != item["source_sha256"] or len(original) != item["source_bytes"]:
            raise ValueError("Decompressed source hash mismatch")
    inputs = [load(f"inputs/{name}.manifest") for name in ["vitaminc-combined-dev", "scifact-dev", "contract-diagnostic"]]
    input_by_hash = {digest((ROOT / f"inputs/{name}.manifest").read_bytes()): manifest for name, manifest in zip(["vitaminc-combined-dev", "scifact-dev", "contract-diagnostic"], inputs)}
    profile_hash = digest((ROOT / "source/profiles.ts.source").read_bytes())
    protocol_hash = digest((ROOT / "protocols/initial.json").read_bytes())
    runs = {}
    table = []
    all_run_identities = set()
    all_bare_ids = set()
    for run in ["run-1", "run-2", "run-3"]:
        report = load(f"runs/{run}.report.json.gz")
        metadata = load(f"runs/{run}.metadata.json")
        rows = report["observations"]
        if report["protocol"]["profile_source_sha256"] != profile_hash or report["protocol"]["frozen_protocol_sha256"] != protocol_hash:
            raise ValueError("Frozen profile/protocol hash mismatch")
        if report["manifest_bundle_sha256"] != metadata["manifest_bundle_sha256"]:
            raise ValueError("Checkpoint manifest provenance mismatch")
        pred_bytes = gzip.decompress((ROOT / f"runs/{run}.predictions.jsonl.gz").read_bytes())
        if digest(pred_bytes) != report["checkpoint_sha256"] or digest((ROOT / f"runs/{run}.metadata.json").read_bytes()) != report["checkpoint_metadata_sha256"]:
            raise ValueError("Checkpoint byte provenance mismatch")
        if len(pred_bytes.splitlines()) != len(rows) or len(rows) != report["protocol"]["planned_calls"]:
            raise ValueError("Request count mismatch")
        if any(row["prediction"]["status"] != "ok" or row["prediction"]["reported_model"] != "jev-1.14.0" or row["provider_calls"] != 1 or row["compiled"]["bytes"] > 16384 for row in rows):
            raise ValueError("Unexpected error/model in completed archive")
        per_profile = {}
        for profile in report["protocol"]["profiles"]:
            selected = [row for row in rows if row["profile"] == profile]
            if len(selected) != 431:
                raise ValueError("Expected the same431pairs per profile")
            by_key = {(row["manifest_sha256"], row["pair"]["id"]): row["pair"] for row in selected}
            expected = {(sha, pair["id"]): pair for sha, manifest in input_by_hash.items() for pair in manifest["pairs"]}
            if by_key != expected:
                raise ValueError("Evaluated text/gold does not match frozen inputs")
            per_profile[profile] = dict(usage=usage(selected, run), compiled_bytes_min=min(row["compiled"]["bytes"] for row in selected), compiled_bytes_max=max(row["compiled"]["bytes"] for row in selected))
            for dataset, metrics in report["by_profile"][profile]["by_dataset"].items():
                actual = [row for row in selected if row["dataset_key"] == dataset]
                binary = [row for row in actual if row["pair"].get("source_metadata", {}).get("expected_verdict") != "uncertain"]
                tp = sum(row["pair"]["gold"] == "contradiction" and row["prediction"]["verdict"] == "contradiction" for row in binary)
                fp = sum(row["pair"]["gold"] != "contradiction" and row["prediction"]["verdict"] == "contradiction" for row in binary)
                positives = sum(row["pair"]["gold"] == "contradiction" for row in binary)
                tn = sum(row["pair"]["gold"] != "contradiction" and row["prediction"]["verdict"] == "no_contradiction" for row in binary)
                negatives = len(binary) - positives
                precision = tp / (tp + fp) if tp + fp else None
                if metrics["denominator"] != len(binary) or metrics["confusion"]["true_positive"] != tp or metrics["confusion"]["false_positive"] != fp or metrics["confusion"]["true_negative"] != tn or metrics["precision"]["value"] != precision or metrics["recall"]["value"] != tp / positives or metrics["f1"] != 2 * tp / (positives + tp + fp) or metrics["clear_negative_coverage"]["value"] != tn / negatives:
                    raise ValueError("Quality count mismatch")
                diag = report["by_profile"][profile]["execution_and_contract_by_dataset"][dataset]
                explicit = [row for row in actual if row["pair"].get("source_metadata", {}).get("expected_verdict") is not None]
                correct = sum(row["prediction"]["verdict"] == row["pair"]["source_metadata"]["expected_verdict"] for row in explicit)
                unknown = [row for row in explicit if row["pair"]["source_metadata"]["expected_verdict"] == "uncertain"]
                correct_unknown = sum(row["prediction"]["verdict"] == "uncertain" for row in unknown)
                if diag["all_cases"] != len(actual) or diag["binary_quality_excluded_expected_uncertain"] != len(unknown) or (explicit and diag["explicit_expected_verdict_accuracy"]["value"] != correct / len(explicit)) or (unknown and diag["expected_uncertain_recall"]["value"] != correct_unknown / len(unknown)):
                    raise ValueError("Expected-uncertain denominator mismatch")
                table.append(dict(run=run, profile=profile, dataset=dataset, all_cases=len(actual), binary_cases=len(binary), true_positive=tp, false_positive=fp, precision=metrics["precision"]["value"], recall=metrics["recall"]["value"], f1=metrics["f1"], clear_negative_coverage=metrics["clear_negative_coverage"]["value"], uncertain_pairs=sum(row["prediction"]["verdict"] == "uncertain" for row in actual), errors=diag["errors"], exclusions=diag["excluded"], auroc=metrics["auroc"], contract_expected_correct=correct if explicit else None, contract_expected_total=len(explicit) if explicit else None, expected_uncertain_correct=correct_unknown if unknown else None, expected_uncertain_total=len(unknown) if unknown else None))
        for row in rows:
            identity = (run, row["prediction"]["request_id"])
            if identity in all_run_identities:
                raise ValueError("Duplicate within-run request")
            all_run_identities.add(identity)
            all_bare_ids.add(row["prediction"]["request_id"])
        runs[run] = dict(created_at=report["created_at"], profiles=report["protocol"]["profiles"], concurrency=report["protocol"]["global_concurrency"], observations=len(rows), errors=0, exclusions=0, usage=usage(rows, run), per_profile=per_profile)
    ranges = {}
    for profile in ["baseline", "rich-criteria", "rich-criteria-examples"]:
        ranges[profile] = {}
        for dataset in sorted({row["dataset"] for row in table}):
            records = [row for row in table if row["profile"] == profile and row["dataset"] == dataset]
            if len(records) != 3:
                raise ValueError("Three unchanged passes required for range")
            ranges[profile][dataset] = dict(runs=3, unique_labeled_cases=records[0]["all_cases"], independent_new_cases_from_repetition=0, precision=[min(row["precision"] for row in records), max(row["precision"] for row in records)], recall=[min(row["recall"] for row in records), max(row["recall"] for row in records)], f1=[min(row["f1"] for row in records), max(row["f1"] for row in records)], contract_expected_correct_by_run=[row["contract_expected_correct"] for row in records] if records[0]["contract_expected_total"] else None, contract_total_per_run=records[0]["contract_expected_total"])
    initial = load("runs/run-1.report.json.gz")
    reference_variation = {}
    for name, dataset in [("vitaminc-combined-dev", "vitaminc/combined/dev"), ("scifact-dev", "scifact/gold-rationale-set/dev")]:
        old = load(f"references/earlier-jev-{name}.report.json.gz")
        prior = [dict(pair=row["pair"], prediction=row["prediction"], compiled=dict(sha256=row["prediction"]["prompt_hash"])) for row in old["rows"]]
        fresh = [row for row in initial["observations"] if row["profile"] == "baseline" and row["dataset_key"] == dataset]
        reference_variation[dataset] = comparison(prior, fresh)
    within_profile_variation = {}
    for profile in ranges:
        within_profile_variation[profile] = {}
        for a, b in itertools.combinations(["run-1", "run-2", "run-3"], 2):
            first = load(f"runs/{a}.report.json.gz")["observations"]
            second = load(f"runs/{b}.report.json.gz")["observations"]
            within_profile_variation[profile][f"{a}_vs_{b}"] = {dataset: comparison([row for row in first if row["profile"] == profile and row["dataset_key"] == dataset], [row for row in second if row["profile"] == profile and row["dataset_key"] == dataset]) for dataset in ranges[profile]}
    example_pairs = {}
    for run in runs:
        observations = load(f"runs/{run}.report.json.gz")["observations"]
        example_pairs[run] = {dataset: comparison([row for row in observations if row["profile"] == "rich-criteria" and row["dataset_key"] == dataset], [row for row in observations if row["profile"] == "rich-criteria-examples" and row["dataset_key"] == dataset]) for dataset in ranges["rich-criteria"]}
    dual = {}
    for dataset in ["vitaminc/combined/dev", "scifact/gold-rationale-set/dev"]:
        rows = [row for row in initial["observations"] if row["profile"] == "dual-noul" and row["dataset_key"] == dataset]
        ungated, gated = positive_selection(rows, False), positive_selection(rows, True)
        dual[dataset] = dict(ungated_positive_threshold_0_8=ungated, recorded_conflict_and_determinability_gates=gated, gold_positives_suppressed_by_determinability=ungated["true_positive"] - gated["true_positive"], false_positives_suppressed_by_determinability=ungated["false_positive"] - gated["false_positive"], interpretation="Post-hoc composition counterfactual on the same saved dual-question outputs; not a rerun, single-Noul simulation, deployed policy, or calibrated joint three-way distribution")
    known = sum(run["usage"]["known_input_subtotal"] for run in runs.values())
    unknown = sum(run["usage"]["unknown_input_requests"] for run in runs.values())
    result = dict(scope="Exploratory development experiment plus two post-discovery repeatability passes; no held-out, production, human-adjudication or statistical-significance claim", initial_five_arm_rows=[row for row in table if row["run"] == "run-1"], all_run_rows=table, per_run=runs, three_run_descriptive_ranges=ranges, earlier_vs_fresh_baseline=reference_variation, unchanged_profile_pairwise_variation=within_profile_variation, examples_vs_rich_paired_counts=example_pairs, dual_noul_gate_counterfactual=dual, usage_across_runs=dict(provider_calls=len(all_run_identities), bare_request_ids=len(all_bare_ids), reused_request_ids_across_runs=len(all_run_identities) - len(all_bare_ids), input_tokens=None if unknown else known, known_input_subtotal=known, unknown_input_requests=unknown, estimated_input_list_cost_usd=None if unknown else float(Decimal(known) * RATE / Decimal(1000000)), input_price_usd_per_million=float(RATE), price_reference="https://docs.typesafe.ai/models.md", actual_billed_cost_usd=None, accounting="Deduplicate only within(run_id,request_id); include all32contract cases, not only28binary-quality cases. Do not pool repeated cases for quality."))
    (ROOT / "summary.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    with (ROOT / "summary.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(table[0]))
        writer.writeheader()
        writer.writerows(table)
    print(json.dumps(dict(calls=len(all_run_identities), input_tokens=result["usage_across_runs"]["input_tokens"], input_price_estimate=result["usage_across_runs"]["estimated_input_list_cost_usd"], source_artifacts_verified=len(inventory["artifacts"]))))


if __name__ == "__main__":
    main()
