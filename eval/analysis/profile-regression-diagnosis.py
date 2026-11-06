#!/usr/bin/env python3
"""Offline diagnosis of saved development observations; no inference or credentials.
All threshold frontiers/counterfactuals are exploratory on already examined labels.
"""
import gzip
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INPUTS = {}
ENGINEERING = ROOT / "eval/results/decision-engineering-2026-11-03"
ABLATION = ROOT / "eval/results/prompt-ablation-2026-11-03"
DATASETS = ("vitaminc-combined-dev", "scifact-dev", "contract-diagnostic")


def load(path):
    data = path.read_bytes()
    INPUTS[str(path.relative_to(ROOT))] = hashlib.sha256(data).hexdigest()
    return json.loads(gzip.decompress(data) if path.suffix == ".gz" else data)


def uncertain_proxy(pair):
    return pair["dataset"] == "synthetic-smoke" and pair["native_label"] == "uncertain" and pair.get("source_metadata", {}).get("expected_verdict") == "uncertain"


def relation(p, pooled=False):
    s = p.get("raw_scores") or p["structured_signals"]["selection"]["probabilities"]
    if s.get("contradiction", 0) >= .8:
        return "contradiction"
    negative = s.get("consistent", 0) + s.get("different_scope", 0) if pooled else max(s.get("consistent", 0), s.get("different_scope", 0))
    if s.get("contradiction", 0) <= .2 and negative >= .8:
        return "no_contradiction"
    return "uncertain"


def stats(rows, decision=None):
    binary = [r for r in rows if not uncertain_proxy(r["pair"])]
    n = Counter()
    for row in binary:
        y = "positive" if row["pair"]["gold"] == "contradiction" else "negative"
        p = row["prediction"]
        v = decision(p) if decision else p.get("verdict", p["status"])
        n[(y, v)] += 1
    tp, fp, tn = n[("positive", "contradiction")], n[("negative", "contradiction")], n[("negative", "no_contradiction")]
    positives = sum(r["pair"]["gold"] == "contradiction" for r in binary)
    negatives = len(binary) - positives
    return {"binary_pairs": len(binary), "positive": positives, "negative": negatives, "tp": tp, "fp": fp, "tn": tn,
            "precision": tp / (tp + fp) if tp + fp else None, "recall": tp / positives if positives else None,
            "clear_negative_coverage": tn / negatives if negatives else None,
            "positive_misses": {key: n[("positive", key)] for key in ("uncertain", "no_contradiction", "error", "excluded")},
            "negative_uncertain": n[("negative", "uncertain")]}


def score(p):
    return (p.get("raw_scores") or p["structured_signals"]["selection"]["probabilities"]).get("contradiction", 0)


def frontier(rows):
    binary = [r for r in rows if not uncertain_proxy(r["pair"])]
    positives = sum(r["pair"]["gold"] == "contradiction" for r in binary)
    grouped = {}
    for row in binary:
        group = grouped.setdefault(score(row["prediction"]), [0, 0])
        group[0 if row["pair"]["gold"] == "contradiction" else 1] += 1
    tp = fp = 0
    points = []
    for threshold, (p, n) in sorted(grouped.items(), reverse=True):
        tp += p
        fp += n
        points.append({"threshold": threshold, "tp": tp, "fp": fp, "precision": tp / (tp + fp), "recall": tp / positives,
                       "f1": 2 * tp / (positives + tp + fp)})
    precise = [p for p in points if 20 * p["tp"] >= 19 * (p["tp"] + p["fp"])]
    high_recall = [p for p in points if 10 * p["tp"] >= 9 * positives]
    return {"unique_score_ties_enter_together": True, "best_recall_at_precision_95": max(precise, key=lambda p: (p["recall"], p["precision"]), default=None),
            "best_precision_at_recall_90": max(high_recall, key=lambda p: (p["precision"], p["recall"]), default=None),
            "best_f1": max(points, key=lambda p: p["f1"]),
            "any_95_precision_90_recall": any(p in high_recall for p in precise),
            "selection_on_same_seen_development_labels": True}


def paired(old, new):
    before = {r["pair"]["id"]: r for r in old}
    c = Counter()
    for row in new:
        previous = before[row["pair"]["id"]]
        assert row["pair"] == previous["pair"]
        a, b = previous["prediction"]["verdict"], row["prediction"]["verdict"]
        c["matched"] += 1
        c["verdict_changes"] += a != b
        if uncertain_proxy(row["pair"]):
            continue
        positive = row["pair"]["gold"] == "contradiction"
        c["lost_tp"] += positive and a == "contradiction" and b != "contradiction"
        c["recovered_tp"] += positive and a != "contradiction" and b == "contradiction"
        c["new_fp"] += not positive and a != "contradiction" and b == "contradiction"
        c["rescued_fp"] += not positive and a == "contradiction" and b != "contradiction"
        c["lost_tn"] += not positive and a == "no_contradiction" and b != "no_contradiction"
        c["gained_tn"] += not positive and a != "no_contradiction" and b == "no_contradiction"
    return dict(c)


def gate_diagnosis(rows):
    counts = Counter()
    mass = Counter()
    candidate_options = Counter()
    for row in rows:
        pair, p = row["pair"], row["prediction"]
        s = p["structured_signals"]
        probs = s["selection"]["probabilities"]
        truth = "unknown" if uncertain_proxy(pair) else "positive" if pair["gold"] == "contradiction" else "negative"
        incomplete = s["numeric_reason"] == "incomplete_candidate_coverage"
        counts[f"{truth}/all"] += 1
        counts[f"{truth}/incomplete"] += incomplete
        raw = relation(p)
        counts[f"{truth}/semantic_without_veto/{raw}"] += 1
        counts[f"{truth}/vetoed_positive"] += incomplete and raw == "contradiction" and p["verdict"] == "uncertain"
        counts[f"{truth}/vetoed_negative"] += incomplete and raw == "no_contradiction" and p["verdict"] == "uncertain"
        counts[f"{truth}/selected/{s['selected_choice']}"] += 1
        option_count = sum(k.startswith("p_") for k in probs)
        candidate_options[str(option_count)] += 1
        numeric_mass = sum(v for k, v in probs.items() if k.startswith("p_"))
        mass["numeric_choice_mass_sum"] += numeric_mass
        mass["unknown_mass_sum"] += probs.get("unknown", 0)
        counts["raw_semantic_contradiction_at_least_0_8"] += probs.get("contradiction", 0) >= .8
        counts["candidate_mass_positive_rows"] += numeric_mass > 0
        counts["candidate_top_choice_rows"] += s["selected_choice"].startswith("p_")
        counts["contradiction_argmax_rows"] += probs.get("contradiction", 0) == max(probs.values())
        counts["contradiction_threshold_rescued_if_numeric_mass_pooled"] += probs.get("contradiction", 0) < .8 <= probs.get("contradiction", 0) + numeric_mass
    return {"counts": dict(counts), "candidate_option_count_distribution": dict(candidate_options), "mean_numeric_choice_mass": mass["numeric_choice_mass_sum"] / len(rows),
            "mean_unknown_mass": mass["unknown_mass_sum"] / len(rows), "without_global_veto_counterfactual": stats(rows, relation),
            "counterfactual_caveat": "Same mixed-choice outputs only; not an independent semantic query, not a safe deployed policy or recalibrated probability."}


def cases_for(old, new, mode, limit=6):
    before = {r["pair"]["id"]: r for r in old}
    selected = []
    for row in new:
        pair, p = row["pair"], row["prediction"]
        previous = before[pair["id"]]["prediction"]
        positive = pair["gold"] == "contradiction"
        use = ((mode == "rich_tp_lost" and positive and previous["verdict"] == "contradiction" and p["verdict"] != "contradiction") or
               (mode == "fp" and not positive and not uncertain_proxy(pair) and p["verdict"] == "contradiction") or
               (mode == "vetoed_tp" and positive and p["verdict"] == "uncertain" and relation(p) == "contradiction") or
               (mode == "contract_error" and pair.get("source_metadata", {}).get("expected_verdict") != p["verdict"]))
        if use:
            selected.append({"pair": pair, "before_verdict": previous["verdict"], "after_verdict": p["verdict"], "before_contradiction": score(previous), "after_contradiction": score(p),
                             "structured_reason": p.get("structured_signals", {}).get("numeric_reason"), "candidate_coverage": p.get("structured_signals", {}).get("candidate_coverage")})
    selected.sort(key=lambda r: (-r["before_contradiction"], r["pair"]["id"]))
    return selected[:limit]


def main():
    tracks = {}
    for profile in ("balanced-v1", "semantic-v2", "structured-value-v1"):
        for dataset in DATASETS:
            tracks[(profile, dataset)] = load(ENGINEERING / f"runs/{profile}/{dataset}.report.json.gz")["rows"]
    for dataset in DATASETS:
        tracks[("structured-reviewed", dataset)] = load(ENGINEERING / f"post-review/structured-value-v1/{dataset}.report.json.gz")["rows"]
    for n in (1, 2, 3):
        report = load(ABLATION / f"runs/run-{n}.report.json.gz")
        for profile in ("baseline", "rich-criteria", "rich-criteria-examples"):
            for dataset in DATASETS:
                rows = [{"pair": o["pair"], "prediction": o["prediction"]} for o in report["observations"] if o["profile"] == profile and ("vitaminc" if dataset.startswith("vitaminc") else "scifact" if dataset.startswith("scifact") else "synthetic-smoke") == o["pair"]["dataset"]]
                tracks[(f"ablation{n}-{profile}", dataset)] = rows
    public = {f"{profile}/{dataset}": {"recorded": stats(rows), "frontier": frontier(rows), "score_kind": "mixed-choice contradiction-option mass, not verdict probability" if "structured" in profile else "native four-way contradiction probability"} for (profile, dataset), rows in tracks.items() if dataset != "contract-diagnostic"}
    comparisons = {}
    gate = {}
    samples = {}
    for dataset in DATASETS:
        rich = tracks[("ablation1-rich-criteria", dataset)]
        semantic = tracks[("semantic-v2", dataset)]
        structured = tracks[("structured-reviewed", dataset)]
        comparisons[dataset] = {"earlier_rich_to_new_semantic": paired(rich, semantic), "fresh_baseline_to_new_semantic": paired(tracks[("balanced-v1", dataset)], semantic)}
        gate[dataset] = gate_diagnosis(structured)
        samples[dataset] = {"rich_tp_lost": cases_for(rich, semantic, "rich_tp_lost"), "semantic_fp": cases_for(semantic, semantic, "fp"),
                            "structured_vetoed_tp": cases_for(structured, structured, "vetoed_tp"), "structured_fp": cases_for(structured, structured, "fp")}
        if dataset == "contract-diagnostic":
            samples[dataset]["semantic_contract_errors"] = cases_for(semantic, semantic, "contract_error", 32)
            samples[dataset]["structured_contract_errors"] = cases_for(structured, structured, "contract_error", 32)
    result = {"purpose": "offline diagnosis on previously examined development labels, not heldout optimization evidence", "public_tracks": public, "paired": comparisons,
              "structured_gate": gate, "representative_cases_for_manual_diagnostic_review_not_new_adjudication": samples,
              "target_resolution": {"positives_each_public_dataset": 71, "minimum_tp_for_90_recall": 64, "maximum_fp_for_95_precision_at_64_to_71_tp": 3,
                                    "minimum_clear_tn_vitaminc_for_85_coverage": 110, "minimum_clear_tn_scifact_for_85_coverage": 109},
              "input_sha256": INPUTS}
    out = Path(__file__).with_suffix(".json")
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n")
    for dataset in DATASETS[:2]:
        print(dataset, "paired", comparisons[dataset])
        print("gate", {k: v for k, v in gate[dataset]["counts"].items() if "/incomplete" in k or "vetoed" in k})
        for profile in ("balanced-v1", "semantic-v2", "ablation1-rich-criteria", "ablation1-rich-criteria-examples", "structured-reviewed"):
            print(profile, public[f"{profile}/{dataset}"]["frontier"])
    print("Wrote offline diagnostic JSON; no inference/network calls")


if __name__ == "__main__":
    main()
