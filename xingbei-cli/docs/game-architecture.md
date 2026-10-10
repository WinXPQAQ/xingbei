# 游戏规则结构（v0.2.0）

默认六人3v3，座次红蓝蓝红红蓝，玩家控制0号红一。代码使用英文标识，玩家可见文字保持中文。所有模块为原生ES Modules，规则层没有DOM或终端依赖。

## 职责与入口

| 文件 | 职责 |
| --- | --- |
| `src/engine.js` | `Game`：登记所有牌、区域转移、效果/技能注册、公共操作与胜负；协调决策与结算 |
| `src/card.js` | 牌继承层级、原属性/有效属性查询、合法目标、应战条件与自身结算入口 |
| `src/cards.js`、`src/card-labels.js` | 150张基础牌配置、生成牌堆与排序；独立显示名模块避免牌和结算模块循环导入 |
| `src/player.js` | `Player`：手牌、状态区、能量、治疗、所属英雄；查询效果与汇总技能 |
| `src/hero.js` | `Hero`基类：英雄固定信息、技能清单、每个实例独立的`state` |
| `src/effects.js` | 效果规则定义；每个实例仍由一张实际牌承载，不创建附加状态类 |
| `src/turn.js`、`src/timing.js` | 回合状态与明确的触发时点 |
| `src/resolution/attack.js` | 攻击与连续应战流程 |
| `src/resolution/magic.js` | 魔弹伤害、参与记录、目标与连续响应流程 |
| `src/resolution/decisions.js` | 同步/异步驱动同一套规则迭代器 |
| `src/ai.js` | 行动和响应决策，不复制规则 |
| `legacy-assets.json` | 英文资源URL到原版实际素材文件名的映射 |

`web/app.js`和`src/cli.js`调用共用引擎，提供选择与确认。浏览器`Session`负责取消旧局等待；它不是规则状态。

## 牌与位置

```text
Card
├── BasicCard
│   ├── AttackCard
│   └── SpellCard
│       ├── PoisonCard
│       ├── ShieldCard
│       ├── WeaknessCard
│       ├── MagicBulletCard
│       └── HolyLightCard
└── ExclusiveCard
```

`category`为`basic`或`exclusive`；基础牌的`type`为`attack`或`spell`，具体牌种使用英文`name`。六种攻击牌共用`AttackCard`，暗灭规则由`darkStrike`区分。专属牌基类默认不能主动使用；具体专属牌实现自己的类型、合法目标和结算。

牌的`id`不可更改，印刷属性集合不可改写。位置读取为`card.location`，所有区域操作必须经过`Game`，不能直接修改手牌/牌堆/状态数组。`setLocation()`仅供登记、移动接口内部调用。

| 位置 | 含义 |
| --- | --- |
| `{ zone: "deck" }` | 抽牌堆 |
| `{ zone: "discard" }` | 弃牌堆 |
| `{ zone: "hand", playerId: 0 }` | 玩家手牌 |
| `{ zone: "field" }` | 场上公共区域 |
| `{ zone: "status", playerId: 0 }` | 玩家身上的牌 |
| `{ zone: "outside" }` | 场外箱子，牌仍存在 |

`game.cards`登记全部实体，包括场外牌。`registerCard(card, location)`拒绝重复ID和已登记实体；基础牌初始只能登记到抽牌堆。专属牌可登记到任意合法区域。`moveCard(cardId, destination)`同时维护区域和位置，非法目的地不先移除原牌。基础牌洗回牌堆也走此接口。

```js
const seal = new ExclusiveCard({
  id: "berserker-seal", name: "berserkerSeal", heroId: "berserker",
  skills: ["extraAbility"]
});
game.registerCard(seal, { zone: "outside" });
game.attachCard(seal.id, 0, { effectId: "berserkerSeal", sourcePlayerId: 0 });
game.removeEffect(seal.id, { zone: "outside" });
```

上例是接口示意，不是已实现的狂战士技能。`extraAbility`需通过`registerSkill()`提供真实定义。场外专属牌也可以移入牌堆、手牌、弃牌堆，接口没有禁止此可能。`assertCardLocations()`核对全部实体恰好处于一个区域；开发导出与场景测试使用它。

## 属性和命格

属性为`dark / water / fire / wind / lightning / earth / light`。命格为`H幻 / Y咏 / J技 / S圣 / X血`。

- `getPrintedTraits()`返回印刷值：`{ elements: [...], fates: [...] }`。
- `getTraits({ game, playerId, purpose, ... })`返回当前规则下的有效值。
- 基础牌必须有一个合法属性及一个命格；专属牌允许空集合或多个属性。
- `element`、`fate`读取第一个印刷值，仅供需要单值的显示/排序；应战判定使用有效属性集合。

英雄技能和状态区专属牌授予的技能可以提供`modifyTraits(context, traits)`。修正优先级由低到高应用，较高优先级最后覆盖；同优先级按玩家与技能清单顺序。`filter`限定作用者和用途。`purpose`目前有`attack`、`response`、`hand`，技能付费查询可以使用`cost`。查询不修改原牌，所以技能失效或换区域无需恢复印刷值。攻击提交时保存有效属性快照，应战判断使用该快照，避免牌移入弃牌堆后丢失“手牌视为某属性”的修正；每次应战攻击也独立保存快照。

## 效果实例和叠加

每张挂载牌保存：

```js
card.attachment = {
  effectId: "poison",
  sourcePlayerId: 1,
  sourceSkillId: null,
  data: {}
};
```

基础牌种和挂载效果独立：英雄可以把水涟斩贴到别人身上承载`heroMark`，牌仍是水涟斩，但触发规则来自`heroMark`定义。先`registerEffect()`，再`attachCard()`。

- 中毒的定义为`stackable: true`：两张中毒就是两个效果实例，保留各自牌ID、施加者并分别触发、弃置。
- 圣盾、虚弱及新注册的基础效果默认`stackable: false`：同一玩家不能挂两个同名效果，即使施加者不同。
- 专属牌效果以唯一牌实体保证单一位置；不会把同名的两张不同专属实体合并。
- `Player.getBasicEffects()`查询基础牌承载的效果；`getEffects(effectId)`返回匹配牌的数组。
- `removeEffect(cardId, destination)`按指定牌移除；默认弃牌，也可以回手、回场外等。
- `.shield`、`.weakness`、`.poisons`是从状态区计算的只读查询，不再存储另一份可修改状态。

`Player.getSkills()`组合英雄技能和当前状态区牌授予的技能，并保留`sourceCard`。牌移走即失去它授予的技能。英雄可变的专属计数等保存在`hero.state`，公共能量等保存在`Player`。

## 回合与触发时点

```text
turnStart
→ actionPhaseBefore（中毒、虚弱）
→ actionPhaseStart
  ├─ 普通路线：activation → attackActionStart / spellActionStart
  │                         → attackActionEnd / spellActionEnd
  └─ 特殊路线：specialActionStart → specialActionEnd
→ actionPhaseEnd
→ turnEnd
```

虚弱跳过时为`actionPhaseBefore → actionPhaseSkipped → turnEnd`，不会触发启动和行动开始/结束。`endTurn`由引擎推进下一座位，浏览器和终端不再各自增加`current`。正常客户端使用`beginTurn()`、`executeAction()`或牌结算异步入口、`endTurnWithDecisions()`；无回合状态时允许独立规则操作，供隔离规则测试使用。

`TurnFlow.state`记录当前玩家、阶段、普通/特殊路线、行动类型与是否完成。`Game.timeline`记录实际触发顺序，开发导出包含它。启动时点已经存在，但真实英雄启动技能、额外行动与路线替换仍待逐个实现，当前不提供虚构技能。

### 原版查证

- `noname/library/element/content.js:4260`先触发`phaseBegin`，再进入`xingDong`。
- 同文件`:4492`触发`xingDongBefore`，`:4495`触发`xingDongBegin`，之后是`qiDong`。
- `noname/library/index.js:10722`虚弱绑定`xingDongBefore`，优先级1。
- 同文件`:10775`中毒绑定`xingDongBefore`，优先级3，逐张扩展牌触发。
- 同文件`:10806`圣盾绑定`shouDaoGongJi`和`shouDaoMoDan`，优先级-1，调用`weiMingZhong()`。
- `card/xingBei.js:390`中毒牌文字也写明“下一个行动阶段开始前”。

因此中毒不是回合开始触发；中毒先于虚弱处理。本次把原来集中在`startTurn()`中的行为落实到`actionPhaseBefore`。

攻击流程有`attackHitCheck`，圣盾把`context.hit`设为false，随后触发`attackMiss`，不造成伤害、不奖励命中星石；正常命中触发`attackHit`。魔弹单独使用`magicHitCheck`。公共伤害还有`damageBefore`/`damageAfter`，中毒不触发圣盾。

## 技能、效果和决策接口

`registerSkill(id, definition)`与`registerEffect(id, definition)`定义`timings`、`priority`、可选`filter`和`resolve`。触发优先级由高到低，原版中毒3先于虚弱1。同优先级稳定地按效果/玩家技能顺序处理；特殊英雄的自选排序仍需按原规则迁移。

`resolve`可以同步执行、返回Promise，或使用生成器请求外部决定。异步入口等待Promise；同步入口拒绝异步技能，避免把未完成的技能当作结算完成。决策请求包括`response`、`target`、`weakness`、`overflow`；新增技能选择交给调用者提供的`choose`回调。不要在规则模块创建弹窗。

玩家选择圣光后需确认；攻击牌/魔弹点击目标才提交，期间可换牌。浏览器和终端均在拿到最终决定后交给规则结算，牌选择不会直接改变区域。

当前实际英雄技能与具体专属牌规则尚未迁移。新基类、登记、动态技能与时点为真实扩展接口，不能把头像或测试用技能描述为已完成英雄。
