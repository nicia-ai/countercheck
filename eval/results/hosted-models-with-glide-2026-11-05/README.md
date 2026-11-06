# Nine-model contradiction benchmark comparison

Measured November 5, 2026. Eight exposed Countercheck models plus the **evaluation-only hosted Fastino GLiDE 27B**. The 0.4B, 0.8B, 2B and 9B releases remain pending, as requested; no scores are fabricated for unserved models.

**8,280 scored observations:** 880 frozen public pairs and 40 synthetic cases per model. Fixed shipped `balanced-v1` policy, original presentation, single pairs, one pass, sequential calls, 3,000ms kernel deadline, no retries, fallback, truncation, prompt fitting or threshold tuning. The original 23-pair finance scorecard is a derived subset of 82, with no extra calls. Three Fastino integration probes are recorded separately and excluded from quality denominators. The first phase and Fastino phase have separate pre-inference protocols; shared kernel, compiler, metrics and input bytes are verified unchanged.

This compares current shipped-policy behavior, not optimally calibrated or prompted performance for every model. Native public labels are not independently adjudicated service-contract labels. Error and uncertainty remain misses in recall and coverage; unavailable distributions are excluded only from probability metrics.

## F1 by domain

F1 is calculated with positive uncertainty, errors and exclusions retained as missed contradictions. Values are percentages; quality is not pooled across domains.

| Model                                | Wikipedia200 | Science199 | Contracts199 | Business-adjacent200 | Finance82 |
| ------------------------------------ | -----------: | ---------: | -----------: | -------------------: | --------: |
| Jev 1.14                             |         54.9 |       64.8 |         63.4 |                 73.6 |      90.0 |
| Clef                                 |         54.9 |       52.5 |         47.1 |                 57.4 |      42.9 |
| Clef Flash                           |         27.0 |       59.6 |         51.4 |                 63.3 |      40.0 |
| Clef Omni                            |         40.8 |       66.1 |         65.0 |                 70.5 |      30.8 |
| GPT-6 Luna (OpenAI Decisions)        |         34.1 |       40.9 |         51.3 |                 49.4 |      85.7 |
| Decision-1 (OpenRouter)              |         62.6 |       63.0 |         61.8 |                 77.9 |      69.6 |
| Pplx Decider v1.2 (OpenRouter)       |         64.8 |       59.6 |         68.3 |                 79.6 |      92.7 |
| Pplx Decider Flash v1.2 (OpenRouter) |         62.5 |       54.0 |         42.4 |                 75.2 |      72.5 |
| GLiDE 27B (Fastino API)              |         64.2 |       55.4 |         68.3 |                 76.4 |      95.2 |

## Business precision / recall / clear-negative coverage

Each cell is **P / R / N**, in percent. Proposed point targets are 95 / 90 / 85 on the same scorecard.

| Model                                |           Contracts |   Business-adjacent |             Finance |
| ------------------------------------ | ------------------: | ------------------: | ------------------: |
| Jev 1.14                             |  86.7 / 50.0 / 64.2 | 100.0 / 58.2 / 81.2 | 100.0 / 81.8 / 71.1 |
| Clef                                 | 100.0 / 30.8 / 34.1 | 100.0 / 40.3 / 56.4 | 100.0 / 27.3 / 55.3 |
| Clef Flash                           | 100.0 / 34.6 / 15.0 | 100.0 / 46.3 / 41.4 | 100.0 / 25.0 / 36.8 |
| Clef Omni                            |  92.9 / 50.0 / 47.4 |  97.4 / 55.2 / 52.6 | 100.0 / 18.2 / 76.3 |
| GPT-6 Luna (OpenAI Decisions)        |  76.9 / 38.5 / 38.7 | 100.0 / 32.8 / 66.9 | 100.0 / 75.0 / 78.9 |
| Decision-1 (OpenRouter)              |  58.6 / 65.4 / 48.0 |  95.7 / 65.7 / 75.9 |  96.0 / 54.5 / 65.8 |
| Pplx Decider v1.2 (OpenRouter)       |  93.3 / 53.8 / 54.9 |  97.8 / 67.2 / 60.2 | 100.0 / 86.4 / 81.6 |
| Pplx Decider Flash v1.2 (OpenRouter) | 100.0 / 26.9 / 26.6 |  97.6 / 61.2 / 50.4 | 100.0 / 56.8 / 76.3 |
| GLiDE 27B (Fastino API)              |  93.3 / 53.8 / 71.1 |  97.7 / 62.7 / 82.7 | 100.0 / 90.9 / 81.6 |

## Execution on 880 public pairs per model

Provider/kernel latency includes the route used in this run, **not authenticated deployed API latency or capacity**. Cloudflare models use the native binding through Wrangler’s remote proxy; other providers use direct native HTTPS. Successful-call percentiles exclude errors, which remain in the completed counts. Model order was fixed, so changing network/provider load can affect timing.

| Model                                | Completed | Errors / excluded | p50ms | p95ms | p99ms |
| ------------------------------------ | --------: | ----------------: | ----: | ----: | ----: |
| Jev 1.14                             |   880/880 |             0 / 0 |    65 |   107 |   139 |
| Clef                                 |   879/880 |             1 / 0 |   393 |   787 |   994 |
| Clef Flash                           |   880/880 |             0 / 0 |   187 |   261 |   386 |
| Clef Omni                            |   879/880 |             1 / 0 |   208 |   694 |  1441 |
| GPT-6 Luna (OpenAI Decisions)        |   878/880 |             2 / 0 |   248 |   534 |   860 |
| Decision-1 (OpenRouter)              |   880/880 |             0 / 0 |   296 |   403 |   506 |
| Pplx Decider v1.2 (OpenRouter)       |   877/880 |             3 / 0 |   342 |   865 |  1445 |
| Pplx Decider Flash v1.2 (OpenRouter) |   878/880 |             2 / 0 |   217 |   258 |   312 |
| GLiDE 27B (Fastino API)              |   879/880 |             1 / 0 |   145 |   242 |  1038 |

## Joint quality targets

Passing a native-label scorecard requires precision≥95%, recall≥90%, and clear-negative coverage≥85% together; this is not a production qualification or confidence-bound guarantee.

| Model                                | Primary scorecards meeting all three |
| ------------------------------------ | ------------------------------------ |
| Jev 1.14                             | None                                 |
| Clef                                 | None                                 |
| Clef Flash                           | None                                 |
| Clef Omni                            | None                                 |
| GPT-6 Luna (OpenAI Decisions)        | None                                 |
| Decision-1 (OpenRouter)              | None                                 |
| Pplx Decider v1.2 (OpenRouter)       | None                                 |
| Pplx Decider Flash v1.2 (OpenRouter) | None                                 |
| GLiDE 27B (Fastino API)              | None                                 |

## Evidence and limits

The [original eight-model report](../hosted-models-2026-11-05/README.md) retains per-domain precision, recall, uncertainty, false clears, calibration, AUROC, source-group intervals and original source/license provenance. `summary.json` combines that unchanged summary with the independently verified Fastino reports, including its native-label slices and intervals. `observations.redacted.jsonl.gz` contains all 9 models’ scoring metadata/predictions with every claim/evidence text removed and replaced by original text hashes and byte counts. Finance issuer-report text stays in ignored local storage.

Fastino is requested as `fastino/GLiDE`. The live catalog describes GLiDE v2.3 served in NVFP4 on a B200; successful inference reports `glide_v2`, which is preserved. No immutable checkpoint revision is supplied. Requests use `store:false` and `thinking:false`; the integration check observed `X-Fastino-Data-Retention: not-stored`. Fastino was added to evaluations only; the API/dashboard catalog and default are unchanged.

The public suite consists of Wikipedia-derived VitaminC, SciFact gold rationale sets, ContractNLI complete annotated excerpts, MultiNLI government/telephone/Slate, and supported FinDVer testmini IE contexts. These are adaptations, not official retrieval/full-document leaderboard scores or representative customer traffic. The finance cohort fits only 82/250 IE inputs under 2 KiB without truncation. Full-contract labels transferred to excerpts can lack definitions or exceptions. MultiNLI is business-adjacent, not a workplace-native corpus. One fixed pass does not establish repeat stability or an SLA. Actual billed cost remains unknown; per-provider reported input usage is retained in the summaries.

[Fastino release](https://fastino.ai/blog/glide-decision-model-family), [Fastino API documentation](https://docs.fastino.ai/inference/systemone), and [hosted model catalog](https://api.fastino.ai/v1/base-models?supports_inference=true&task_type=systemone). The release provides open weights at 0.4B/0.8B/2B/9B/27B; the observed API catalog serves only the hosted GLiDE route. The smaller four remain explicitly unrun.

Rebuild and independently verify this extension, without model calls:

```sh
python3 -B scripts/compare-fastino.py --baseline eval/results/hosted-models-2026-11-05 \
  --in eval/reports/fastino-glide-2026-11-05 \
  --executed-sources eval/results/hosted-models-with-glide-2026-11-05/fastino-execution-sources.json.gz \
  --out eval/results/hosted-models-with-glide-new
```

Exact inference reconstruction additionally requires the ignored original input manifests and provider configuration. The protocol and source snapshots pin the actually executed code; this post-inference analysis implementation does not claim a pre-inference analysis freeze.
