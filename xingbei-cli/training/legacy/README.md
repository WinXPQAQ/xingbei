# 原项目评分适配陪练

`legacy-score-partial-v1` 是部分迁移的独立陪练，**不是完整旧引擎AI，也不是旧AI强度基准**。不能把它的胜率用于证实“旧版多数英雄比新版强”。原项目未修改；运行不依赖旧源码目录。

已迁移：

- `card/xingBei.js` 的基础攻击/法术行动顺序、目标倾向和重复牌基础留分。
- `noname/get/index.js` 的 `damageEffect` 通用手牌空位估值；英雄专属修正不在此次迁移内。
- `noname/library/index.js` 的购买、合成、提炼顺序及虚弱选择。旧随机倾向以均值近似，未复刻旧引擎完整调度；士气课程关闭不存在的第五杯收益。
- 从五个角色包按技能中文名核对、排除存在冲突数值的同名项，提取42位当前英雄、69项明确的数值型 `ai.order`。来源文件、旧技能键和源文件SHA-256保存在 `static-orders.json`。

未迁移：动态 `ai.order`、技能正文中的 `check/choose` 回调、英雄留牌修正、响应博弈及旧引擎效果估算。复杂技能和响应使用当前冻结评分AI；静态技能顺序可参与行动比较，但技能具体费用、目标仍用当前排序。若当前第一选择是未覆盖的英雄路线，保留该路线，不给未知技能随意赋低分。

每局输出 `legacyCoverage`：`originalBaseOrder`、`originalBaseRetention`、`originalBaseWeakness`、`staticHeroOrder/currentTargetRanking`、`currentFallback/*`。计数是实际策略调用，层级缓存使一次完整行动只记一次，不能当作每个网络子决策的覆盖比例。

全部命令仍通过当前引擎合法性约束；只读自己牌面与公开局势。它只能作为提供不同打法的陪练，不提供奖励或强制模仿标签。

再生成静态元数据（在 `xingbei-cli/` 执行）：

```bash
node tools/extract-legacy-ai.mjs ../xingbei-1.6.7-source training/legacy/static-orders.json
```

来源及许可：原项目 GPL-3.0，许可全文沿用仓库中的 `assets/LICENSE`。提取器只加载声明，不执行旧技能结算或修改原项目。
