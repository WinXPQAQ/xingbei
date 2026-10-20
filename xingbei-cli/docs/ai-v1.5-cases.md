# v1.5 开发案例对照

未发布候选。原五例由真实引擎使用v1.4/v1.3重新行至原回合，69个旧排名精确一致；原始公共动作链及新排名见 [five-comparison.json](../artifacts/ai/v1.5/five-comparison.json)。旧例的实际后续胜负不参与单步判断。概率仍是公开模型估计，不能称最优行动或真实胜率。

风险口径：已确认终局±100000；未知响应条件分支终局±150；未来一轮首个败局/反杀风险净值限制在±150。第五杯窗口也是有界准备价值，只有实际确认的合杯胜利才用十万。双方、所有行动和应战均沿用同一状态估值。

## 例1：marksman

旧选择：水涟斩→2号（-0.89）。新排序前列：

|合法行动|完整计划分|首动作分|追加分|
|---|---:|---:|---:|
|魔弹→5号|4.01|4.01|-0.00|
|水涟斩→2号|2.33|2.33|0.00|
|地裂斩→1号|2.05|2.05|0.00|
|地裂斩→2号|2.05|2.05|0.00|
|水涟斩→1号|2.05|2.05|0.00|
|风神斩→1号|2.05|2.05|0.00|

最佳计划分支（推测，不是实际已发生）：

- 61.81%：4号魔弹→5号；magic-hit-check
- 24.71%：4号魔弹→5号；magic-light
- 8.33%：4号魔弹→5号；magic-relay → magic-hit-check
- 3.33%：4号魔弹→5号；magic-relay → magic-light
- 1.82%：4号魔弹→5号；magic-relay → magic-relay-horizon

最近公开完整事件（此前全部事件保留在JSON；暗牌不展示）：

- {"type":"turn","playerId":1}
- {"type":"play","playerId":1,"targetId":3,"card":"雷光斩","elements":["thunder"],"fates":["Y"],"uniqueSkills":["speedBlessing","lightning"]}
- {"type":"attack","actorId":1,"targetId":3,"card":"雷光斩","elements":["thunder"],"counter":false}
- {"type":"skill","playerId":1,"skillId":"rage"}
- {"type":"play","playerId":3,"targetId":1,"card":"圣光","elements":["light"],"fates":["X"],"uniqueSkills":[]}
- {"type":"response","actorId":3,"sourceId":1,"targetId":1,"card":"圣光","elements":["light"],"result":"cancel"}
- {"type":"turn","playerId":2}
- {"type":"spell","actorId":2,"targetId":0,"card":"虚弱","elements":["water"]}
- {"type":"play","playerId":2,"card":"虚弱","elements":["water"],"fates":["X"],"uniqueSkills":[]}
- {"type":"effect","sourceId":2,"targetId":0,"effectId":"虚弱","result":"attached"}
- {"type":"turn","playerId":3}
- {"type":"spell","actorId":3,"targetId":0,"card":"圣盾","elements":["wind"]}
- {"type":"play","playerId":3,"card":"圣盾","elements":["wind"],"fates":["Y"],"uniqueSkills":[]}
- {"type":"effect","sourceId":3,"targetId":0,"effectId":"圣盾","result":"attached"}
- {"type":"turn","playerId":4}

## 例2：berserker

旧选择：提炼1宝石+0水晶（-0.50）。新排序前列：

|合法行动|完整计划分|首动作分|追加分|
|---|---:|---:|---:|
|提炼2宝石+0水晶|1.60|1.60|0.00|
|提炼1宝石+0水晶|-2.28|-2.28|-0.00|
|提炼0宝石+1水晶|-10.40|-10.40|-0.00|
|水涟斩→3号|-10.90|-10.90|0.00|
|提炼1宝石+1水晶|-11.08|-11.08|0.00|
|火焰斩→3号|-12.55|-12.55|0.00|

最佳计划分支（推测，不是实际已发生）：

- 100.00%：1号提炼；refine

最近公开完整事件（此前全部事件保留在JSON；暗牌不展示）：

- {"type":"damage","sourceId":3,"targetId":5,"amount":1,"result":"spell"}
- {"type":"effect","playerId":5,"effectId":"中毒","result":"removed"}
- {"type":"play","playerId":5,"targetId":0,"card":"暗灭","elements":["dark"],"fates":["Y"],"uniqueSkills":[]}
- {"type":"attack","actorId":5,"targetId":0,"card":"暗灭","elements":["dark"],"counter":false}
- {"type":"attackResult","actorId":5,"targetId":0,"card":"暗灭","result":"hit"}
- {"type":"healing","playerId":0,"amount":0,"result":"prevent"}
- {"type":"damage","sourceId":5,"targetId":0,"amount":2,"result":"attack"}
- {"type":"turn","playerId":0}
- {"type":"play","playerId":0,"targetId":5,"card":"暗灭","elements":["dark"],"fates":["S"],"uniqueSkills":[]}
- {"type":"attack","actorId":0,"targetId":5,"card":"暗灭","elements":["dark"],"counter":false}
- {"type":"skill","playerId":0,"skillId":"rage"}
- {"type":"attackResult","actorId":0,"targetId":5,"card":"暗灭","result":"hit"}
- {"type":"skill","playerId":0,"skillId":"rage"}
- {"type":"healing","playerId":5,"amount":0,"result":"prevent"}
- {"type":"damage","sourceId":0,"targetId":5,"amount":4,"result":"attack"}
- {"type":"turn","playerId":1}

## 例3：windSwordmaster

旧选择：提炼0宝石+1水晶（-4.40）。新排序前列：

|合法行动|完整计划分|首动作分|追加分|
|---|---:|---:|---:|
|提炼1宝石+0水晶|-0.32|-0.32|0.00|
|提炼0宝石+1水晶|-0.80|-0.80|0.00|
|提炼1宝石+1水晶|-6.72|-6.72|0.00|
|魔弹→3号|-29.59|-29.59|0.00|
|火焰斩→3号|-34.88|-34.88|0.00|
|地裂斩→3号|-36.86|-36.86|0.00|

最佳计划分支（推测，不是实际已发生）：

- 100.00%：2号提炼；refine

最近公开完整事件（此前全部事件保留在JSON；暗牌不展示）：

- {"type":"play","playerId":5,"targetId":0,"card":"暗灭","elements":["dark"],"fates":["Y"],"uniqueSkills":[]}
- {"type":"attack","actorId":5,"targetId":0,"card":"暗灭","elements":["dark"],"counter":false}
- {"type":"attackResult","actorId":5,"targetId":0,"card":"暗灭","result":"hit"}
- {"type":"healing","playerId":0,"amount":0,"result":"prevent"}
- {"type":"damage","sourceId":5,"targetId":0,"amount":2,"result":"attack"}
- {"type":"turn","playerId":0}
- {"type":"play","playerId":0,"targetId":5,"card":"暗灭","elements":["dark"],"fates":["S"],"uniqueSkills":[]}
- {"type":"attack","actorId":0,"targetId":5,"card":"暗灭","elements":["dark"],"counter":false}
- {"type":"skill","playerId":0,"skillId":"rage"}
- {"type":"attackResult","actorId":0,"targetId":5,"card":"暗灭","result":"hit"}
- {"type":"skill","playerId":0,"skillId":"rage"}
- {"type":"healing","playerId":5,"amount":0,"result":"prevent"}
- {"type":"damage","sourceId":0,"targetId":5,"amount":4,"result":"attack"}
- {"type":"turn","playerId":1}
- {"type":"refine","playerId":1,"gem":1,"crystal":0}
- {"type":"turn","playerId":2}

## 例4：sealer

旧选择：火焰斩→5号（-0.67）。新排序前列：

|合法行动|完整计划分|首动作分|追加分|
|---|---:|---:|---:|
|圣盾→3号|6.65|5.80|0.85|
|圣盾→4号|6.65|5.80|0.85|
|圣盾→0号|4.65|3.80|0.85|
|火焰斩→5号|2.15|2.15|0.00|
|地裂斩→5号|2.15|2.15|0.00|
|火焰斩→1号|1.52|1.52|0.00|

最佳计划分支（推测，不是实际已发生）：

- 31.08%：0号圣盾→3号；holyShield；随后0号火焰斩→5号；hit
- 19.95%：0号圣盾→3号；holyShield；随后0号火焰斩→5号；light
- 15.49%：0号圣盾→3号；holyShield；随后0号火焰斩→5号；counter → counter-hit
- 33.47%：0号圣盾→3号；holyShield；随后0号火焰斩→5号；counter → counter-answered

最近公开完整事件（此前全部事件保留在JSON；暗牌不展示）：

- {"type":"turn","playerId":0}

## 例5：priest

旧选择：地裂斩→1号（-1.06）。新排序前列：

|合法行动|完整计划分|首动作分|追加分|
|---|---:|---:|---:|
|水之神力→0号|2.53|2.53|0.00|
|地裂斩→1号|1.98|1.98|0.00|
|地裂斩→2号|1.70|1.70|0.00|
|风神斩→1号|1.70|1.70|0.00|
|风神斩→2号|1.70|1.70|0.00|
|地裂斩→5号|1.41|1.41|0.00|

最佳计划分支（推测，不是实际已发生）：

- 100.00%：4号水之神力→0号；waterPower；交牌魔弹→0号

最近公开完整事件（此前全部事件保留在JSON；暗牌不展示）：

- {"type":"turn","playerId":1}
- {"type":"spell","actorId":1,"targetId":0,"card":"虚弱","elements":["earth"]}
- {"type":"play","playerId":1,"card":"虚弱","elements":["earth"],"fates":["J"],"uniqueSkills":[]}
- {"type":"effect","sourceId":1,"targetId":0,"effectId":"虚弱","result":"attached"}
- {"type":"turn","playerId":2}
- {"type":"spell","actorId":2,"targetId":3,"card":"虚弱","elements":["water"]}
- {"type":"play","playerId":2,"card":"虚弱","elements":["water"],"fates":["X"],"uniqueSkills":[]}
- {"type":"effect","sourceId":2,"targetId":3,"effectId":"虚弱","result":"attached"}
- {"type":"turn","playerId":3}
- {"type":"effect","playerId":3,"effectId":"虚弱","result":"removed"}
- {"type":"turn","playerId":4}

## 边界

例1不要求特定排序。例2比较等待与进攻，不能把蓝方低士气解释成红方风险。例3保留准备剑影的提炼价值，不强迫立即三刀。例4比较贴盾与追加的净值，没有破盾固定奖励。例5赠魔弹的角色用途与满手负担都计入，协同有收益不意味着必须压过所有进攻。封印师/风剑搜索最多64次扩展；未来一轮是公开危险度近似，未模拟全部技能或私人响应。
