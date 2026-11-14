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


实体接口当前为 `entities-v6`，使用 `hierarchical-v1` 按需生成行动方向、牌、费用和目标。选择启动后，模型依据真实结果重新选择普通行动。采集与训练worker共用实体编码器，奖励使用终局团队胜负。v6需要新数据、词表和检查点，加载时核对schema。结构化表示见 [观测规范](../docs/ai-observation-schema.md)。

2026-11-09的采集与训练改动待统一验证。`collect.mjs` 和 `collect-all.mjs` 均使用当前规则教师与71英雄轮换。每局每座位按类型、阶段、技能和用途分层保留样本，并保留一条预算内的完整内部选择链。以下环境变量控制两种入口的采样预算。

| 环境变量 | 默认值 | 含义 |
| --- | --- | --- |
| `XINGBEI_TEACHER_SAMPLES_PER_SEAT` | 12 | 每座位最多保留的分层样本数 |
| `XINGBEI_TEACHER_CHAIN_STEPS` | 12 | 每座位保留的一条完整选择链最多步数 |
| `XINGBEI_TEACHER_BYTES_PER_GAME` | 6291456 | 每局保留样本JSON字节预算，平均分给六席，再分给分层样本和选择链 |

选择链覆盖同一个引擎请求内的分层选项，跨真实技能结算的多个请求分别记录。超预算的链整体退出完整链采样，其步骤仍可被分层采样选中。`coverage.json` 记录各英雄各层实际遇到与保留数量，小时报告展示样本和完整链总数。更改采样配置后使用新采集目录；同schema且缺少采样元数据的既有数据仍可由预训练入口读取。

`node training/entity/collect-all.mjs DIRECTORY 2400 --workers 16` 使用有界工作线程并行采集，默认16个，可通过 `--workers` 调整。每局使用独立种子、编码器和采样器，并原子保存到 `games/INDEX.json`。相同目录续采先核对规则版本、教师、schema、种子、阵容和采样配置，再补齐缺少的对局。父线程汇总覆盖与进度，最终按对局序号输出 `teacher.jsonl` 和 `positions.jsonl`，与线程完成顺序无关。任一规则或接口异常立即终止本次全部采集线程，保留 `rule-failures/` 现场及已完整保存的对局，等待排查后再手动续采。

`run-all.py`支持`--workers`、`--batch`、`--bootstrap-steps`和`--round-games`，将实际配置写入状态文件，同一运行目录恢复时核对配置。默认仍为16个模拟进程、批量32、12000步预训练、每轮192局。2026-11-09释放显存后的离线基准支持下一次实验采用批量64，实际运行参数以manifest和status为准。

实体采样与教师数据读取优先使用`orjson`，缺少该可选加速库时使用标准JSON。专用GPU环境已安装的3.13.0版本记录于`requirements-gpu.txt`。输入来自Node产生的有限数字与安全整数。稀疏打包使用批量列表追加，推理结果统一回传CPU；`collate_infer_seconds`记录包含传输完成的联合耗时，`collate_seconds`为主机打包与入队时间。

所有模拟入口都会保留异常和无法行动判负档案。`XINGBEI_DIAGNOSTIC_DIR`可指定目录，省略时写到用户目录下的`.local/share/xingbei-ml/rule-failures/`。建候选失败时也记录当前问题，避免沿用上一次技能询问。

`train.py` 按整局种子分训练与验证，逐局读取，在临时二进制缓存保存打包样本，按批次加载。临时缓存需要磁盘空间，默认位置由Python临时目录配置决定。预训练报告增加按英雄、技能、阶段的准确率计数和价值误差。`reinforce.py` 新训练默认采用当前教师与71英雄轮换，恢复训练沿用检查点中的陪练配置。更新报告记录各决策类型及阶段/技能的样本占比、损失、熵、近似KL和裁剪比例。

`reinforce.py --target-kl VALUE` 可显式启用本轮更新停止阈值，默认关闭。指标为更新前小批样本的KL估计。阈值写入恢复配置，续训沿用同一值。主模型与历史陪练在明确指定规则版本时核对已登记版本。小时报告分别显示最新检查点和最近实际评测检查点。

实体CPU推理入口为 `entity/serve.py`，网页使用与训练共用的分层决策执行器及实体编码器。选定v6检查点后，可以在两个终端分别执行以下命令。示例使用4185推理端口和4184网页端口，实际使用时选择空闲端口。

```bash
python training/entity/serve.py --checkpoint /path/to/entity-v6.pt --port 4185 --label '实体AI实验版'
TEST_MODE=1 MODEL_PORT=4185 PORT=4184 HOST=0.0.0.0 node server.js
```

网页从推理服务health读取模型名称、schema和检查点哈希，每次选择核对身份。推理服务只监听127.0.0.1，由网页服务代理请求。每局使用独立会话，默认最多128个会话，闲置2小时过期。请求上限8MiB、4096个实体和20000个候选。服务端仅执行策略网络，网页显示和规则结算由共用游戏引擎完成。

此接入与根请求缓存均已写入源码，待统一验证。根请求缓存仅覆盖规则尚未提交的子步骤，真实引擎询问新建作用域。小时报告区分全座位新引擎请求与网络内部子决策吞吐。

全72英雄连续训练入口为 `entity/run-all.py`；配置、残局重放、小时报告和停止方式见 [全英雄训练协议](../docs/ai-all-heroes-training.md)。旧 `watch.py` 和固定阵容脚本保留用于旧实验复现，正式新任务不使用旧18英雄运行目录。

启动供给声明 `activationEnablesAction` 表示当前技能存在可能获得后续行动条件的路线（例如摸牌、获得能量或变身）。它不证明所有摸牌数、弃牌、盖牌、治疗抵挡等子选择都安全；未知组合仍保存完整现场并按规则异常停训，不能自动吞掉错误或随意判负。v4 本批只做小批采集与兼容性验证，正式长训保持暂停。


### 残局存储

连续训练的`--positions corpus/positions.jsonl`入口首次自动导入同目录`positions.sqlite3`。后续只扫描轻量元数据，并按需读取选中的重放序列，完成轮次后事务增量合并。SQLite文件承载最新残局，备份和迁移应读取该文件。JSONL保留最初导入内容。抽样种子、来源去重、来源隔离及每类10000条上限沿用既有规则。


### 实体增量传输

Node模拟器与Python采样池默认使用`sparse-delta-v1`。同一引擎请求内的静态实体前缀仅首次发送，接收端按模型与座位验证前缀引用并展开为`sparse-v1`。模型及保存的轨迹仍使用原有完整观测。`run_games(..., delta=False)`可运行完整稀疏传输对照，`sparse=False`使用原始观测。网页接口沿用完整观测格式。


### 二进制张量传输

连续训练与小时评测通过`run_games(..., binary=True)`启用`tensor-v1`。JSON行头给出二进制体长度，接收方读取完整帧并校验词表、维度、索引和数值后得到CPU张量。该模式发送完整数字特征，并直接供采样推理及PPO缓存复用。轨迹中的观测含Tensor，训练报告仍只保存既有非轨迹结果。需要JSON序列化轨迹的调用方可沿用默认增量JSON模式，网页接口继续使用原格式。

### 学习方法对照与容量实验

`entity/compare-methods.py`从一个终局回报MC基线比较共用更新、独立更新、GAE、GAE加士气势函数。默认每组两个采样种子、10轮、每轮192局，使用50%残局课程。历史对手固定，残局通过SQLite备份冻结，各组按轮交错执行。首次执行会复制`src/`、`training/`和`package.json`到实验目录的独立源码快照，子进程始终从该快照运行。评测使用现有全英雄换边协议，报告为开发结果。

在已安装PyTorch的Python环境中，先生成配置即可核对工作量。

```bash
python training/entity/compare-methods.py /path/to/baseline.pt /path/to/comparison \
  --revision RULE_REVISION --positions /path/to/corpus/positions.jsonl \
  --history /path/to/frozen-history.pt --prepare-only
```

去掉`--prepare-only`执行。相同命令再次执行会跳过完整检查点及完整评测。规则错误终止整组并保存失败命令及现场；全局控制文件处于`awaiting_rule_decision`时，进入等待状态，恢复裁定后可以再次执行。默认控制文件为`~/.local/share/xingbei-ml/training-control.json`。新的规则版本应使用对应迁移模型和已验证的残局来源。

单组实验使用`entity/reinforce.py --experiment NAME`显式改变学习配置。支持`--independent-updates`、`--learning-signal mc|gae`、`--trace-lambda`、`--morale-weight`、`--curriculum scheduled|endgame`、`--actor-lr`、`--critic-lr`、`--entropy-weight`及`--opponent-temperature`。默认士气权重0，冻结陪练温度0。显式实验种子重新初始化采样随机流，之后恢复沿用保存的随机状态。

`entity/train.py --width 256 --layers 4 --teacher-checkpoint /path/to/current.pt`可在同一词表下蒸馏扩大策略网络，价值目标仍用真实终局结果。新实体预训练默认独立更新两套网络。旧检查点恢复核对原配置；更改网络尺寸应新建模型。容量和学习信号的测量记录见全英雄训练文档末节。

### 价值网络校准训练

终局MC实验可使用`--independent-updates --critic-mode grouped --critic-loss bce --critic-updates 32`。从旧RL检查点切换时同时提供`--experiment NAME`。该模式按来源种子稳定划分20%价值留出，均衡抽取来源／座位／根请求，限制critic更新预算并回滚至最佳验证权重及优化器。PPO策略更新仍使用完整轨迹，独立优化。

BCE要求终局±1、无势函数塑形且模型value_scale=1。GAE或塑形的有界价值拟合使用`--critic-loss mse`。旧检查点默认legacy，恢复不会静默更改算法。小时报告显示尝试更新次数、采用的更新点和留出Brier／NLL／ECE；强度仍以独立对局评测为准。详细对照见`docs/ai-all-heroes-training.md`的价值过度自信修复记录。
