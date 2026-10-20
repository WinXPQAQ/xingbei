# Independent review of final plans-4 limited development pairs

The 384-record development set is internally consistent: 192 exact pairs, 96 per style; two development seeds (1501001, 1501002), four rosters, starts 0 and 3, both colors, and all three designated candidate seats. Independent validation found no missing/duplicate pair or ID, configuration mismatch, illegal outcome enum, inconsistent winner, noninteger/out-of-range turn, or truncation. Four worker exit records are successful. All five recorded source hashes match current candidate/observation files.

Exactly 96 v1.4 controls were reused from `plans3-mixed-matched-development.jsonl`, exclusively from seed 1501001. Every original field, including outcome, initial configuration, seat policies and metrics, matches the source record exactly; no new candidate record is reused. Remaining 288 records are new. Within each pair, all initial configurations and other five policies agree; only the designated seat changes from v1.4 to plans-4.

Source comparison with frozen plans-3 found no changes to the engine, evaluation loop, v1.4 policy directory or style-policy/v1.3 directory. The shared observation change exposes extra activation fields only with an opt-in flag defaulting to false; both v1.4 and style policies retain default isolation. This supports using the unchanged historical controls for this descriptive development comparison. The reused records themselves did not carry per-execution source hashes, so byte-identical record provenance and source compatibility should not be described as a fresh rerun or full execution attestation. The independent confirmation must run both arms anew.

| Style | Candidate / control wins | Improved / worsened pairs | Mean delta | Seed 1501001 candidate/control | Seed 1501002 candidate/control |
|---|---:|---:|---:|---:|---:|
| flow | 29 / 25 of 96 | 15 / 11 | +4.17 pp | 13 / 15 | 16 / 10 |
| reserve | 15 / 17 of 96 | 10 / 12 | −2.08 pp | 6 / 9 | 9 / 8 |

**Limited judgment:** these results do not establish a clear, consistent single-seat degradation that independently blocks proceeding to a frozen confirmation. Each style's direction differs between the two seeds, and discordant pair counts are close. In particular, reserve's negative observed mean remains an unresolved diagnostic risk; it is not a noninferiority pass. Two independent seed clusters cannot support a reliable cluster confidence interval or an assertion that regression has been ruled out. No p-value, confirmatory interval, tuning recommendation, or acceptance result is inferred from this set.

Proceeding to the predeclared fresh-seed paired experiment is defensible only after all other pre-freeze gates pass. Do not change weights to chase these small differences, reduce the registered thresholds, select favorable seeds, or merge these development records into confirmation. Any concrete rule/action-chain defect remains a blocker independently of these aggregate results. The old confirmation-3 FAIL stays unchanged.

Independent calculation and integrity results are in `independent-development-review.json`; implementation is retained as `independent-development-audit.py`. This review ran no matches and changed no source.
