# Requirements pair dataset readiness audit

Checked 2026-11-04. Research only: no adapter, model calls, or access to existing locked manifests. **Defer PURE/CDN as a fourth source for the current 200-pair, whole-component phase.**

The [PLOS paper](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0344174) links [Figshare article 29589251](https://figshare.com/articles/dataset/TSRCDF-SS_/29589251). Its [primary API metadata](https://api.figshare.com/v2/articles/29589251) identifies version 3, DOI `10.6084/m9.figshare.29589251.v3`, and depositor-declared CC0. Only the two CSVs below were downloaded into ignored `eval/data/business/`; their MD5s match published metadata.

| File / direct file ID                                                  |     Bytes | SHA-256                                                            | MD5                                |
| ---------------------------------------------------------------------- | --------: | ------------------------------------------------------------------ | ---------------------------------- |
| [pure.csv / 56391938](https://ndownloader.figshare.com/files/56391938) |   692,788 | `b66bd0eaf5f27ccf9d4b52d4bede1b1c5b2a7e0717185a3c4a30fdd6ae25af3d` | `9522df8327c90a08290dbf28bfe07cb0` |
| [cdn.csv / 56391920](https://ndownloader.figshare.com/files/56391920)  | 2,286,810 | `068d231bd60ea9a6b68a555488f02e5c7ff80cd54e5076a65788354deb246775` | `e07b00ce45f68ffde0eb4ae2af07fe6b` |

## Observed structure and quality

Both files have only an unnamed original row-index column, `Text1`, `Text2`, and `Class`. They supply no project IDs or fixed official train/dev/test assignments. Published cross-validation is not an official split to invent in an adapter.

| File | Native labels                                  | Distinct normalized requirements | Connected components / pair counts | Maximum text UTF-8 bytes |
| ---- | ---------------------------------------------- | -------------------------------: | ---------------------------------- | -----------------------: |
| PURE | Conflict 20; Neutral 2,191                     |                               67 | One / 2,211                        |                      443 |
| CDN  | Conflict 5,553; Duplicate 1,673; Neutral 3,400 |                              781 | One / 10,626                       |                      221 |

Offline standard-library analysis formed undirected edges from every `Text1`/`Text2` pair, normalizing each endpoint with Unicode NFKC, lowercase, and collapsed whitespace. Every pair sharing an endpoint joins the same component. PURE has all `67 choose 2 = 2,211` pairs. Together the files have two components, with no cross-file shared endpoints. Both fit a 2,048-byte per-text envelope without exclusions, but neither contains any whole component of at most 200 pairs. A component-preserving 200-pair sample therefore contains zero pairs. Arbitrary pair sampling would change that protocol and permit shared-requirement leakage between local partitions.

CDN has 1,229 excess rows over unique normalized unordered pairs. **395 normalized unordered pairs have multiple native labels**: 371 Conflict/Duplicate, 19 Conflict/Neutral, 2 all three labels, and 3 Duplicate/Neutral. This is not merely a symmetry assumption: **252 byte-identical ordered pairs have disagreeing labels**, and **71 rows have byte-identical `Text1 == Text2` labeled Conflict**. Normalized self-pair conflicts total 78. Raw unordered disagreements total 397; normalization merges some keys, hence the distinct normalized count of 395.

Counterexamples are identified without copying proprietary-origin text: CDN original source index `3` (CSV data row 4) is an exact self-pair labeled Conflict; the identical ordered pair at source index `12` (data row 13) is Duplicate, and source index `6861` (data row 6,862) is Conflict. Original source index `9` (data row 10) is Duplicate; its reversed pair appears as both Conflict at index `2333` and Duplicate at index `2341`. Preserve native labels if studying this release; do not silently resolve or relabel these disagreements.

## Provenance and rights limits

The [original Malik author paper, §3.1](https://arxiv.org/html/2301.03709v2) describes CDN/CN as proprietary-origin data: 48 IBM-DOORS requirements, with conflict variants authored by 10 IBM developers and duplicates authored by nine, verified by domain experts. Neutral pairs were downsampled. These are human-authored constructed examples, not exclusively naturally occurring conflicts. Its PURE adaptation selects THEMAS and Mashbot, simplifies paragraphs, and includes added synthetic conflicts; it is not the complete 79-document PURE corpus. Per-row authoring/adjudication records are absent in these CSVs. The PLOS paper's separate claim of manual annotation for TRAINNLI does not establish PURE/CDN annotation provenance.

The CC0 deposition is distinct from upstream source rights. The [original PURE author release](https://zenodo.org/records/7118517) states that underlying requirements were gathered from the web without known license/IP agreements and offers removal on request. Neither that statement nor the later deposit establishes blanket original-text rights. Keep cached texts local and do not advertise these files as uniformly cleared business-native truth.

These files could support a separately designed requirements diagnostic after label and source-rights review. They are not ready for the present component-sampled fourth-source slot or an independent service-contract release gate.
