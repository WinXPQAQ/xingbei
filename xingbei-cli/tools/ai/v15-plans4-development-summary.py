"""Descriptive paired development results; no confirmatory interval from two seeds."""
import hashlib
import json
from pathlib import Path

root = Path("artifacts/ai/v1.5/plans4-final-development")
manifest = json.loads((root / "manifest.json").read_text())
for file, digest in manifest["hashes"].items():
    assert hashlib.sha256(Path(file).read_bytes()).hexdigest() == digest
exits = json.loads((root / "runner-exit.json").read_text())
assert sorted(x["shard"] for x in exits) == [0, 1, 2, 3]
assert all(x["code"] == 0 for x in exits)
rows = [json.loads(line) for file in [root / "reused.jsonl", *sorted(root.glob("games-*.jsonl"))]
        for line in file.read_text().splitlines()]
assert len(rows) == len(manifest["games"]) == 384
expected = {r["id"]: r for r in manifest["games"]}
for row in rows:
    m = expected.pop(row["id"])
    for key, value in m.items():
        assert row[key] == value
    for key, value in m["config"].items():
        assert row[key] == value
    assert row["outcome"] in ["win", "loss"]
    assert row["winner"] in ["red", "blue"]
    assert (row["outcome"] == "win") == (row["winner"] == row["team"])
    assert 0 <= row["turns"] <= 300
assert not expected
summary = {}
for style in ["flow", "reserve"]:
    selected = [r for r in rows if r["style"] == style]
    pairs = {}
    for row in selected:
        key = (row["seed"], row["lineup"], row["start"], row["team"], row["seat"])
        pairs.setdefault(key, {})[row["candidate"]] = row
    assert len(pairs) == 96
    changes = []
    for pair in pairs.values():
        assert set(pair) == {"v1.4", "experimental/plans-4"}
        old, new = pair["v1.4"], pair["experimental/plans-4"]
        changes.append(int(new["outcome"] == "win") - int(old["outcome"] == "win"))
    wins = {v: sum(r["outcome"] == "win" for r in selected if r["candidate"] == v)
            for v in ["v1.4", "experimental/plans-4"]}
    summary[style] = {"pairs": 96, "wins": wins, "delta": sum(changes) / 96,
                      "improved": changes.count(1), "worsened": changes.count(-1),
                      "bySeed": {seed: {v: sum(r["outcome"] == "win" for r in selected
                                               if r["candidate"] == v and r["seed"] == seed)
                                      for v in wins} for seed in [1501001, 1501002]}}
result = {"records": len(rows), "newGames": 288, "reusedControls": 96, "summary": summary,
          "scope": "Two development seeds; descriptive paired diagnostics only. No release or inferential pass."}
(root / "summary.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
