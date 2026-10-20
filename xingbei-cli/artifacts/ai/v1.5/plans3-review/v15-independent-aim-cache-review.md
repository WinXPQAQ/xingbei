# plans-3 历史目标缓存独立只读审查

结论：本次horizon.js的aimCache改动在现有调用约定下等价，未发现新增隐私问题、搜索扩大或阈值调整。可以继续原性能预算下验证；本结论不是性能门通过。

代码核查：horizon.js:6–11用WeakMap按actions数组身份、内层Map按actorId缓存同一条filter(type=attack且actorId相等).slice(-6)结果。原谓词、事件顺序、尾部6条窗口完全保留。model.js:26每次决策structuredClone公开actions并冻结数组；clone保留同一历史引用，搜索没有修改actions的路径。不同观察/决策获得不同数组键，WeakMap不会把一名玩家私有状态加入另一名玩家评估，也不会延长所有历史数组的生命周期。输入仍来自公开语义流，没有访问Game、牌堆或他人手牌。

数组的事件对象未递归freeze，但当前代码没有修改事件对象；等价性依赖此已有的只读约定。不要未来复用数组后修改历史事件type或actorId，若未来增加该能力需同时改缓存失效逻辑。

独立对照：/tmp/v15-aim-cache-review.mjs动态加载当前horizon，并构造仅把缓存调用替换回原扫描的参照函数。40组不同历史长度/混合事件、18种座位/士气/手牌/盾/治疗组合，每项再改变行动座位与手牌并复用actions身份，累计1440次严格数值相等，0失败。测试不接触项目文件，仅/tmp脚本。

model/planner/index的SHA256与上次复审完全相同。horizon.js审查指纹：5dab8e49a81551e098164132e9992c890eb06dd2f853a5a3016ed1db121c3350。
