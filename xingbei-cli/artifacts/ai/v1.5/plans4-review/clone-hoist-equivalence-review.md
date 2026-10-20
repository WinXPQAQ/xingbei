# plans-4 turn复制与风险不变量提升独立复审

结论：**在当前脱离引擎的plain turn输入范围内，两项优化等价且副本隔离；无本次审查发现的行为阻断。可以开始隔离性能实测。** 本结论不是性能门通过。

## 全排名与请求复验

重跑reuse-equivalence.mjs，仍用plans4-before-reuse完整五模块为独立参照，因而覆盖此前复用及本轮复制/提升全部优化。

- 180压力观察＋原5例＋30定向状态：215份排名。
- 4761候选的动作、精确浮点分数、完整解释、搜索limit/used逐项严格相等。
- 1720个相邻同分候选对排序相同。
- 54契约请求的完整trace及replay一致。
- 输入观察与11份受监控源码前后SHA256一致，0失败。

本轮给诊断脚本的契约定向Game补固定seed=1504001，仅修改review脚本、不改业务策略。此前脚本未指定该fixture的seed，导致候选总数跨运行变化，但每轮内部新旧输入相同且相等。当前reuse-equivalence.json为固定fixture后的可复现结果；上一轮报告中4744等计数属于当时那次记录，不应用来误判业务差异。

## clone隔离验证

clone-isolation-review.mjs覆盖14种turn：null、undefined、布尔、数字、字符串、空数组/记录、多层数组/plain记录、真实usedSkills/pendingActions/activation预留结构。与structuredClone值逐项相等。

对副本修改usedSkills字段、增加技能标记、改变pendingActions元素/追加行动、修改reservedEnergy，不影响源与另一份副本；多层数组及记录也独立。结果保存在clone-isolation-review.json。

copyTurn不是通用structuredClone替代：不处理循环引用、Date/Map/Set或共享引用图的别名保留。但captureObservation先JSON复制，当前turn白名单仅plain记录，实际搜索也只添加plain记录，故这些额外语义不属于现有输入契约。未来若turn引入非plain结构，必须重新审查，不能直接沿用结论。

## nextTurnRisk提升

aim依赖队伍人数，shield依赖被评估玩家当前效果，两者在nextTurnRisk循环内均未修改。仅pressure/defenses累积变化；提升这两个只读值没有改变浮点算式、循环顺序或求值次数以外的语义。

当前model SHA256：4616e83363896bc43912ef740c2dc2a0267350166797b58a8dfba212b1dba22b。

未运行计时比赛，未修改业务代码。旧性能失败证据保持；待主线程按原预算隔离实测。
