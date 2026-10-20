# plans-4 spellExposure 性能缓存独立审查

结论：**缓存键充分、两处早返回与初测函数等价；未发现行为公式变化或隐私扩张。** 可以继续原性能预算验证，不代表性能门已通过。本审查只写入review证据，未修改业务源码、未运行比赛。

## 静态核查

初测model与当前model直接diff仅包含：新增WeakMap；提早计算shelter；width=0或shelter覆盖最大可能损失时返回0；按充分统计缓存；最多4096项后停止新增memo。原有限分布递推及浮点计算顺序保持。

键为[exposures, enemyCounts, shelter]。exposures完整包含当前队每名成员的手牌/手限/治疗/神官上限/盾结果，也以数组长度保留分母allies.length；enemyCounts保留敌方机会数量及顺序；shelter保留全部己方天使可支付能量总量。magicRate和weights.morale是模块固定常量。角色、队伍标签及观察者身份本身不在该函数剩余公式里，因此无需另加team/id；同一统计向量输出相同。

外层WeakMap按本次脱离引擎的beliefs对象隔离；函数不读取任何暗牌或牌序。每个决策的Map上限4096，饱和后仍正常精确计算，不丢弃候选、不截断分布。WeakMap不会强持有已失效的决策键。

早返回：width=0时所有单次损失均0；每个敌方机会最多贡献width，故总损失≤width*enemies.length。若shelter达到该上界，各结果的max(0,loss−shelter)都为0。两条件只省计算，不改变概率公式。

## 独立数值对照

脚本spell-cache-equivalence.mjs动态加载真实初测model.js和当前model.js，仅将三处相对import改绝对URL，未重写参照函数。复用同一beliefs身份遍历8918种非零红方统计键，超过4096 memo容量；加入盾、神官治疗上限、不同手限、储能、反复命中缓存和两队切换。

- spellExposure严格数值相等比较：23322次，0差异。
- 完整components逐项严格相等比较：233次，0差异。
- 结果与源码哈希：spell-cache-equivalence.json。

初测model SHA256：11d4a55935d706e75874c31954ce09cc3fa46964c793b64d5887d059ec683a56

当前model SHA256：db59bce8e99d9cf5943380b5c841ceea3f2b657420fc690738a2b015f46fb9b3

本结论只覆盖以上指纹的等价优化。魔弹先验、目标分配和有限未来损失近似的原有局限没有被缓存修复，也没有被本次改动扩大。
