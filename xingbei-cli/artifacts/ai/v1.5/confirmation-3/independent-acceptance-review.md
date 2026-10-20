# Independent final acceptance review — plans-3: FAIL

Frozen source: `2d7361b2282d4b27a35c4278e50e336b6cb13997`.
Reviewer: `/root/v15_acceptance_review`.

**Do not promote this candidate.** Two preregistered mixed-teammate endpoints failed their 45% absolute win-rate gate. Strong results with three candidate teammates do not override these independent requirements. Diagnosing the weak teammate contexts is appropriate; retrospectively lowering the gate or changing the endpoint definition is not.

## Independent procedure and integrity

The reviewer used a separate Python implementation, before reading the project's summary, to validate the manifest and records and to calculate all win counts and seed-cluster bootstrap bounds. It did not invoke or import the project's analyzer. After calculation, every endpoint, lineup bound, and pass/fail result matched the project analyzer exactly.

All 17,280 planned IDs occurred once with exact nested and flattened configurations, recognized winner/outcome values and consistent results. All turn counts were integers from 0 through 300. All four shards contained 4,320 records assigned by the prescribed ID modulo rule, with matching completion markers and exactly four successful shard exits. No records were truncated, malformed, omitted, duplicated, or filtered.

The exact factorial design, independent seed range 1530001–1530120, four rosters, six starts, two colors and mixed-style single-candidate seat routing matched the protocol. Every manifest source hash matched the frozen Git object. Performance candidate hashes matched the same manifest.

## Independent results

| Endpoint | Wins / games | Win rate | Gate |
|---|---:|---:|---|
| v1.4 | 3908 / 5760 | 67.8472% | Pass |
| v1.3 | 677 / 960 | 70.5208% | Pass |
| v1.2 | 718 / 960 | 74.7917% | Pass |
| v1.0 | 823 / 960 | 85.7292% | Pass |
| flow teammates | 1265 / 4320 | **29.2824%** | **FAIL: below 45%** |
| reserve teammates | 623 / 4320 | **14.4213%** | **FAIL: below 45%** |

Primary overall 99% one-sided bootstrap lower bound: 66.3368%. Four roster bounds: mirrorAssault 53.0556%, mirrorMixed 78.7500%, asymmetric 67.5694%, asymmetricReverse 60.9028%. All exceed the fixed 45% bound. Bootstrap uses seed clusters, 10,000 samples, RNG seed 1505001, and sorted index 100. Bonferroni interpretation is nominal 95% family coverage over these five bounds; bootstrap coverage is approximate.

The mixed-style results measure the declared absolute team performance, not an isolated causal contribution of the candidate seat. No matching old-policy candidate-seat control was preregistered. This limitation does not invalidate or relax the fixed acceptance failure.

## Performance

Independently recomputed 1,800 raw records across 180 snapshots, five measured repetitions, two versions, and 18 cells. Overall candidate p95: 29.777084 ms; maximum: 82.594281 ms. Largest cell median ratio: 1.794997; largest p95 ratio: 1.923297. All fixed performance gates passed. Performance success does not override the match endpoint failures.

## Evidence and next disposition

`independent-acceptance-recalculation.json` contains independent numeric results. `independent-audit.py` retains the separate calculation implementation (its default workspace paths refer to this review environment). The original failed candidates and this complete failed confirmation must remain retained. Any behavioral fix requires a new frozen candidate and a new independent seed range; do not pool this confirmation into the next one or report it as a successful release acceptance.

No source code changed, no games were started or repeated, and no commit was created by this review.
