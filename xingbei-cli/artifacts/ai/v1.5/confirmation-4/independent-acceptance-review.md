# Independent final acceptance review — plans-4 paired protocol: PASS

Frozen candidate: `a0e9baaf622432935de4c01dbf996f738ff7801b`.
Reviewer: `/root/v15_acceptance_review`.

**The complete fourth-round preregistered paired match and performance gates pass.** This conclusion applies to the new paired protocol. The third-round original absolute mixed-teammate protocol remains **FAIL** and has not been reinterpreted or overwritten. Publication still requires the separately documented rule, privacy, tests and code-review gates, which are outside this statistical review's final recomputation.

## Independence and integrity

The retained `independent-audit.py` is a separate Python implementation; it does not import/invoke the project's analyzer or use its summary as input. Its own results were calculated first, then compared with the project's JavaScript summary. All counts, seven bootstrap bounds and gate decisions agree; a few mean values differ only by floating-point summation rounding (maximum 2.23e-16, well below 1e-12).

The audit reconstructed the exact 25,920-game factorial design from independently specified rosters, seed ranges, starts, colors, opponents, candidate seats, pair IDs, arms and policies. All 155 frozen file hashes matched both the current files and the frozen Git objects. All planned IDs occurred exactly once with exact nested and flattened configurations. Four shards each contain 6,480 records with correct ID modulo assignment. Four matching completion markers and four successful worker exits are present. Every outcome and winner is recognized and consistent; every turn count is an integer in [0,300]. No truncation, missing pair, duplicate, malformed row or reported execution error was found.

Both mixed endpoints contain 4,320 exact candidate/control pairs. Within each pair, seed, heroes, lineup, start, color and all other five policies match; only the designated seat changes. All records in this confirmation are new; the reused development controls were not pooled into confirmation.

## Primary and historical results

| Opponent | Wins / games | Win rate | Gate |
|---|---:|---:|---|
| v1.4 | 3914 / 5760 | 67.9514% | Pass |
| v1.3 | 665 / 960 | 69.2708% | Pass |
| v1.2 | 715 / 960 | 74.4792% | Pass |
| v1.0 | 824 / 960 | 85.8333% | Pass |

The v1.4 overall one-sided 99.3% lower bound is **66.3194%**, above the 45% bound gate; its observed score also exceeds 50%.

| Primary roster | Wins / games | Win rate | One-sided 99.3% lower bound |
|---|---:|---:|---:|
| mirrorAssault | 773 / 1440 | 53.6806% | 50.5556% |
| mirrorMixed | 1188 / 1440 | 82.5000% | 80.0694% |
| asymmetric | 1033 / 1440 | 71.7361% | 68.6111% |
| asymmetricReverse | 920 / 1440 | 63.8889% | 60.6250% |

All four roster lower bounds exceed the registered 45% requirement.

## Matched teammate results

| Style | Candidate wins / 4320 | Control wins / 4320 | Candidate / control absolute rate | Paired mean delta | One-sided 99.3% delta lower bound | Gate |
|---|---:|---:|---:|---:|---:|---|
| flow | 1374 | 1111 | 31.8056% / 25.7176% | **+6.0880 pp** | **+3.6111 pp** | Pass |
| reserve | 561 | 502 | 12.9861% / 11.6204% | **+1.3657 pp** | **−0.2778 pp** | Pass |

Both endpoints satisfy observed delta ≥ 0 and lower bound ≥ −5 pp. Reserve's interval includes zero: this is a noninferiority-gate pass with a positive observed difference, not evidence of statistically significant superiority. Absolute performance with these stress teammates remains low, especially reserve; the paired pass does not establish that the candidate can carry these teams to 45% or 50%, or beat arbitrary human/weak teammates.

## Statistical interpretation

The independent calculation uses the registered endpoint order: overall, mirrorAssault, mirrorMixed, asymmetric, asymmetricReverse, flow difference, reserve difference. Seeds are ascending; the continuous LCG starts at 1505001 with multiplier 1664525, increment 1013904223 and modulus 2^32. Each endpoint uses 10,000 equal-weight whole-seed-cluster resamples and zero-based sorted index 70. Primary endpoints have 120 clusters; mixed endpoints have 30 clusters of 144 pairs, preserving both arms together.

Seven one-sided 99.3% bounds imply Bonferroni nominal family coverage of at least 95.1% if the marginal coverage holds. Percentile cluster-bootstrap coverage is approximate, particularly in an extreme tail with 30 mixed clusters; this is not an exact finite-sample guarantee. The family claim applies to this fixed experiment and its seven endpoints, not the complete adaptive sequence of failed and repaired candidates. Prior failures remain part of the evidence record.

## Performance

The independently recomputed correct evidence is `artifacts/ai/v1.5/plans4-performance.json`: 1,800 unique measurements covering 180 snapshots × five measured repeats × two strategies, grouped into 18 hero/stress cells. All four recorded candidate source hashes match the frozen confirmation manifest.

- Candidate aggregate p95: **27.497182 ms** (limit 100 ms).
- Largest individual time: **86.816476 ms** (limit 500 ms).
- Largest cell median ratio to v1.4: **1.760446** (limit 2).
- Largest cell p95 ratio to v1.4: **1.777864** (limit 2).

Every fixed performance gate passes. The first independent audit invocation correctly stopped at a provenance mismatch because its artifact script pointed to the old `development-performance.json`. After verifying `plans4-performance.json` hashes against the frozen source, only that independent artifact script's input path was corrected and the full audit rerun. No frozen source, tool, test, experimental data, threshold or candidate changed.

## Evidence and disposition

- `independent-acceptance-recalculation.json`: independently calculated actual results and performance ratios.
- `independent-audit.py`: independent full validation and resampling implementation.
- `independent-manifest-audit.json`: earlier pre-outcome manifest/hash check.
- Project `summary.json`: separately generated result, compared only after independent calculation.

No match was restarted or repeated, and no frozen source was modified. Statistical/performance acceptance is **PASS under the fourth-round paired protocol**, with the limitations above and separate nonstatistical release gates still requiring their own evidence.
