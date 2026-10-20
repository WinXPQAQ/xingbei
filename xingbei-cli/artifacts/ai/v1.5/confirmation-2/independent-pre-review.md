# Independent acceptance pre-review — plans-2 rejected before completion

Reviewer: independent acceptance agent `/root/v15_acceptance_review`.
Frozen candidate: `469e37f03a3a2d2679dae4c28f3e907e42e78163`.

This is not an acceptance pass. The parent stopped confirmation after a separate code reviewer produced a real-engine counterexample: a shield-related early return classified a branch with unknown responses as a certain +100000 terminal win. The stop was based on this correctness finding, not interim win rate. No interim win rate was computed or used by this reviewer. The candidate must be fixed, frozen again, and tested with independent seeds; this partial run must not be pooled into a later confirmation.

## Independently verified

Read AGENTS.md, the v1.5 protocol, confirmation runner, evaluator, performance runner and analysis implementation. A separate Python implementation (not an invocation/import of the project's analyzer) checked:

- Exactly 17,280 manifest entries: 5,760 v1.4 primary games; 960 each versus v1.3, v1.2, v1.0; 4,320 each with flow and reserve teammates.
- Exact Cartesian coverage of every specified seed, four rosters, six starts, both colors, and three candidate seats for each mixed-team color. Color-specific hero remapping agrees with the declared rosters.
- Each mixed-team configuration assigns the candidate to exactly one seat, the declared style to the two teammates, and v1.4 to all opponents. The evaluator routes ordinary actions, responses, discards, rule decisions, and synchronous nested decisions through the seat policy.
- All 136 manifest source-file hashes agree both with current files at review time and with the frozen Git object. The default strategy remained v1.4.
- Final read at this review: 3,889 completed JSONL records; no complete-shard markers. Every record had a unique expected ID, matched its exact manifest configuration and flattened configuration, used a recognized outcome matching winner/team, and stayed within 300 turns. No malformed partial JSON lines were encountered. These are integrity checks only; an incomplete sample cannot satisfy acceptance.
- Independently recomputed performance from 1,800 raw measurements in 18 cells: candidate p95 29.935837 ms; maximum 92.830481 ms; largest within-cell median ratio 1.769497; largest p95 ratio 1.838343. All preregistered numeric performance bounds passed for that frozen candidate's measurement. Raw JSON includes CPU and Node provenance; its source provenance is the retained file in the frozen commit, not an embedded source-hash field.

## Statistical and evidence limitations

The preregistered seed-cluster bootstrap is appropriate for the balanced factorial design: each seed is a dependent cluster, not an independent game. Five one-sided 99% primary bounds (overall plus four roster endpoints) give nominal 95% family coverage by Bonferroni; bootstrap coverage is approximate. The overall 50% floor and other endpoint 45% floors remain separate simultaneous requirements. Truncation is a hard failure. Final bootstrap was deliberately not calculated because the run is incomplete.

The original analyzer checks row count and unique IDs but does not itself check exact manifest ID membership/configuration or reject every unknown outcome string. The independent audit supplements these checks; this is an evidence-validation weakness, not proof that the observed rows were invalid. Completion markers and runner exit status must also be checked for a future completed run.

Mixed-style endpoints measure absolute performance in the declared teammate context. Without a matched old-policy single-seat control, they do not isolate a causal improvement from swapping that seat alone.

All executed ordinary actions pass through the legal-action adapter. Zero illegal executions does not establish that the underlying heuristic never proposed an invalid candidate that the adapter filtered out. Preserve this distinction in release wording.

## Disposition

REJECTED / INCOMPLETE. No release approval; no completed-match acceptance, no statistical success inference. This review changed no source, started/stopped no matches, and created no commit. Independent audit script remains `/tmp/v15-independent-audit.py`; the parent may adapt it to the next frozen candidate and independent confirmation directory.
