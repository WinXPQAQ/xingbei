# 贤者人工对局与评价记录

用户授权上传的一局正常人机对局。北京时间2026年11月17日23时19分至23时32分，玩家控制红一贤者，最终红方获胜。对局ID为 `fa13235d3e1582bbcd19a5f6defb6f2b06ce2859de4c0e0b`。

使用共享全英雄模型 `team-m06-504.pt`，页面名称为“AI v7 · 504轮（推荐）”，输入格式为 `entities-v7`。检查点SHA-256为 `6e182bda47f21d190092289e2f288f60024deb8e6ef7c70fb51c2759a8c691d1`。规则版本、阵容、种子、控制席位和模型身份见 `metadata.json`。

## 文件

| 文件 | 内容 |
| --- | --- |
| `events.jsonl.gz` | 完整991条事件，按序号排列，每行保留原始事件包装及接收时间 |
| `metadata.json` | 对局身份、开局配置、规则版本与模型身份；归档移除记录认证校验字段 `tokenHash`、`requestHash` |
| `summary.json` | 对局完成状态及红方获胜结果 |
| `reviews.json` | 每个分析视图取最后保存版本后，提取出的48个有评价的候选，附原始事件序号 |
| `statistics.json` | 评价及事件数量统计 |
| `manifest.json` | 数据文件大小与SHA-256 |

共有268条分析保存事件，涉及78个视图。合并同一视图的重复保存后，有48个候选附有评价，包括22次“好”、25次“不好”、3次数值评分、14条文字说明。各类评价可以重叠，其中一个候选仅有文字说明。数值评分含0、5、10，0分是有效评分。

完整事件包含开局及后续状态、实际命令、决策、日志、AI选择、分析观测与候选概率。`reviews.json` 适合快速阅读；回溯具体手牌和结算时，应通过其 `sequence` 查阅完整事件。事件中的全局状态可用于复现，策略输入应使用当时合法的 `observation` 及其可见性约束。

## 读取

```python
import gzip
import json
from pathlib import Path

folder = Path("research/ai/2026-11-17-human-sage-review")
with gzip.open(folder / "events.jsonl.gz", "rt", encoding="utf-8") as stream:
    events = [json.loads(line) for line in stream]
reviews = json.loads((folder / "reviews.json").read_text(encoding="utf-8"))
by_sequence = {item["sequence"]: item for item in events}
example = by_sequence[reviews[0]["sequence"]]
```

## 解释与训练使用

- 用户明确要求把人工操作和意见作为可供学习的参考，允许后续模型依据实际结果修正取舍。
- 同一视图的编辑会产生多次保存，使用完整事件时按 `viewId` 取最新 `annotationRevision`。同一决策中重新展开的视图仍可能代表相同候选，训练时还需按决策与候选语义处理重复权重。
- 空白评价保留为空。查看或展开侧栏选项属于分析浏览，实际出牌由原生命令和决策选择记录确定。
- 候选概率是对应决策步骤内的策略分布。该局产生于贤者费用牌／目标侧栏接入修正之前，`intent` 层评价应按预备意图理解，不能直接转换成最终攻击或法典的执行概率。
- `candidateIndex`、手牌下标和牌ID均对应事件发生时的状态，需结合原始候选、观测引用和相邻状态恢复。
- 本次只归档资料，训练采样和权重更新需要后续任务明确接入。

归档校验确认序号0至990连续、终局事件与摘要一致，压缩解压后的991条事件逐条与本地原始记录相同。模型与配套来源为 `ai/team-training-20261117` 分支提交 `7054d58ffe49e7b0c144267d02da712a092376cb` 的研究快照，网页分析接入另有本地修改，具体运行身份以归档元数据为准。
