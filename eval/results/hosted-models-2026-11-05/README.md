# All exposed models: frozen benchmark comparison

Measured 2026-11-05. Fixed shipped `balanced-v1`, single pairs, one pass, original presentation, 3,000ms direct-kernel deadline, concurrency1, no retries/fallbacks/truncation. Native Workers AI binding for Clef; direct native HTTPS for other providers. **These timings do not measure the authenticated deployed API or its 2,500ms provider deadline.**

880 distinct public pairs per model: VitaminC200, SciFact199, ContractNLI199, MultiNLI200, FinDVer82. Two synthetic suites add40 cases per model, reported separately. 7,360 total observations. The strict23 finance subset is derived from82, with no duplicate calls. No new locked holdout was opened or threshold/prompt fitted.

Each quality cell is **precision / recall / clear-negative coverage**, in percent. Uncertainty, errors and exclusions stay in recall/coverage denominators. Targets are95 /90 /85; these public native-label adaptations do not establish human-adjudicated service-contract quality. No domain-pooled quality ranking is produced. This compares current shipped behavior under one fixed policy, not the best achievable prompt or calibration for each model.

## Business

| Model                                |         contractnli |                mnli |             findver |
| ------------------------------------ | ------------------: | ------------------: | ------------------: |
| Jev 1.14                             |  86.7 / 50.0 / 64.2 | 100.0 / 58.2 / 81.2 | 100.0 / 81.8 / 71.1 |
| Clef                                 | 100.0 / 30.8 / 34.1 | 100.0 / 40.3 / 56.4 | 100.0 / 27.3 / 55.3 |
| Clef Flash                           | 100.0 / 34.6 / 15.0 | 100.0 / 46.3 / 41.4 | 100.0 / 25.0 / 36.8 |
| Clef Omni                            |  92.9 / 50.0 / 47.4 |  97.4 / 55.2 / 52.6 | 100.0 / 18.2 / 76.3 |
| GPT-6 Luna (OpenAI Decisions)        |  76.9 / 38.5 / 38.7 | 100.0 / 32.8 / 66.9 | 100.0 / 75.0 / 78.9 |
| Decision-1 (OpenRouter)              |  58.6 / 65.4 / 48.0 |  95.7 / 65.7 / 75.9 |  96.0 / 54.5 / 65.8 |
| Pplx Decider v1.2 (OpenRouter)       |  93.3 / 53.8 / 54.9 |  97.8 / 67.2 / 60.2 | 100.0 / 86.4 / 81.6 |
| Pplx Decider Flash v1.2 (OpenRouter) | 100.0 / 26.9 / 26.6 |  97.6 / 61.2 / 50.4 | 100.0 / 56.8 / 76.3 |

## Wikipedia and science

| Model                                |           vitaminc |            scifact |
| ------------------------------------ | -----------------: | -----------------: |
| Jev 1.14                             | 90.3 / 39.4 / 79.1 | 94.6 / 49.3 / 82.0 |
| Clef                                 | 73.8 / 43.7 / 59.7 | 92.9 / 36.6 / 55.5 |
| Clef Flash                           | 66.7 / 16.9 / 29.5 | 93.9 / 43.7 / 22.7 |
| Clef Omni                            | 65.6 / 29.6 / 58.1 | 94.7 / 50.7 / 59.4 |
| GPT-6 Luna (OpenAI Decisions)        | 88.2 / 21.1 / 72.9 | 86.4 / 26.8 / 63.3 |
| Decision-1 (OpenRouter)              | 81.8 / 50.7 / 75.2 | 91.9 / 47.9 / 66.4 |
| Pplx Decider v1.2 (OpenRouter)       | 94.6 / 49.3 / 79.8 | 93.9 / 43.7 / 53.9 |
| Pplx Decider Flash v1.2 (OpenRouter) | 85.4 / 49.3 / 64.3 | 93.1 / 38.0 / 21.1 |

## Joint point targets

Passing means precision≥95%, recall≥90%, and clear-negative coverage≥85% on the same native-label scorecard. It does not qualify the service contract or establish a confidence-bound guarantee.

| Model                                | Primary scorecards meeting all three targets |
| ------------------------------------ | -------------------------------------------- |
| Jev 1.14                             | None                                         |
| Clef                                 | None                                         |
| Clef Flash                           | None                                         |
| Clef Omni                            | None                                         |
| GPT-6 Luna (OpenAI Decisions)        | None                                         |
| Decision-1 (OpenRouter)              | None                                         |
| Pplx Decider v1.2 (OpenRouter)       | None                                         |
| Pplx Decider Flash v1.2 (OpenRouter) | None                                         |

## Execution on880 public pairs per model

| Model                                | Completed | Errors / excluded | p50ms | p95ms | p99ms | Known input tokens / unknown observations |
| ------------------------------------ | --------: | ----------------: | ----: | ----: | ----: | ----------------------------------------: |
| Jev 1.14                             |   880/880 |             0 / 0 |    65 |   107 |   139 |                                649108 / 0 |
| Clef                                 |   879/880 |             1 / 0 |   393 |   787 |   994 |                                454909 / 1 |
| Clef Flash                           |   880/880 |             0 / 0 |   187 |   261 |   386 |                                455342 / 0 |
| Clef Omni                            |   879/880 |             1 / 0 |   208 |   694 |  1441 |                                452418 / 1 |
| GPT-6 Luna (OpenAI Decisions)        |   878/880 |             2 / 0 |   248 |   534 |   860 |                                405384 / 2 |
| Decision-1 (OpenRouter)              |   880/880 |             0 / 0 |   296 |   403 |   506 |                                350622 / 0 |
| Pplx Decider v1.2 (OpenRouter)       |   877/880 |             3 / 0 |   342 |   865 |  1445 |                                400929 / 3 |
| Pplx Decider Flash v1.2 (OpenRouter) |   878/880 |             2 / 0 |   217 |   258 |   312 |                                401598 / 2 |

Successful-call latency excludes failed calls; all failures remain in completion counts. Reported tokenizers can differ; usage is not an invoice. Actual billed cost and unavailable output usage remain unknown. One unchanged pass does not establish stability, capacity, or an SLA. Model order is fixed, so timing can include changing network or provider load. Client attempts are sequential; a timed-out native Workers AI operation may continue running upstream.

## Per-domain detailed metrics

### vitaminc

| Model                                | TP / FP | Precision | Recall |   F1 | Clear negatives | Uncertain | False clears | Errors / excluded | AUROC |
| ------------------------------------ | ------: | --------: | -----: | ---: | --------------: | --------: | -----------: | ----------------: | ----: |
| Jev 1.14                             |  28 / 3 |     90.3% |  39.4% | 54.9 |           79.1% |        58 |            9 |             0 / 0 | 0.863 |
| Clef                                 | 31 / 11 |     73.8% |  43.7% | 54.9 |           59.7% |        66 |           15 |             0 / 0 | 0.761 |
| Clef Flash                           |  12 / 6 |     66.7% |  16.9% | 27.0 |           29.5% |       135 |            9 |             0 / 0 | 0.746 |
| Clef Omni                            | 21 / 11 |     65.6% |  29.6% | 40.8 |           58.1% |        82 |           11 |             0 / 0 | 0.774 |
| GPT-6 Luna (OpenAI Decisions)        |  15 / 2 |     88.2% |  21.1% | 34.1 |           72.9% |        80 |            9 |             0 / 0 | 0.861 |
| Decision-1 (OpenRouter)              |  36 / 8 |     81.8% |  50.7% | 62.6 |           75.2% |        49 |           10 |             0 / 0 | 0.870 |
| Pplx Decider v1.2 (OpenRouter)       |  35 / 2 |     94.6% |  49.3% | 64.8 |           79.8% |        55 |            5 |             0 / 0 | 0.931 |
| Pplx Decider Flash v1.2 (OpenRouter) |  35 / 6 |     85.4% |  49.3% | 62.5 |           64.3% |        71 |            5 |             0 / 0 | 0.859 |

### scifact

| Model                                | TP / FP | Precision | Recall |   F1 | Clear negatives | Uncertain | False clears | Errors / excluded | AUROC |
| ------------------------------------ | ------: | --------: | -----: | ---: | --------------: | --------: | -----------: | ----------------: | ----: |
| Jev 1.14                             |  35 / 2 |     94.6% |  49.3% | 64.8 |           82.0% |        54 |            3 |             0 / 0 | 0.968 |
| Clef                                 |  26 / 2 |     92.9% |  36.6% | 52.5 |           55.5% |        99 |            1 |             0 / 0 | 0.950 |
| Clef Flash                           |  31 / 2 |     93.9% |  43.7% | 59.6 |           22.7% |       137 |            0 |             0 / 0 | 0.959 |
| Clef Omni                            |  36 / 2 |     94.7% |  50.7% | 66.1 |           59.4% |        83 |            1 |             1 / 0 | 0.965 |
| GPT-6 Luna (OpenAI Decisions)        |  19 / 3 |     86.4% |  26.8% | 40.9 |           63.3% |        87 |            8 |             1 / 0 | 0.819 |
| Decision-1 (OpenRouter)              |  34 / 3 |     91.9% |  47.9% | 63.0 |           66.4% |        75 |            2 |             0 / 0 | 0.933 |
| Pplx Decider v1.2 (OpenRouter)       |  31 / 2 |     93.9% |  43.7% | 59.6 |           53.9% |        96 |            1 |             0 / 0 | 0.952 |
| Pplx Decider Flash v1.2 (OpenRouter) |  27 / 2 |     93.1% |  38.0% | 54.0 |           21.1% |       142 |            0 |             1 / 0 | 0.925 |

### contractnli

| Model                                | TP / FP | Precision | Recall |   F1 | Clear negatives | Uncertain | False clears | Errors / excluded | AUROC |
| ------------------------------------ | ------: | --------: | -----: | ---: | --------------: | --------: | -----------: | ----------------: | ----: |
| Jev 1.14                             |  13 / 2 |     86.7% |  50.0% | 63.4 |           64.2% |        71 |            2 |             0 / 0 | 0.927 |
| Clef                                 |   8 / 0 |    100.0% |  30.8% | 47.1 |           34.1% |       132 |            0 |             0 / 0 | 0.952 |
| Clef Flash                           |   9 / 0 |    100.0% |  34.6% | 51.4 |           15.0% |       164 |            0 |             0 / 0 | 0.949 |
| Clef Omni                            |  13 / 1 |     92.9% |  50.0% | 65.0 |           47.4% |       103 |            0 |             0 / 0 | 0.980 |
| GPT-6 Luna (OpenAI Decisions)        |  10 / 3 |     76.9% |  38.5% | 51.3 |           38.7% |       117 |            1 |             1 / 0 | 0.854 |
| Decision-1 (OpenRouter)              | 17 / 12 |     58.6% |  65.4% | 61.8 |           48.0% |        87 |            0 |             0 / 0 | 0.885 |
| Pplx Decider v1.2 (OpenRouter)       |  14 / 1 |     93.3% |  53.8% | 68.3 |           54.9% |        88 |            0 |             1 / 0 | 0.964 |
| Pplx Decider Flash v1.2 (OpenRouter) |   7 / 0 |    100.0% |  26.9% | 42.4 |           26.6% |       145 |            0 |             1 / 0 | 0.955 |

### mnli

| Model                                | TP / FP | Precision | Recall |   F1 | Clear negatives | Uncertain | False clears | Errors / excluded | AUROC |
| ------------------------------------ | ------: | --------: | -----: | ---: | --------------: | --------: | -----------: | ----------------: | ----: |
| Jev 1.14                             |  39 / 0 |    100.0% |  58.2% | 73.6 |           81.2% |        50 |            3 |             0 / 0 | 0.977 |
| Clef                                 |  27 / 0 |    100.0% |  40.3% | 57.4 |           56.4% |        96 |            1 |             1 / 0 | 0.957 |
| Clef Flash                           |  31 / 0 |    100.0% |  46.3% | 63.3 |           41.4% |       114 |            0 |             0 / 0 | 0.982 |
| Clef Omni                            |  37 / 1 |     97.4% |  55.2% | 70.5 |           52.6% |        92 |            0 |             0 / 0 | 0.983 |
| GPT-6 Luna (OpenAI Decisions)        |  22 / 0 |    100.0% |  32.8% | 49.4 |           66.9% |        84 |            5 |             0 / 0 | 0.876 |
| Decision-1 (OpenRouter)              |  44 / 2 |     95.7% |  65.7% | 77.9 |           75.9% |        51 |            2 |             0 / 0 | 0.970 |
| Pplx Decider v1.2 (OpenRouter)       |  45 / 1 |     97.8% |  67.2% | 79.6 |           60.2% |        73 |            0 |             1 / 0 | 0.987 |
| Pplx Decider Flash v1.2 (OpenRouter) |  41 / 1 |     97.6% |  61.2% | 75.2 |           50.4% |        91 |            0 |             0 / 0 | 0.984 |

### findver

| Model                                | TP / FP | Precision | Recall |   F1 | Clear negatives | Uncertain | False clears | Errors / excluded | AUROC |
| ------------------------------------ | ------: | --------: | -----: | ---: | --------------: | --------: | -----------: | ----------------: | ----: |
| Jev 1.14                             |  36 / 0 |    100.0% |  81.8% | 90.0 |           71.1% |        18 |            1 |             0 / 0 | 0.963 |
| Clef                                 |  12 / 0 |    100.0% |  27.3% | 42.9 |           55.3% |        47 |            2 |             0 / 0 | 0.939 |
| Clef Flash                           |  11 / 0 |    100.0% |  25.0% | 40.0 |           36.8% |        54 |            3 |             0 / 0 | 0.861 |
| Clef Omni                            |   8 / 0 |    100.0% |  18.2% | 30.8 |           76.3% |        39 |            6 |             0 / 0 | 0.927 |
| GPT-6 Luna (OpenAI Decisions)        |  33 / 0 |    100.0% |  75.0% | 85.7 |           78.9% |        17 |            2 |             0 / 0 | 0.956 |
| Decision-1 (OpenRouter)              |  24 / 1 |     96.0% |  54.5% | 69.6 |           65.8% |        28 |            4 |             0 / 0 | 0.903 |
| Pplx Decider v1.2 (OpenRouter)       |  38 / 0 |    100.0% |  86.4% | 92.7 |           81.6% |        10 |            2 |             1 / 0 | 0.965 |
| Pplx Decider Flash v1.2 (OpenRouter) |  25 / 0 |    100.0% |  56.8% | 72.5 |           76.3% |        25 |            3 |             0 / 0 | 0.968 |

### findver-strict-subset

| Model                                | TP / FP | Precision | Recall |   F1 | Clear negatives | Uncertain | False clears | Errors / excluded | AUROC |
| ------------------------------------ | ------: | --------: | -----: | ---: | --------------: | --------: | -----------: | ----------------: | ----: |
| Jev 1.14                             |  10 / 0 |    100.0% |  76.9% | 87.0 |           70.0% |         6 |            0 |             0 / 0 | 0.950 |
| Clef                                 |   5 / 0 |    100.0% |  38.5% | 55.6 |           50.0% |        13 |            0 |             0 / 0 | 0.938 |
| Clef Flash                           |   3 / 0 |    100.0% |  23.1% | 37.5 |           60.0% |        13 |            1 |             0 / 0 | 0.869 |
| Clef Omni                            |   1 / 0 |    100.0% |   7.7% | 14.3 |           80.0% |        11 |            3 |             0 / 0 | 0.931 |
| GPT-6 Luna (OpenAI Decisions)        |   9 / 0 |    100.0% |  69.2% | 81.8 |           80.0% |         6 |            0 |             0 / 0 | 0.958 |
| Decision-1 (OpenRouter)              |   7 / 1 |     87.5% |  53.8% | 66.7 |           60.0% |         7 |            2 |             0 / 0 | 0.862 |
| Pplx Decider v1.2 (OpenRouter)       |  11 / 0 |    100.0% |  84.6% | 91.7 |           70.0% |         4 |            1 |             0 / 0 | 0.938 |
| Pplx Decider Flash v1.2 (OpenRouter) |   7 / 0 |    100.0% |  53.8% | 70.0 |           70.0% |         8 |            1 |             0 / 0 | 0.962 |

## Synthetic diagnostics

Synthetic cases test known boundary expectations; they are not public benchmark quality. Four uncertain contract fixtures use schema-only binary proxies and are excluded from binary metrics.

| Model                                | Smoke precision / recall / negative coverage | Contract explicit expectations |
| ------------------------------------ | -------------------------------------------: | -----------------------------: |
| Jev 1.14                             |                         100.0 / 100.0 / 60.0 |                          27/32 |
| Clef                                 |                         100.0 / 100.0 / 40.0 |                          24/32 |
| Clef Flash                           |                         100.0 / 100.0 / 40.0 |                          15/32 |
| Clef Omni                            |                         100.0 / 100.0 / 60.0 |                          21/32 |
| GPT-6 Luna (OpenAI Decisions)        |                         100.0 / 100.0 / 60.0 |                          27/32 |
| Decision-1 (OpenRouter)              |                         100.0 / 100.0 / 40.0 |                          29/32 |
| Pplx Decider v1.2 (OpenRouter)       |                         100.0 / 100.0 / 80.0 |                          26/32 |
| Pplx Decider Flash v1.2 (OpenRouter) |                         100.0 / 100.0 / 80.0 |                          24/32 |

## Limits and reproduction

ContractNLI labels describe full NDAs and are transferred to all gold rationale excerpts: not the official full-document task. FinDVer retains all annotated contexts/tables but only82/250 IE pairs fit2KiB; this is length-conditioned coverage. MultiNLI government/telephone/Slate is business-adjacent language, not workplace-native policy or CRM truth. SciFact uses complete gold rationale sets, not retrieval; VitaminC uses combined development data. Existing science/Wikipedia sampling is not population representative. No new labels were adjudicated.

`summary.json` retains per-domain native-label/genre/clause slices, Wilson and source-group bootstrap intervals, probability denominators, calibration, risk/coverage, failures and model identities. `observations.redacted.jsonl.gz` contains typed predictions and scoring metadata, with **all** claim/evidence text removed and identified by hashes/byte lengths. It is a transformed scoring archive, not a canonical input manifest; finance issuer text is not redistributed. Original manifests/checkpoints/report hashes are pinned, and raw reports remain in ignored local storage.

Reproduce the summary offline from archived scoring rows; exact inference reconstruction additionally needs the frozen original manifests and provider configuration. The protocol records pre-inference execution-source hashes and runtime. Analysis code was developed during the run and is separately pinned at archive creation in `analysis-provenance.json`, with exact execution and analysis source snapshots; the matrix ran on the current5a614f0 service baseline with benchmark-only tooling additions. No model default or production prompt was changed by this run.

Dataset attribution, source/terms URLs and pinned source hashes are preserved in `data-provenance.json`. Adapter and license notes: [VitaminC and SciFact](../../README.md), [business datasets](../../business/README.md).
