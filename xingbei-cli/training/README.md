# 训练入口

新训练使用 `entity/` 的结构化实体管线；本目录原有哈希/残差训练脚本保留用于历史实验和检查点复现，不混用schema。规则引擎仍是共用JavaScript实现，训练与批量推理使用Python/PyTorch。

在 `xingbei-cli` 目录执行，`python` 指已安装PyTorch的环境。输出路径须不存在：

```bash
node training/entity/collect.mjs /tmp/decisions.jsonl 24 211102500
python training/entity/train.py /tmp/decisions.jsonl /tmp/entity.pt --steps 200 --device cuda
python training/entity/reinforce.py /tmp/entity.pt /tmp/round1.pt --games 6 --epochs 1 --device cuda
python training/entity/reinforce.py /tmp/round1.pt /tmp/round2.pt --device cuda
python training/entity/play.py /tmp/round2.pt --device cpu
```

上面的步数用于跑通流程，不代表强度达标。监督学习只作起点，强化学习只用终局团队±1；没有中间局面奖励。`reinforce.py` 默认逐轮交替规则AI与自对弈；每个已完成轮次保存优化器、随机状态、轮次与配置。再次以该检查点为输入即恢复。`train.py --resume` 用于监督阶段恢复，两阶段的优化器恢复元数据不能混用。

- [统一观测与动作规范](../docs/ai-observation-schema.md)
- [英雄机制审查](../docs/ai-hero-mechanism-review.md)
- [实施、验证与性能边界](../docs/ai-entity-migration.md)

必要接口检查为 `node --test training/entity/check.test.mjs`。性能工具 `entity/benchmark.py` 检查同信息传输等价和分项耗时，`entity/pool.py --profile` 测完整多进程推理。无需为了训练工具改动运行历史全部AI策略实验或浏览器截图。

当前服务器PyTorch解释器为 `/home/xp/.local/share/xingbei-ml/venv-gpu/bin/python`；数据与实验检查点位于 `/home/xp/.local/share/xingbei-ml/entity-comparison/`，不随代码提交。训练入口不会更新线上服务模型。


实体接口当前为 `entities-v3`。超过128个候选的行动按需进行条件分步选择，其余问题保持原样；采集、推理、终局奖励训练共用适配器。v2数据/模型不直接兼容，需重新采集训练。具体约定见 [观测规范](../docs/ai-observation-schema.md#按需分步行动entities-v3)。

全72英雄连续训练入口为 `entity/run-all.py`；配置、残局重放、小时报告和停止方式见 [全英雄训练协议](../docs/ai-all-heroes-training.md)。旧 `watch.py` 和固定阵容脚本保留用于旧实验复现，正式新任务不使用旧18英雄运行目录。
