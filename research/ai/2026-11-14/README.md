# 星杯AI交接包 · 2026-11-14

本目录提供可加载的关键模型、训练历史、完整评测结果和对应代码，供其他开发者或agent接手分析。模型清单以本次采集时间为准，持续训练的新检查点会在后续归档更新。

本批包含12个关键模型、57组实验配置与5,951条训练轮次记录。12个模型均通过CPU加载检查，共完成34次合法候选推理。

## 先看这些文件

- [模型清单](models/manifest.json) 给出每个模型的用途、原始来源、大小和SHA-256。
- [实验与训练配置](records/runs.json) 保存各阶段的配置、最新状态与开发最佳记录。
- [逐轮训练指标](records/training-rounds.jsonl.gz) 保存已发现检查点的训练报告，保留轮次、胜率、学习指标、吞吐等汇总字段。逐步轨迹、逐局训练数据和按手牌组合展开的大表保存在本机完整归档。
- [完整评测](evaluations/) 包括贤者专项、整局、退化诊断与迁移修复实验，以及魔弓对照。评测文件保留逐局结果和种子。
- [人工对局摘要](records/human-games-summary.json) 与 [完整人工对局](records/human-games.tar.zst) 包含32场记录，其中20场有完整终局。
- [规则异常索引](records/rule-failures-index.json) 对应 [异常现场](records/rule-failures.tar.gz)，可按原路径追溯。
- [代码快照索引](source/manifest.json) 对应模型实际使用的规则、观测、候选动作、网络及训练实现。

## 关键模型

| 模型 | 用途 | 对应源码 |
| --- | --- | --- |
| online-v6-417 | 当前线上417轮模型 | source/online-417 |
| frozen-current | 专项训练使用的冻结整局陪练 | source/action-boundary |
| sage-drill-480 | 贤者反弹、整回合输出与续航专项开发最佳 | source/drill-480 |
| sage-full-285 | 贤者历史整局开发最佳，85/144胜 | source/full-game-guard |
| sage-full-451 | 贤者能力退化诊断对照 | source/full-game-guard |
| sage-full-458 | 行动边界修复后贤者开发最佳 | source/action-boundary |
| sage-full-476 | 贤者当前暂停检查点 | source/action-boundary |
| sage-retained-017 | 主线程新启动的能力保留训练，第17轮完整检查点 | source/retained-skills |
| sage-repaired-003 | 主线程的迁移修复实验候选 | source/current |
| magic-archer-617 | 魔弓历史开发最佳 | source/full-game-guard |
| magic-archer-944 | 行动边界修复后魔弓开发最佳 | source/action-boundary |
| magic-archer-995 | 采集时魔弓最新完整检查点 | source/action-boundary |

这些`.pt`文件按原样保存，包含策略、独立价值网络、词表、网络配置，以及检查点本身已有的优化器和随机状态。具体字段可通过检查脚本查看。各阶段的“最佳”来自反复使用的开发评测，报告中保留其规则版本、样本规模和对照条件。

## 加载和验证

本机验证使用Python 3.14和PyTorch 2.14.1。完整已安装版本见[环境清单](records/python-requirements.txt)。推理检查使用CPU。

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install torch==2.14.1 numpy
python research/ai/2026-11-14/inspect_models.py --smoke
```

仅检查一个模型可添加`--model sage-drill-480`。脚本先验证SHA-256，再加载模型，并对归档的合法观测执行推理。417轮模型使用`entities-v6`实现，其余模型使用`entities-v7`实现。对应观测示例在[examples](examples/)。

查看训练记录可运行以下代码。

```python
import gzip
import json

with gzip.open('research/ai/2026-11-14/records/training-rounds.jsonl.gz', 'rt') as stream:
    for line in stream:
        record = json.loads(line)
        if record['run'].startswith('sage-full'):
            print(record['run'], record.get('round'), record.get('summary'))
```

`source/`中的各快照保留相同的`src/`与`training/`相对目录，训练入口、批量模拟器及候选编码可据此追踪。实验配置内的原服务器绝对路径用于溯源，在其他机器恢复训练时需映射到本目录中的模型和源码。专项模型的伤害与续航目标、整局模型的终局胜负目标分别记录在各实验配置中。

## 验证与归档范围

[加载验证记录](records/model-load-checks.jsonl) 保存全部关键模型的SHA-256、网络规模、词表大小和实际CPU推理结果。代码功能验收状态沿用原实验报告。本目录中的源码快照与发布工程分开保存。

完整本地数据另有[全量归档Release](https://github.com/WinXPQAQ/xingbei/releases/tag/archive-20261114)。按用户最新要求，大体积全量上传已暂停，该Release目前只有部分数据分包。接手工作优先使用本目录。
