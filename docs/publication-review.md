# Public-repository review

Reviewed November 5, 2026. Scope: the tracked source tree and all reachable local Git refs before this cleanup, including decompressed gzip artifacts. This is a publication-content audit, not a penetration test or a claim that every possible secret format can be detected.

## Changes made

- Added the official Apache License 2.0 text, project attribution in `NOTICE`, and `Apache-2.0` package metadata.
- Added [third-party data and model notices](../DATA_NOTICE.md). The code license does not replace dataset, source-document, model or dependency terms.
- Removed 39 internal agent-review files from the public source tree, including raw session and per-review billing metadata. A short public [review-process description](reviews/README.md) replaces them.
- Removed tracked design-tool working state. Maintained product/design documentation and actual application assets remain.
- Preserved the removed material in an ignored local backup. Added explicit Git/lint/format exclusions for that private directory, plus Git ignores for generated tool state, environment-specific Wrangler secret files, direnv cache and macOS metadata. The `.dev.vars.example` template remains included.
- Removed a personal browser-profile reference from the deployment guide and replaced internal review links with public validation documentation.
- Corrected a stale product-document statement about a top-level aggregate verdict. Verdicts are per comparison.
- Re-read the public README, evaluator/runner guides, model catalog, deployment/account setup and architecture reference. Replaced internal agent ownership instructions and stale setup/deployment language.
- Added the owner-confirmed provider-relationship disclosure, explicit dataset-reuse and staged-protocol disclosures, and a separately versioned [post-hoc analysis supplement](../eval/results/hosted-models-analysis-2026-11-05/README.md). Original measurement archives and their hashes remain intact.
- Added offline analysis regression fixtures and release verification to GitHub checks; Cloudflare Workers Builds remains the deployment pipeline.

No benchmark observations, source snapshots, original third-party terms or measured outcomes were changed by this cleanup.

## Credential and data checks

The initial history scan covered 1,008 Git objects, including 824 unique blobs and 201 compressed blobs. It compared contents against 17 known local credential values in memory, without printing those values, and checked common private-key, provider-key, GitHub-token, AWS-key, Slack-token and JWT patterns. It found no known credential matches or pattern candidates. Commit messages and annotated-tag objects were also checked. Local environment files, raw data/reports, model caches and Wrangler state were not tracked.

The selected finance cohort's 164 distinct claim/evidence strings were also checked in raw and JSON-escaped forms against reachable blob contents. The scan found 0 matching blobs; no source text was printed. The detailed receipt stays private. Current measured archives redact that text and retain scoring metadata and hashes. The public offline verifier checks all nine models and 8,280 observations without original finance documents or credentials.

Opaque Cloudflare account/database IDs, model IDs, public service URLs and deployment version IDs are not authentication credentials. Maintainer deployment configuration remains in place so the existing build pipeline is not silently changed. Forks must configure their own resources; those identifiers do not grant access to the maintainer's account.

## Public Git history

The public source is republished as a single root commit, with no parent link to the earlier development commits. The maintained `main` ref contains this cleaned tree; obsolete development branch refs are removed. The prior repository is preserved only in an ignored private local recovery bundle, not in a backup branch or public tag. Do not upload that bundle or the private backup directory.

Rewriting Git refs does not erase third-party clones, forks, previously downloaded archives, or hosting-provider caches of old commit objects. This review found no known credential values in the scanned history; the rewrite removes internal development records from the advertised history rather than asserting physical erasure from every system.

Four older measured workflow manifests retain original absolute workstation paths. Those are non-credential provenance metadata and are left byte-exact to preserve their recorded hashes. They are not required by the latest offline verification command. If further anonymization is wanted, publish explicitly labeled transformed derivatives with original hashes and update the relevant reproduction inventory; do not silently edit measured artifacts.

The current source tree is licensed, the latest evaluation evidence remains intact, and the history cleanup is separate from licensing or model-quality qualification.
