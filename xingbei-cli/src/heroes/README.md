# 英雄实现入口

当前18位已实现英雄均在本目录，每位英雄一个英文名称目录。

```text
heroes/
  berserker/
    index.js        # 英雄类、全部技能、英雄专属状态与规则效果
    ai.js           # 留牌、行动评分、技能响应与局面估计
  elementalist/
    index.js
    ai.js
    ai-*.js         # 较大的专属搜索/评分实现，仍留在英雄自己的目录
  shared/
    actions.js      # 多英雄共用的规则操作
    ai/             # 公共状态估计、分支计算与策略路由
```

修改某个英雄，从下表进入其规则或评分文件。`ai.js`保存实际英雄决策函数；复杂逻辑允许拆到同目录的`ai-*.js`，不在另一个按批次命名的目录里另存完整实现。

| 英雄 | 技能与规则 | AI评分 |
| --- | --- | --- |
| 狂战士 | [berserker/index.js](berserker/index.js) | [berserker/ai.js](berserker/ai.js) |
| 风之剑圣 | [wind-swordmaster/index.js](wind-swordmaster/index.js) | [wind-swordmaster/ai.js](wind-swordmaster/ai.js) |
| 神箭手 | [marksman/index.js](marksman/index.js) | [marksman/ai.js](marksman/ai.js) |
| 封印师 | [sealer/index.js](sealer/index.js) | [sealer/ai.js](sealer/ai.js) |
| 守护天使 | [guardian-angel/index.js](guardian-angel/index.js) | [guardian-angel/ai.js](guardian-angel/ai.js) |
| 神官 | [priest/index.js](priest/index.js) | [priest/ai.js](priest/ai.js) |
| 圣女 | [saint/index.js](saint/index.js) | [saint/ai.js](saint/ai.js) |
| 圣枪骑士 | [holy-lancer/index.js](holy-lancer/index.js) | [holy-lancer/ai.js](holy-lancer/ai.js) |
| 瘟疫法师 | [plague-mage/index.js](plague-mage/index.js) | [plague-mage/ai.js](plague-mage/ai.js) |
| 元素师 | [elementalist/index.js](elementalist/index.js) | [elementalist/ai.js](elementalist/ai.js) |
| 女武神 | [valkyrie/index.js](valkyrie/index.js) | [valkyrie/ai.js](valkyrie/ai.js) |
| 魔法少女 | [magical-girl/index.js](magical-girl/index.js) | [magical-girl/ai.js](magical-girl/ai.js) |
| 暗杀者 | [assassin/index.js](assassin/index.js) | [assassin/ai.js](assassin/ai.js) |
| 魔剑士 | [magic-swordsman/index.js](magic-swordsman/index.js) | [magic-swordsman/ai.js](magic-swordsman/ai.js) |
| 仲裁者 | [adjudicator/index.js](adjudicator/index.js) | [adjudicator/ai.js](adjudicator/ai.js) |
| 贤者 | [sage/index.js](sage/index.js) | [sage/ai.js](sage/ai.js) |
| 祈祷师 | [prayer/index.js](prayer/index.js) | [prayer/ai.js](prayer/ai.js) |
| 英灵人形 | [heroic-puppet/index.js](heroic-puppet/index.js) | [heroic-puppet/ai.js](heroic-puppet/ai.js) |

`../hero.js`只负责英雄注册、选角列表与阵容；`../hero-base.js`是共用英雄基类。规则文件不导入评分代码，AI只能估计候选结果，真实结算仍走规则引擎。

共享AI负责观测隔离、合法行动、通用伤害与分支计算，通过每个英雄的函数取得特殊行为；英雄特有的技能效果、留牌分数和资源用途跟随英雄目录。`shared/ai/base`承载原六英雄的公共策略，`wave-two`和`wave-three`是现有评分层的组合入口，目录名表示兼容层，不再存放六位英雄的集中技能实现。

`../ai/`保留生产版本选择、公开观测、通用执行器，以及带明确版本号的历史AI实验。历史版本用于旧对照和训练复现，其冻结代码不是新英雄开发入口；不要为了改当前英雄而顺带修改历史策略。当前策略通过`../ai/versions.js`组合这里的真实评分模块。

日常开发位置为`/home/xp/xingbei`的`main`。原`/home/xp/xingbei-heroes`工作树的已完成英雄已合入main，后续不需要另开英雄分支。

## 本次目录迁移验证（2026-10-24）

规则和评分参数保持不变，AI版本仍为1.8.0-preview.1。92项核心规则测试与2项生产/冻结策略检查通过；10局迁移前后对照包含522次行动、1899条决策及排序记录，各局记录和最终状态的SHA-256全部一致。三批英雄另做局面级精确对照，不将这些临时检查加入日常评分测试。

桌面1440×900与触屏390×844均实际加载18份英雄规则和18份AI入口，选角、进入对局成功，控制台及HTTP错误0。这是路径与运行检查，没有重新进行整套视觉还原验收。原始记录保存在本地`artifacts/heroes/layout-2026-10-24/`。
