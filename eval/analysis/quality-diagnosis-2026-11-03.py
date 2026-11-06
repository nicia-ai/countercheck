#!/usr/bin/env python3
"""Offline diagnostics of immutable 2026-11-03 public development model reports.

No model/network access. Thresholds are selected on these same development labels:
all optimized points and consensus rules are exploratory, never held-out estimates.
"""
import argparse
import csv
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

MODELS = ("jev", "clef", "decider", "deberta")
DATASETS = ("vitaminc-combined-dev", "scifact-dev")
ROOT = Path(__file__).resolve().parents[2]


def divide(n, d):
    return n / d if d else None


def native_scores(row):
    p = row["prediction"]
    if p["status"] != "ok":
        return None
    scores = p.get("raw_scores") or p.get("nli_probabilities")
    if not scores or any(not isinstance(x, (int, float)) or not math.isfinite(x) or not 0 <= x <= 1 for x in scores.values()):
        raise ValueError("Missing/invalid native probability distribution")
    if abs(sum(scores.values()) - 1) > .001001:
        raise ValueError("Native distribution is not normalized within the accepted tolerance")
    return scores


def positive(row):
    return row["pair"]["gold"] == "contradiction"


def decision_stats(rows, verdicts):
    counts = Counter()
    for row in rows:
        truth = "positive" if positive(row) else "negative"
        state = verdicts[row["pair"]["id"]]
        counts[f"{truth}/{state}"] += 1
    tp = counts["positive/contradiction"]
    fp = counts["negative/contradiction"]
    positives = sum(positive(r) for r in rows)
    negatives = len(rows) - positives
    definitive = sum(n for k, n in counts.items() if k.endswith("/contradiction") or k.endswith("/no_contradiction"))
    return dict(
        pairs=len(rows), positive=positives, negative=negatives,
        true_positive=tp, false_positive=fp,
        true_negative=counts["negative/no_contradiction"],
        positive_misses=dict(
            uncertain=counts["positive/uncertain"],
            definitive_negative=counts["positive/no_contradiction"],
            error=counts["positive/error"], excluded=counts["positive/excluded"],
        ),
        negative_unassessed=dict(uncertain=counts["negative/uncertain"], error=counts["negative/error"], excluded=counts["negative/excluded"]),
        precision=divide(tp, tp + fp), recall=divide(tp, positives),
        f1=divide(2 * tp, positives + tp + fp),
        definitive_coverage=divide(definitive, len(rows)),
        clear_negative_coverage=divide(counts["negative/no_contradiction"], negatives),
        false_positive_rate=divide(fp, negatives),
    )


def recorded_verdicts(rows):
    return {r["pair"]["id"]: r["prediction"]["verdict"] if r["prediction"]["status"] == "ok" else r["prediction"]["status"] for r in rows}


def binary_point(tp, fp, positives, negatives, scored_positive, scored_negative, threshold):
    return dict(
        threshold=threshold, true_positive=tp, false_positive=fp,
        positive_misses_including_missing=positives - tp,
        scored_false_negative=scored_positive - tp,
        scored_true_negative=scored_negative - fp,
        missing_positive=positives - scored_positive,
        missing_negative=negatives - scored_negative,
        precision=divide(tp, tp + fp), recall=divide(tp, positives),
        f1=divide(2 * tp, positives + tp + fp), false_positive_rate=divide(fp, negatives),
    )


def sweep(rows):
    # Native scores preserve exact provider threshold/tie behavior. In archived hosted
    # rows their derived normalized score can differ by ~1e-16 at the 0.8 boundary.
    grouped = {}
    for row in rows:
        scores = native_scores(row)
        if scores is not None:
            group = grouped.setdefault(scores["contradiction"], [0, 0])
            group[0 if positive(row) else 1] += 1
    positives = sum(positive(r) for r in rows)
    negatives = len(rows) - positives
    scored_positive = sum(p for p, _ in grouped.values())
    scored_negative = sum(n for _, n in grouped.values())
    tp = fp = 0
    points = []
    for threshold, (p, n) in sorted(grouped.items(), reverse=True):
        tp += p
        fp += n
        points.append(binary_point(tp, fp, positives, negatives, scored_positive, scored_negative, threshold))
    fixed = {}
    for cutoff in (.8, .5):
        tp = sum(p for score, (p, _) in grouped.items() if score >= cutoff)
        fp = sum(n for score, (_, n) in grouped.items() if score >= cutoff)
        fixed[str(cutoff)] = binary_point(tp, fp, positives, negatives, scored_positive, scored_negative, cutoff)
    precise = [p for p in points if p["true_positive"] + p["false_positive"] > 0 and 20 * p["true_positive"] >= 19 * (p["true_positive"] + p["false_positive"])]
    high_recall = [p for p in points if 10 * p["true_positive"] >= 9 * positives]
    max_recall = max(precise, key=lambda p: (p["recall"], p["precision"], p["threshold"]), default=None)
    max_precision = max(high_recall, key=lambda p: (p["precision"], p["recall"], p["threshold"]), default=None)
    best_f1 = max(points, key=lambda p: (p["f1"], p["precision"] or 0, p["threshold"]), default=None)
    direct = [(native_scores(row)["contradiction"], positive(row)) for row in rows if native_scores(row) is not None]
    for point in points:
        assert point["true_positive"] == sum(truth and score >= point["threshold"] for score, truth in direct)
        assert point["false_positive"] == sum(not truth and score >= point["threshold"] for score, truth in direct)
    return dict(
        comparison="contradiction iff native contradiction probability >= threshold; missing execution remains a miss, not a clean negative",
        tie_policy="all equal-score pairs enter together; no within-tie label ordering",
        unique_thresholds_evaluated=len(points), fixed_score_cutoffs=fixed,
        best_recall_at_precision_at_least_0_95=max_recall,
        best_precision_at_recall_at_least_0_90=max_precision,
        first_highest_threshold_point_reaching_recall_0_90=high_recall[0] if high_recall else None,
        best_f1=best_f1,
        any_threshold_meets_precision_0_95_and_recall_0_90=any(20 * p["true_positive"] >= 19 * (p["true_positive"] + p["false_positive"]) and 10 * p["true_positive"] >= 9 * positives for p in points),
        selection_on_same_development_labels=True,
        grouped_sweep_verified_against_direct_classifications=True,
    )


def argmax_diagnostics(rows):
    result = {}
    for truth, subset in [("positive", [r for r in rows if positive(r)]), ("negative", [r for r in rows if not positive(r)])]:
        unique = Counter()
        ties = including = unique_contradiction = scored = 0
        for row in subset:
            scores = native_scores(row)
            if scores is None:
                continue
            scored += 1
            maximum = max(scores.values())
            winners = sorted(k for k, v in scores.items() if v == maximum)
            including += "contradiction" in winners
            unique_contradiction += winners == ["contradiction"]
            if len(winners) == 1:
                unique[winners[0]] += 1
            else:
                ties += 1
                unique["tie:" + "+".join(winners)] += 1
        result[truth] = dict(total=len(subset), scored=scored, missing=len(subset) - scored, winner_counts=dict(sorted(unique.items())), tied_argmax_pairs=ties, contradiction_in_argmax=including, contradiction_unique_argmax=unique_contradiction, fraction_contradiction_in_argmax_of_scored=divide(including, scored), fraction_contradiction_in_argmax_of_all_gold=divide(including, len(subset)))
    forced = {}
    for row in rows:
        scores = native_scores(row)
        forced[row["pair"]["id"]] = row["prediction"]["status"] if scores is None else "contradiction" if scores["contradiction"] >= max(scores.values()) else "no_contradiction"
    result["forced_native_argmax_contradiction_ties_positive"] = decision_stats(rows, forced)
    return result


def negative_policy(rows):
    if any(r["prediction"]["status"] == "ok" and "raw_scores" not in r["prediction"] for r in rows):
        return dict(applicable=False, reason="Native three-way NLI entailment/neutral is not the service's consistent/different_scope split")
    old = recorded_verdicts(rows)
    pooled = {}
    promoted_positive = promoted_negative = 0
    for row in rows:
        key = row["pair"]["id"]
        scores = native_scores(row)
        if scores is None:
            pooled[key] = old[key]
            continue
        current = "contradiction" if scores["contradiction"] >= .8 else "no_contradiction" if scores["contradiction"] <= .2 and max(scores["consistent"], scores["different_scope"]) >= .8 else "uncertain"
        if old[key] != current:
            raise ValueError("Recorded hosted verdict disagrees with the fixed raw-score policy")
        pooled[key] = "contradiction" if scores["contradiction"] >= .8 else "no_contradiction" if scores["contradiction"] <= .2 and scores["consistent"] + scores["different_scope"] >= .8 else "uncertain"
        if old[key] == "uncertain" and pooled[key] == "no_contradiction":
            if positive(row): promoted_positive += 1
            else: promoted_negative += 1
    current = decision_stats(rows, old)
    alternative = decision_stats(rows, pooled)
    assert current["true_positive"] == alternative["true_positive"] and current["false_positive"] == alternative["false_positive"]
    return dict(applicable=True, current=current, pooled_negative_counterfactual=alternative, promoted_gold_negative_from_uncertain=promoted_negative, promoted_gold_positive_to_definitive_false_negative=promoted_positive, positive_precision_and_recall_unchanged=True, formula="native contradiction<=0.2 AND native consistent+different_scope>=0.8, after contradiction>=0.8 branch", qualification="Offline semantic-policy diagnostic; not a deployed or held-out result")


def consensus(dataset_rows):
    first = dataset_rows[MODELS[0]]
    ids = [r["pair"]["id"] for r in first]
    by_model = {m: {r["pair"]["id"]: r for r in dataset_rows[m]} for m in MODELS}
    result = {}
    for models in [("jev", "clef", "decider"), MODELS]:
        name = "+".join(models)
        current = {m: recorded_verdicts(dataset_rows[m]) for m in models}
        points = {}
        for needed in range(1, len(models) + 1):
            verdicts = {}
            for key in ids:
                positives = sum(current[m][key] == "contradiction" for m in models)
                any_scored = any(by_model[m][key]["prediction"]["status"] == "ok" for m in models)
                verdicts[key] = "contradiction" if positives >= needed else "no_contradiction" if any_scored else "error"
            points[f"at_least_{needed}_current_positive_votes"] = decision_stats(first, verdicts)
        complementarity = {}
        for model in models:
            alone = sum(positive(by_model[model][key]) and current[model][key] == "contradiction" and all(current[other][key] != "contradiction" for other in models if other != model) for key in ids)
            complementarity[model] = alone
        result[name] = dict(vote_rules=points, uniquely_recovered_gold_positives=complementarity, gold_positives_missed_by_every_default_policy=sum(positive(by_model[models[0]][key]) and all(current[m][key] != "contradiction" for m in models) for key in ids), all_models_scored_pairs=sum(all(by_model[m][key]["prediction"]["status"] == "ok" for m in models) for key in ids))
    return dict(qualification="Offline complementarity diagnostic of current positive decisions, not a proposed single-call service route. Unselected scored pairs are forced binary negatives solely for these counts, not clean service verdicts; rules are not validated out of sample", groups=result)


def self_check():
    def row(identifier, label, score, *, raw=None):
        native = raw or {"contradiction": score, "entailment": 1 - score, "neutral": 0}
        prediction = dict(pair_id=identifier, pass_=1, status="ok", verdict="uncertain" if raw else "contradiction" if score >= .5 else "no_contradiction")
        prediction["raw_scores" if raw else "nli_probabilities"] = native
        return dict(pair=dict(id=identifier, gold="contradiction" if label else "non_contradiction"), prediction=prediction)
    tied = sweep([row("p", True, .8), row("n", False, .8)])
    assert tied["unique_thresholds_evaluated"] == 1
    assert tied["best_recall_at_precision_at_least_0_95"] is None
    assert tied["fixed_score_cutoffs"]["0.8"]["precision"] == .5
    for false_positives, attainable in [(3, True), (4, False)]:
        examples = [row(f"p{i}", True, .9 if i < 64 else .1) for i in range(71)]
        examples += [row(f"n{i}", False, .9) for i in range(false_positives)]
        assert sweep(examples)["any_threshold_meets_precision_0_95_and_recall_0_90"] is attainable
    raw = {"contradiction": .1, "consistent": .45, "different_scope": .45, "insufficient_context": 0}
    pooling = negative_policy([row("p", True, .1, raw=raw), row("n", False, .1, raw=raw)])
    assert pooling["promoted_gold_positive_to_definitive_false_negative"] == 1
    assert pooling["promoted_gold_negative_from_uncertain"] == 1
    assert pooling["positive_precision_and_recall_unchanged"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path(__file__).with_suffix(".json"))
    args = parser.parse_args()
    self_check()
    results = {}
    sources = []
    loaded = {}
    for dataset in DATASETS:
        models = {}
        aligned = None
        loaded[dataset] = {}
        for model in MODELS:
            path = ROOT / "eval" / "results" / f"{model}-dev-2026-11-03" / f"{dataset}.report.json"
            data = path.read_bytes()
            report = json.loads(data)
            rows = report["rows"]
            if any(r["prediction"]["pass"] != 1 or r["pair"]["id"] != r["prediction"]["pair_id"] for r in rows):
                raise ValueError("Unexpected pass/identity in frozen report")
            identities = {r["pair"]["id"]: r["pair"] for r in rows}
            if len(identities) != len(rows): raise ValueError("Duplicate pair")
            if aligned is None: aligned = identities
            elif identities != aligned: raise ValueError("Model inputs/gold are not identical")
            loaded[dataset][model] = rows
            sources.append(dict(path=str(path.relative_to(ROOT)), sha256=hashlib.sha256(data).hexdigest(), manifest_sha256=report["manifest_sha256"]))
            default = decision_stats(rows, recorded_verdicts(rows))
            for field in ["precision", "recall", "f1"]:
                saved = report["overall"][field]
                if isinstance(saved, dict): saved = saved["value"]
                if default[field] != saved: raise ValueError("Recorded quality arithmetic does not reproduce")
            models[model] = dict(recorded_policy=default, native_argmax=argmax_diagnostics(rows), native_contradiction_threshold_sweep=sweep(rows), negative_policy=negative_policy(rows))
        n = sum(positive(r) for r in loaded[dataset][MODELS[0]])
        required = math.ceil(.90 * n)
        results[dataset] = dict(resolution=dict(gold_positives=n, recall_step=1/n, true_positives_required_for_recall_0_90=required, recall_at_required_count=required/n, maximum_false_positives_at_that_count_for_precision_0_95=required // 19), models=models, complementarity=consensus(loaded[dataset]))
    output = dict(label_interpretation="Gold labels remain the frozen native dataset annotations under the saved adapters; this calculation does not adjudicate alignment with the literal submitted-text semantic contract.", schema_version=1, analysis="quality-diagnosis-2026-11-03", scope="Offline analysis of frozen public development samples; no model/network calls, no runtime changes, no held-out claims", score_source="Native raw_scores.contradiction (hosted) or nli_probabilities.contradiction (encoder); avoids normalization roundoff at exact policy/tie boundaries", threshold_selection="Unique native contradiction values descending, complete ties; best points selected on the same development labels, optimistic exploratory diagnostics", verification="Built-in complete-tie, 71-positive/3-versus-4-FP target-boundary, negative-pooling safety checks; every grouped sweep point cross-checked by direct classification; saved defaults and cross-model inputs checked", sources=sources, datasets=results)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    table = []
    for dataset in DATASETS:
        for model in MODELS:
            values = results[dataset]["models"][model]
            default = values["recorded_policy"]
            thresholds = values["native_contradiction_threshold_sweep"]
            precise = thresholds["best_recall_at_precision_at_least_0_95"]
            recalled = thresholds["best_precision_at_recall_at_least_0_90"]
            best = thresholds["best_f1"]
            half = thresholds["fixed_score_cutoffs"]["0.5"]
            pooled = values["negative_policy"]
            table.append(dict(dataset=dataset, model=model, gold_positives=default["positive"], default_tp=default["true_positive"], default_fp=default["false_positive"], positive_miss_uncertain=default["positive_misses"]["uncertain"], positive_miss_definitive_negative=default["positive_misses"]["definitive_negative"], positive_miss_error=default["positive_misses"]["error"], default_precision=default["precision"], default_recall=default["recall"], default_f1=default["f1"], positive_contradiction_argmax_fraction=values["native_argmax"]["positive"]["fraction_contradiction_in_argmax_of_all_gold"], best_recall_at_precision95=None if precise is None else precise["recall"], precision95_threshold=None if precise is None else precise["threshold"], precision95_tp=None if precise is None else precise["true_positive"], precision95_fp=None if precise is None else precise["false_positive"], best_precision_at_recall90=None if recalled is None else recalled["precision"], recall90_threshold=None if recalled is None else recalled["threshold"], recall90_tp=None if recalled is None else recalled["true_positive"], recall90_fp=None if recalled is None else recalled["false_positive"], best_f1=best["f1"], best_f1_threshold=best["threshold"], threshold05_precision=half["precision"], threshold05_recall=half["recall"], threshold05_f1=half["f1"], current_clear_negative_coverage=default["clear_negative_coverage"], pooled_clear_negative_coverage=pooled["pooled_negative_counterfactual"]["clear_negative_coverage"] if pooled["applicable"] else None, pooled_extra_true_negatives=pooled.get("promoted_gold_negative_from_uncertain"), pooled_extra_definitive_false_negatives=pooled.get("promoted_gold_positive_to_definitive_false_negative"), any_threshold_meets_95precision_90recall=thresholds["any_threshold_meets_precision_0_95_and_recall_0_90"]))
    with args.out.with_suffix(".csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(table[0]))
        writer.writeheader()
        writer.writerows(table)
    print(f"Wrote offline diagnosis to {args.out} and its CSV companion; no inference performed.")
    for dataset, result in results.items():
        print(dataset)
        for model, values in result["models"].items():
            threshold = values["native_contradiction_threshold_sweep"]
            precise = threshold["best_recall_at_precision_at_least_0_95"]
            recall = threshold["best_precision_at_recall_at_least_0_90"]
            print(model, "misses", values["recorded_policy"]["positive_misses"], "maxR@P95", None if precise is None else (precise["recall"],precise["threshold"]), "maxP@R90", None if recall is None else (recall["precision"],recall["threshold"]), "joint", threshold["any_threshold_meets_precision_0_95_and_recall_0_90"])


if __name__ == "__main__":
    main()
