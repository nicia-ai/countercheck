# Separately fitted calibration and human-adjudication preparation

Status: **approved; execution complete**. See `approval.json`, which binds the owner’s approval to the original protocol hash. The frozen protocol records the earlier preparation state. Original archives, shipped service and verifier summary remain unchanged.

The request's 1,333 misses count completed assessments only: four additional provider errors give 1,337 total missed-positive outcomes. See the hash-bound miss breakdown. The 68 never-caught positives and 75.6% union recall reproduce.

The blinded local packet has 204 items and no judgments. Give each annotator only packet.json/packet.txt, RUBRIC.md and their blank template under the ignored local adjudication directory. Never distribute operator-key.json, the native labels, model outputs or selection membership. Control membership is reproducible from the fixed seed; blind IDs and order are intentionally randomized, with the packet and private key hashes serving as the exact version receipt. Blinding is a workflow boundary, not protection against an adjudicator deliberately linking public sources. Third-human adjudication follows two independent completed annotation files.

## Pre-inference protocol

Read protocol.json and freeze.json for exact rules and source/data hashes. One global policy per model is fitted on separate non-finance public-train groups. Positive precision target is 95% observed on fit; negative gate allows zero fit false clears, following the existing calibrator. Separate validation is evaluated without reselection. Finance is transfer only. No prompt, default, service threshold or native label changes.

Fit pairs: 2512; validation pairs: 688. Each of nine models has at most 3200 calls and a $6.400 operator reservation. Total cap: 28800 calls / $57.600 at $0.002 per call. This is an operator reservation, not measured billing or a provider-enforced cap.

The owner approved the protocol and budget before dispatch. The command file is a plan, not an executable launch approval. Policies, validation attempts, calibrated archive scorecards and the offline verifier are complete. See the [results](../separate-calibration-2026-11-05/README.md); Jev validation had no successful assessments and remains semantically unmeasured.

## Human labels

Run the preparation CLI's adjudicate subcommand only after the two humans and a distinct adjudicator complete their templates. It checks complete coverage, packet hashes, independent/human attestations and content provenance, and emits a separate service-contract label sidecar plus scorecard. Tooling records the human assertions; it cannot verify who actually authored a label. No AI labels are generated. Source text and free-text rationale stay in ignored local files, especially all FinDVer text.
