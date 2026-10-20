# plans-4 重复计算静态审查建议

未修改业务代码、未运行比赛或计时；以下是从调用关系可证明的重复计算，收益大小须由主线程profile验证。优先保留原公式、遍历顺序、严格大于比较、稳定排序与SEARCH_LIMIT计数。

## 优先1：在只读调用作用域复用基线

planner.bestAttack:93先value(s)，随后每张攻击×每个目标的planAttack:135再次value(s)，深搜候选也重复同一基线。封印法术每分支调用bestAttack，因此放大明显。rankAiActions已取得components(s)用于explain，但actionPlan/planAttack没有复用该根分值。

建议以可选baseTotal/baseParts或局部上下文传递已算值：rank根→actionPlan；bestAttack根→所有planAttack；planAttack每个b.state在额外行动选择之前算一次，供:130各选项使用。不得将父状态分值误用于支付能量后的next。仅复用同一未修改状态，分支顺序和搜索调用次数不变。

## 优先2：去掉比较器和best候选的重复估值

- angelBond:142的value(best)在每个治疗目标比较时重复；局部bestTotal随最佳状态更新即可。
- removeEffectOptions:151同样重复；:154排序每次比较又算两个state。各候选构造完成后保存total，再稳定排序。
- waterPower:199对最多6个候选sort comparator重复value；改为一次计算每候选total再比较，或保持原稳定tie的线性最佳选择。
- index的angelSong条件先调用一次removeEffectOptions取state存在，再调用第二次取值：整套效果/羁绊评估可直接复用。
- index的angelBond playerChoice排序同样在比较器内重复克隆并value，可预计算每个choice的分数。

这些计算会调用components，继而做双方分配、六人风险与法术分布，不只是简单对象读取。

## 优先3：按同一rank根状态缓存契约

contractOption在每个普通行动开头计算。该根状态/id一致时仅reserved组合有区别：普通(0,0)、领域治疗(1,0)、领域伤害(1,1)。每次根rank最多计算三份即可。

缓存作用域应限定本次rank及此s身份；返回option.state之后必须clone再置activationDone，不能修改缓存状态。真实请求skillChoice/playerChoice/numberChoice有不同targetId/预留字段，不能不带这些键共享。保留无收益时原state和count0，不缓存跨决策可变状态。

## 优先4：评分和解释共享分项

piercingOptions:14、giftOptions:19先value(next)−value(s)，随后difference(s,next)重新components两边。一次baseParts和一次afterParts可同时产生score与parts；保持Object.values原字段求和顺序，避免浮点边界改变排序。

primaryBranches在explain中可能再次估值；若这些分支终态曾作为bestAttack的基线，保存相同components供解释复用，不必再次完整扫描。

## 次优但安全的局部机会

- windCleansing/sealBreaking已经预选effectId，支付曝光后只需对该ID计算真实移除后的状态；当前调用removeEffectOptions生成并排序全部剩余效果，再find一个。可以新增单效果结算帮助器，前置枚举仍保持，后置避免无用候选；务必保持目标消失时不改选的修复。
- components同一调用中allocationValue与energyPlan重复生成energyUses；可局部预计算每玩家uses并传入，两次求值之间没有状态变化。先profile再动，避免为小收益加复杂接口。

## 禁止采用的“快捷缓存”

不要全局WeakMap按state对象缓存value/components。状态通过heal/payEnergy/damage/expose/transfer原地修改，同一身份不代表相同内容。当前spellExposure/horizon缓存使用充分统计键，不能由此推导整个state身份也安全。

不要缓存完整planAttack后绕过budget.used/left，或因为已有缓存而深搜更多分支；这将改变策略及性能预算语义。不要改变候选遍历、tie或采用近似舍入key。

实现后建议逐项对比完整rank动作/顺序/分项/搜索计数及trace重放，再测原18格。已有初测与第二测失败证据必须保留；静态优化建议不意味着性能过门。
