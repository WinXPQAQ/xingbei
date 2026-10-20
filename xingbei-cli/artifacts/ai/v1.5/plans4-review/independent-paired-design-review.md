# Independent review of the proposed paired validation

Reviewer: `/root/v15_acceptance_review`.
Scope: read-only review of `docs/ai-v1.5-paired-validation-proposal.md` and independent validation of the existing 192 development records. No confirmation was executed, no source or experiment script changed, and no candidate was approved.

## Judgment

The proposed paired endpoint is a fairer measurement of the requested **single-seat contribution with fixed teammates** than the original absolute win-rate endpoint. It is defensible as a new, explicitly authorized, preregistered experiment with fresh seeds. It is not an alternative calculation that makes confirmation-3 pass: that original FAIL remains final under its own rules.

The original experiment measured one candidate plus two stress-style teammates against three v1.4 opponents. Its absolute 45% gate jointly assessed candidate strength, teammate strength, and their interactions. Without a matched control it could not isolate the contribution of replacing one v1.4 seat. The original result is still valid for that team-composition question.

For the new question, each pair must have identical seed, lineup, hero arrangement, starting seat, team color, candidate-seat ID, opponents and both teammate policies. Only that one seat's policy differs. Normal subsequent random-path divergence caused by actions is part of the treatment effect; forcing future private cards to remain identical would change the real-engine experiment.

## Independently checked development evidence

`plans3-mixed-matched-development.jsonl` contains 192 complete records forming 96 exact pairs (48 per style). All pairs have matching public initial configurations and differ only in the designated policy seat. There is exactly one seed, 1501001.

| Style | Both win | Both lose | Candidate gains a win | Candidate loses a control win | Control / candidate wins | Paired mean difference |
|---|---:|---:|---:|---:|---:|---:|
| flow | 8 | 32 | 1 | 7 | 15 / 9 out of 48 | −12.50 pp |
| reserve | 2 | 36 | 3 | 7 | 9 / 5 out of 48 | −8.33 pp |

The control results show the original absolute hurdle was difficult even for the v1.4 seat in these development contexts. They do not establish that all style teams are universally weak. Candidate results are also lower here; the design defect cannot explain away those negative paired differences. Because there is only one independent seed cluster, this evidence cannot establish stable improvement or deterioration or support a seed-cluster confidence interval. Continue diagnosing concrete rules and reachable actions; do not use final wins/losses as proof that an individual action is correct.

## Counts, estimand, and statistical procedure

The proposed count is correct: 5,760 primary games + 3 × 960 historical-opponent games + 2 styles × 4,320 pairs × 2 arms = **25,920 games**. Each style has 30 seed clusters, each with 4 lineups × 6 starts × 2 colors × 3 designated seats = 144 pairs. Primary endpoints retain 120 clusters.

For each pair, compute candidate win indicator minus control win indicator. For each seed, average its 144 paired differences. The reported overall delta is the mean of all seed means (equivalent to the mean over all pairs because cluster sizes are equal). Bootstrap whole seed clusters, preserving every pair and its two arms together. Never independently resample the arms, individual games, or seats.

The proposed mixed hard gates are sensible for **noninferiority with a nonnegative observed effect**: observed delta ≥ 0 and one-sided lower bound ≥ −0.05. Passing does not demonstrate statistically significant superiority or a positive lower bound. Report both arms' absolute win rates and the paired delta regardless of pass/fail.

Using one-sided 99.3% intervals for all five primary and two mixed endpoints gives a Bonferroni union bound of 7 × 0.7% = 4.9%, nominal family coverage at least 95.1%, assuming each interval's advertised coverage. Percentile cluster bootstrap is approximate, especially in the 0.7% tail with only 30 mixed seed clusters; do not describe it as exact coverage. Correlation between endpoints sharing seeds does not invalidate Bonferroni.

All five primary score/lower-bound thresholds, three historical-opponent thresholds, and all legality/privacy/performance/completeness requirements can remain unchanged in value. Raising primary interval confidence from 99% to 99.3% makes their uncertainty criterion more stringent. The new paired endpoint replaces the old absolute mixed criterion for the newly defined experiment; it must be described transparently as a change in measurement, not as an unchanged acceptance protocol.

## Required clarifications before freeze

1. Resolve conflicting prose: proposal item 1 says primary bounds remain unchanged, while item 3 first states 99% then suggests 99.3%. The final protocol should unambiguously require **99.3% for all seven bounds**, 10,000 resamples, fixed RNG seed **1505001**, and the explicitly defined lower empirical quantile (for consistency with the prior zero-index convention, sorted index **70**).
2. Fix deterministic endpoint and seed ordering, the RNG recurrence, and whether one stream is consumed sequentially across endpoints. Otherwise the same data may produce slightly different Monte Carlo quantiles after row reordering. Do not choose ordering after observing results.
3. Freeze exact pair IDs and arm labels in the manifest, including candidate version, all six seat policies, seed, lineup, start and color. Require exactly two arms per planned pair, exact configuration equality except the selected policy seat, complete successful shard exits, recognized outcomes, and zero truncations. Failure or missing data in either arm invalidates acceptance, not just that pair.
4. Preserve the primary overall ≥50%, all lower-bound values, historical ≥45%, and performance gates explicitly in the final registration. Record total counts and new seed range 1540001–1540120 before any confirmation use. Retire those seeds if the new confirmation is used and then abandoned; no pooling with prior rounds.
5. Label the seven-endpoint coverage claim as applying to this fixed candidate/experiment. It is not a simultaneous 95% guarantee over an unlimited sequence of repaired candidates and new experiments. Preserve all failures and disclose the sequence; do not claim project-wide error control without an additional sequential design.

## Disposition

**Design direction accepted in principle; final frozen protocol and implementation still require verification.** No authorization to reinterpret plans-3 as passing, no confirmation outcome, and no release approval. Independent review should recheck the final manifest, paired routing, synthetic integrity checks and independently implemented paired bootstrap before publication of a new result.
