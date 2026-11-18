# 贤者 v2 与行为保持检查点 · 2026-11-18

本次交付模型为 `results/team-v2-retain-089.pt`，来自 `team-v2-retain-20261118` 第 89 轮，使用 `entities-v7` 观测和 `hierarchical-v2` 决策接口。SHA-256 为 `cb205e2b226d9185a5e1fe2139881e05a23300118af52d5c929e8b02ced742a1`。

- 人工复盘回归为 23 个好／差动作配对中的 14 个排序正确，即 60.9%。重新运行 `review-test.py` 得到 0.609。该指标使用归档对局中已有的观测与候选，属于固定局面的排序回归。
- 第 89 轮标准规则全队评测 179/288，冻结整队对照 131/288。第 1、45 轮分别为 182、164 胜。评测使用开发种子 940000000，每个种子包含座位轮换。
- 行为保持目标来自 `sage-merged-v1` 对贤者非行动决策的概率分布，训练权重 1.0。全队 PPO 使用士气风格权重 0.6，分支搜索目标和残局课程均关闭。
- 模型与评测证据见 `results/team-v2-retain-089-evidence.json`。复盘输入从已有提交 f087dfe 原样恢复到 `../2026-11-17-human-sage-review/`。
- 本次编码器对应新增手牌形状、公开缺系特征之前的版本。后续特征训练另行记录。
- 本批完成代码与模型归档推送；网页部署验收尚待进行。

## v2 入口

`training/decision-space.mjs` 增加 `hierarchical-v2`。有启动时点订阅时先结算启动，再选普通行动；其他情况直接选择普通或特殊行动。等价牌按当前规则相关属性合并。无可选行动的判负与存档由研究训练 driver 处理。

训练入口显式传入 `--decision-mode hierarchical-v2`。独立全队评测 `training/entity/eval-team.py` 同样支持该参数。推理服务 `training/entity/serve.py` 从检查点 `transfer.decision_mode` 读取模式，旧检查点默认 v1。网页调用端仍需支持 v2 决策接口。

在本目录下复查人工评价（Python 环境需有 PyTorch）：

```bash
python source/training/entity/review-test.py   ../2026-11-17-human-sage-review/events.jsonl.gz   ../2026-11-17-human-sage-review/reviews.json   --models retain89=results/team-v2-retain-089.pt
```

单独启动该模型的推理服务：

```bash
python source/training/entity/serve.py   --checkpoint results/team-v2-retain-089.pt --port 4185 --label '贤者 v2 · retain89'
```

## 本批检查

- 主项目现有核心规则测试 148 项通过。
- 在隔离工作区中，归档源码训练适配器和实体接口测试 14 项通过。
- v2 跨阵容 30 局通过（15 局规则 AI、15 局随机合法选择），共 9,326 个决策，无异常、无法行动判负或截断。
- 模型下载后按远端 SHA-256 校验。
- 推理服务校验 v1、v2 检查点的模式识别，并执行现有服务请求回归。

---

# 贤者与全队训练 · 2026-11-14～17

## 待盲测的 AI

**首选：`results/team-m06-504.pt`**（SHA-256 `6e182bda47f21d190092289e2f288f60024deb8e6ef7c70fb51c2759a8c691d1`）

对照用当前线上模型 `online-v6-417`（`../2026-11-14/models/online-v6-417.pt`）。

| 文件 | 说明 | 留出种子 576 局胜场（冻结整队 250） |
|---|---|---|
| `team-m06-504.pt` | 全队训练，士气风格奖励 0.6，第 504 轮 | **387**（+23.8%，区间 +18.7%～+28.6%） |
| `team-m03-198.pt` | 全队训练，士气风格奖励 0.3，第 198 轮 | 381（+22.7%） |
| `team-cup-295.pt` | 全队训练，只看胜负，第 295 轮 | 367（+20.3%） |
| `sage-merged-v1.pt` | 全队训练的起点（476 + 宝石专项合并） | 314（+11.1%） |

留出种子从 960000000 起，没有参与任何挑选，结果见 `results/eval-team-960.json`。

全队训练出的是一个通用网络，三个席位共用，不限于贤者，所以盲测时任何英雄都能用它。

### 部署方法（尚未在网页上验证）

- 这些模型的输入格式是 `entities-v7`，推理服务和编码器需要用本目录 `source/` 里的版本。主仓库 `xingbei-cli` 的网页还是旧版残差模型的接法，不能直接加载。
- 线上 417 的部署目录在 4090 服务器 `/home/xp/.local/share/xingbei-ml/preview/releases/v6-417-human-20261110/xingbei-cli`。做法：复制这个目录，用本目录的 `source/src`、`source/training`、`source/package.json` 覆盖，然后启动：

```bash
python training/entity/serve.py --checkpoint /path/to/team-m06-504.pt --port 4185 --label 'B'
TEST_MODE=1 MODEL_PORT=4185 PORT=4184 HOST=0.0.0.0 node server.js
```

- 盲测时 `--label` 用中性名称（A/B），由别人或脚本随机决定哪个端口放哪个模型，并记下对应关系。

## 主要结论

- **合并网络（单网络）：** 持宝石时学 `sage-drill-480`，其余保持 476。普通对局 2304 局配对，比 476 高 +2.0%，魔道法典使用多 4 倍。
- **全队训练（`specialists.py --team`）：** 贤者两个队友也由学习网络打并一起更新，比只训练贤者有效得多，见上表。
- **士气风格奖励**（`--style morale`）让士气胜和法典使用略多，但胜场与纯胜负训练的差距仍在噪声内；队伍仍约 70% 靠合杯获胜。
- **只计士气的规则**（`--rule-variant morale-only-v1`）会坍塌：训练局胜率降到 0%，策略变成反复提炼、不打。
- **回合内分支目标**（5 个版本）：目标准确（留出收益 +1.2），但只覆盖单回合选择，学不出"提炼 → 下回合放法典"，整局胜率没有提升。
- **决策时搜索：** 开发种子上有提升（82/144、88/144），新种子 72 局没有复现（40 对比网络单独 43）。
- **手牌推断模型：** 比均匀发牌好 1.6%，接进搜索后没有提升。
- **人类对局打分：** 183 个局面里只有 9 个差异显著。原因是续局里人类座位由 AI 接手，执行不了人类的跨回合计划。

## 代码改动（`source/`，基于 `../2026-11-14/source/retained-skills`）

- **规则修复：** `src/heroes/heretic/index.js` 中，审判收集的弃牌列表里同一张牌可能出现两次，预言盖牌前先去重。
- **性能补丁：** 应用了 `simulator.patch`（见 codex 分支 `codex/simulator-rollout-perf`），在全队训练中提速约 4%。
- `training/driver.mjs`
  - 新增参数：强制前缀 `forced`、续局重洗 `continuationSeed`、隐藏信息重抽 `resample`（可带推断权重），以及从快照开局的 `startState`。
  - 公开手牌记忆由另一会话加入。
- `training/worker.mjs`
  - 分支控制、推断标签。
  - `gemPolicy`：持宝石时改由另一个网络决策。
  - 搜索续局遇到规则异常只作废该局，不中断整批。
- `training/entity/specialists.py`
  - 全队训练 `--team`；风格奖励 `--style`/`--style-weight`（新增 `morale` 风格）；训练规则 `--rule-variant`。
  - 分支目标 `--branch-*`、自动回滚 `--rollback-margin`、评测种子 `--eval-seed`。
- 工具脚本：

| 脚本 | 用途 |
|---|---|
| `branching.py`、`branch.mjs`、`branch-diagnose.py` | 回合内分支目标 |
| `search-eval.py` | 决策时搜索评测 |
| `belief.py`、`belief.mjs` | 手牌推断模型 |
| `merge-gem.py` | 合并两个网络 |
| `mix-diagnose.py`、`compare-plain.py` | 普通对局对照 |
| `teammates.py` | 队友行为分析 |
| `eval-team.py` | 全队候选评测 |
| `snapshot.mjs`、`human-positions.mjs`、`human-search.py` | 人类对局局面与打分 |

## 复现

在 `source/` 下按原专项训练的方式准备运行目录（`manifest.json` 写明冻结陪练和初始检查点），然后：

```bash
python training/entity/specialists.py RUN --heroes sage --team --style morale --style-weight 0.6 \
  --workers 18 --games 192 --eval-games 288 --eval-seed 940000000
python training/entity/eval-team.py --candidates a=RUN/sage/round-000504.pt \
  --frozen-current frozen-current.pt --frozen-417 frozen-417.pt --games 576 --eval-seed 960000000 --output eval.json
```

`frozen-417.pt` 由 `migrate_capabilities.py` 从 `online-v6-417.pt` 迁移到 v7 生成。
