# plans-4 限定估值复用独立等价审查

结论：**未发现排名、评分、解释、平分选择、搜索预算或轨迹变化。当前限定复用优化可继续原门槛下隔离性能实测。** 不代表性能已经过门。

参照为artifacts/ai/v1.5/plans4-before-reuse的完整5模块快照；当前为src/ai/v1.5-candidate。脚本将两组各自复制到不同/tmp目录，并把本地模块指向各自副本、所有外部相对import指向相同真实依赖。不是把旧index混接新planner。业务源码未修改。

## 独立结果

- 180份完整压力观察（18格）、原5例、30个定向状态，共215份排名。
- 定向状态包括契约1/2/3能量×1/2/4治疗×activationDone真假、多目标预留分配，以及六英雄各两个固定开局观察。
- 共4744候选：动作、精确浮点分数、排序、完整explanation（分项、主动作分项、路径、步骤、precision、search limit/used）严格deepStrictEqual。
- 1737个相邻同分候选对，原稳定选择顺序完全一致。
- 54个契约skillChoice/playerChoice/numberChoice请求：完整traceDecision严格一致，replayTrace结果一致。
- 每份输入观察前后哈希一致。
- 两组5模块与共享observation适配器共11文件，验证前后源码SHA256全部一致；完整指纹及每观察输出digest保存在reuse-equivalence.json。
- 0差异、0异常。

## 静态合理性

rank共享baseTotal只用于同一个不可修改根状态；契约选项Map也在每次rank新建，仅缓存三种预留组合。接受契约后clone再置activationDone，递归没有错误沿用原根baseTotal。bestAttack传给子planAttack的基线对应同一输入状态；付能量产生的不同状态仍分别估值。

angelBond保存bestTotal保留原严格大于比较，平分继续保留原选择。removeEffectOptions/waterPower先评分再稳定排序，评分函数无业务状态变更，保存原候选顺序。没有新增整状态对象身份全局memo，没有跳过搜索预算计数、扩大分支数量或修改SEARCH_LIMIT。

## 交付及范围

复现脚本：reuse-equivalence.mjs；机器结果：reuse-equivalence.json。本次只核查等价性，没有计时比赛或新增对战。此前失败性能证据保留；新优化是否满足中位/p95及绝对预算，以随后隔离实测为准。若验证后行为源码继续变化，不能沿用本报告覆盖新改动。
