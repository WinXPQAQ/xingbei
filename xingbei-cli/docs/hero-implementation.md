# 六英雄实施记录

按狂战士、风之剑圣、神箭手、封印师、守护天使、神官依次完成独立goal，各建一个本地commit，不push。以用户规则及十周年技能文字为准，旧引擎用于核对时点。六人红蓝蓝红红蓝，0号玩家控制当前验收英雄。基础引擎历史场景显式heroRules=false，避免将没有技能的历史基准误认为新英雄规则；正式网页默认启用已实现技能。

## Goal 1：狂战士（v0.4.0）

实现狂化、血影狂刀、血腥咆哮、撕裂，英雄可选响应与治疗选择共用Session等待。攻击上下文记录六判定时点：attackDeclared(1)、attackDecision/hitCheck/hit(2)、damageBefore(3)、healingBefore(4)、damageActualBefore(5)、damageActual(6)。强制命中仍执行时点2，不消耗圣盾、不请求应战/圣光，后续治疗正常。狂化主动和应战均生效；命中时手牌数量在时点2保存，撕裂在时点3决策并消耗个人宝石。

150张牌逐实体还原uniqueSkills，属性和命格相同可能标签不同；保留3张圣光的治疗术。标签使用英文、中文显示，未实现英雄的标签不自动提供能力。来源：card/xingBei.js完整150行牌表；character/shiZhouNian.js狂战士258—333行及技能文字；noname/library/element/gameEvent.js强制命中；layout/default/layout.css的.card > .range。未改旧项目。

40项Node测试通过；桌面1440×900与触屏390×844共17项英雄浏览器检查通过，控制台/素材错误0。证据artifacts/heroes/berserker/，入口/web/dev.html?scene=hero-berserker。检查包括待提交取消、血腥咆哮、拒绝撕裂不扣费、圣盾保留、治疗及六时点。数值边界、血影狂刀与应战增伤由Node链式测试覆盖；未将这些描述为全部旧版自然技能流程视觉对照。独有技文字直接提取旧range规则，原有布局保持。

风之剑圣、神箭手、封印师、守护天使、神官：尚待后续独立goal实施。
