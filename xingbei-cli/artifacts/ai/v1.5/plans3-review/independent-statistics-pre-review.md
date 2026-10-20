# Independent statistics pre-review — plans-3

Reviewer: `/root/v15_acceptance_review`. Scope: read-only protocol and analyzer review, plus synthetic analyzer checks in `/tmp`; no experiment started and no source changed.

## Current disposition

The revised statistical procedure and evidence-integrity checks are suitable to proceed to a new frozen confirmation, conditional on all other pre-freeze gates. This is not a release or match acceptance approval. No plans-3 manifest exists at this review, and performance optimization/reverification remains in progress. The initial plans-3 performance failure remains evidence, not a waived gate.

## Protocol

Third-round registration uses independent seeds 1530001–1530120. Previous ranges 1510001–1510120 and 1520001–1520120 are retired in full, with rejected partial runs retained. The 17,280-game matrix, four rosters, six starting seats, both colors, single-candidate-seat mixed teams, 300-turn limit, and numerical gates are unchanged.

The five primary endpoints use seed-cluster bootstrap, 10,000 draws, fixed RNG seed 1505001, and sorted index 100 as the one-sided 99% lower bound. Five 99% bounds provide nominal 95% simultaneous family coverage by Bonferroni; bootstrap coverage is approximate. Overall primary score must also be at least 50%; each other version/style endpoint must score at least 45%; any truncation fails. Balanced manifest clusters are needed to justify averaging seed means; the independent manifest audit will check this after freeze.

## Analyzer integrity

Reviewed fixes now require exact manifest ID membership and uniqueness, full nested configuration and all flattened configuration fields (including seatPolicies), recognized outcome and winner values, winner/outcome consistency, integer turn counts in [0,300], four matching completion markers, and exactly runner shards 0–3 with successful exit codes.

Independent synthetic checks copied the analyzer into a temporary directory with fabricated data, never touching confirmation evidence. All eight checks passed: valid fixture accepted; null winner labeled loss, duplicate exit shard, mismatched flattened seat policy, unknown outcome, unexpected ID, mismatched nested config, and excessive turn count each rejected. These validate data handling only, not gameplay correctness or strength.

Potential remaining limitation: bootstrap resampling order follows filesystem/row insertion order. This does not change the statistical method but can affect exact Monte Carlo values across different file ordering. The independent recalculation will preserve actual shard order and compare raw endpoint results. The final review will additionally compare frozen hashes to Git objects, validate the exact factorial design, verify every completed row, and independently recompute performance and all statistical gates without importing the project's analyzer.

Independent preparation scripts: `/tmp/check-v15-analyzer.py` and `/tmp/v15-independent-audit-plans3.py`. The latter must only produce a final acceptance recalculation after all rows and completion evidence exist. No partial win-rate inference will be used.
