# plans-4 activation opt-in 修复最终复核

结论：**字段缺口及真实预留反例已解决。本次审查范围内没有剩余代码冻结阻断，可以继续冻结前其余检查。** 本报告取代前一份activation-followup中“字段缺失未修”的当前结论；旧报告作为失败证据保留。代码结论不代表性能/对战验收已过。

独立验证：

1. 重新运行/tmp/v15-contract-reservation-engine-review.mjs，预测与实际队友治疗都为[0,2]，领域/契约总费用一致。此前错误[1,1]不再出现。
2. /tmp/v15-activation-adapter-final-review.mjs将HEAD未改适配源码动态加载作对照。六个观察者的默认captureObservation(actions:true)与旧适配逐字段严格一致；activation opt-in后仅当前行动玩家得到activationDone/reservedEnergy/reservedHealing，其他观察者没有这些字段。
3. 在真实reservation反例的契约playerChoice阶段，实时决策、traceDecision.decision、replayTrace均为4；轨迹含reservedHealing=1。没有向队友暴露此次主行动的预留费用。
4. activationDone=true的状态再次规划祈福不包含holyContract步骤；递归计划中的一次启动标记现能从真实观察正确进入。
5. 当前21项v1.5专项独立运行通过，日志/tmp/v15-activation-final-tests.log。风之洁净先选效果、曝光消失不改选与12组契约/领域费用测试均在其中。

实现边界：captureObservation和isolatePolicy的activation默认false，旧冻结策略调用方式不变；仅候选index显式开启，候选trace同样开启。observationView复制turn字段，重放不用另取真实Game。增加的状态均属于当前玩家自己已经选择的行动状态。

本次没有发现重复支付、额外activation、trace漏预留或扩大攻击树的新增问题。contractOption有限额外估值仍有性能成本，冻结前应按原预算实测；有限法术风险分布及其他建模局限沿用扩展审查说明。

审查指纹SHA256：
- observation.js 8128768fda9d1d4b2588a7786c99a87385d12de39e8620ccd6cb038522d10e75
- index.js 55ebba2fd6d5474296b8c3513725914259252a2ecbba9c3855c923e3184695c1
- planner.js 9eaeb33ca8c3eae0c44c59ae7d57b6b6d786aca90b7ef82e1446342eb37e2de8
- model.js 11d4a55935d706e75874c31954ce09cc3fa46964c793b64d5887d059ec683a56

未修改源码，未运行比赛。
