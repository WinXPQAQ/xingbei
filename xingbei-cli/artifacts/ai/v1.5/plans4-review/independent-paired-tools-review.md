# Independent review of paired confirmation tools

Scope: `v15-paired-confirm.mjs`, `v15-run-paired-confirmation.mjs`, `v15-paired-analyze.mjs`. No actual confirmation or games were run. The parent explicitly authorized fixing only analyzer integrity after the initial finding; candidate/business code is unchanged.

## Result

The reviewed tools now implement the registered paired design and statistical gates. One material evidence-integrity omission was found and fixed before freeze. This is a tool review, not acceptance of any candidate or confirmation result.

The generator produces 25,920 games: 5,760 primary, three 960-game historical endpoints, and two 8,640-game mixed endpoints. Each mixed endpoint contains 4,320 pairs; its two arms differ only at the designated candidate seat, using plans-4 versus v1.4. The other two teammate policies and three opponent policies remain identical. The runner routes both arms through the same real-engine evaluator and retains errors through unsuccessful worker exits rather than replacing or filtering games.

The analyzer computes seven intervals in the registered order, with seed-sorted clusters and one continuous LCG stream initialized to 1505001. Each interval uses 10,000 resamples and zero-based sorted index 70. Mixed observations are paired score differences averaged within each seed, with 30 equal clusters of 144 pairs. All five primary lower-bound gates, overall primary score, three historical scores, both mixed mean/lower-bound gates and zero-truncation requirement are combined conjunctively. Any missing, duplicate, mismatched, unrecognized or unsuccessful-completion evidence is rejected.

## Finding and authorized fix

Initially the analyzer checked rows against the supplied manifest but did not fully verify the manifest's factorial design. Full-size synthetic data showed that it accepted (a) a repeated primary start/color cell replacing another cell and (b) a historical endpoint shifted to the wrong seed range, when the manifest and rows shared the error. This would allow a bad manifest to authenticate itself.

The analyzer now independently specifies the four exact rosters, all seed ranges, six starts, colors, arms, opponent, designated seats and pair IDs, reconstructs all 25,920 required records, and deep-compares the entire manifest before examining results. This reconstruction does not call/import the manifest generator. It also verifies hero remapping and every seat policy. No candidate code changed.

## Independent synthetic checks

Each fixture contains the full planned synthetic matrix; no real engine simulation was invoked. After the fix, the valid fixture passed and all twelve malformed/failing fixtures were rejected:

- Wrong hero, opponent or pair ID in the manifest and data.
- Negative mixed delta.
- Repeated primary factorial cell or wrong historical seed range.
- Missing or duplicate result row.
- Wrong arm or teammate policy.
- Truncation or null winner labeled as a loss.

A second, nonconstant full-size synthetic fixture was evaluated with a separate Python implementation of all seven seed-cluster intervals. Every bound matched the JavaScript analyzer within 1e-12. This exercises the actual resampling order and paired metric, rather than only testing constant outcomes. The independently calculated bounds are retained in `independent-paired-bootstrap-check-results.json`.

## Retained evidence and limits

Scripts: `independent-paired-tool-check.py`, `independent-paired-bootstrap-check.py`. Results: `independent-paired-tool-before-results.json`, `independent-paired-tool-check-results.json`, `independent-paired-bootstrap-check-results.json`. The scripts use temporary synthetic directories and never write real confirmation files.

Before actual confirmation, the final manifest and source hashes must still be independently checked against the new frozen Git commit, and all nonstatistical pre-freeze gates must pass. After confirmation, independently recompute the actual complete records and performance. The old confirmation-3 FAIL remains unchanged. Nominal bootstrap coverage and the paired measurement's scope remain as documented in the protocol; these synthetic tests do not establish gameplay strength or exact finite-sample statistical coverage.
