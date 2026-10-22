# 候选行动比较模块实验

协议：`training/residual-comparison-protocol.json`。当前仅登记，等待温度1.3续训288/384评测全部完成；不是已证明改善的模型。

现有网络把局面和候选各自编码后做点积，再加入AI1.5所选候选的固定先验。新增可选 `--comparison-head`，将局面编码、候选编码、基准候选编码分别映射到128维，相加后经过tanh和单一输出层，作为额外logit。输入仅使用原有观测和明确基准序号，不增加隐藏信息、奖励或启发式分数。所有合法候选仍参与选择。

输出层零初始化，因此从已训练父模型升级时保持原始分数及价值输出。新增随机参数初始化通过fork_rng隔离，避免改变无模块对照组的初始优化器洗牌随机状态。模型格式记录comparisonHead；旧检查点默认false。仅显式initialize允许升级，resume拒绝结构变化，已训练比较模块可以正常保存恢复。旧部署和运行中的冻结源码不改。

验证包含随机非零父模型输出一致、有效梯度、非法填充屏蔽、候选重排等变、检查点往返及错误结构拒绝。另用已训练父模型CUDA执行6局543次决策，逐次分数/价值完全一致，零截断（evidence/comparison-initial-parity.json）；CUDA两批共4局再恢复一批2局通过（evidence/comparison-smoke-211.log）。这两项实跑在增加fork_rng隔离前完成；隔离不改变新增模块生成的参数，只保留调用者RNG，最终代码另跑全套Python测试。均为正确性验证，不是强度结果。

实验两组从同一父模型权重出发并重置Adam，唯一网络差异为比较模块，均温度1.3、终局奖励；每组4608局，在96/192批评测并保留所有结果。未使用最终保留种子，不更换4174。

最终代码24项Python测试通过（19.476秒），证据evidence/comparison-head-tests.log；git diff --check通过。未改生产规则或网页，未将这些检查称为完整游戏或视觉验收。

## 已启动

温度续训两个检查点均未超过父模型，已满足登记的启动条件。两组训练及两个评测监视服务均已启动，执行冻结源码ea23d34。实际initial.pt核查共同模型参数完全相同、新模块输出层为零、两组Adam为空，CPU/Python/CUDA随机状态完全相同，证据evidence/residual-comparison-initialization.json。GPU查询确认两个Python训练进程，4173/4174保持运行。协议中的registered-not-launched保留登记时原文，实时状态见training/residual-status.json。

## 训练管线耗时检查

对父模型固定24局使用cProfile，在同时运行两组训练的情况下耗时12.448秒（有分析器开销）。features累计7.374秒、SeatMemory.encode累计8.097秒；说明CPU特征构造是值得继续检查的部分，不是纯GPU算力问题。证据evidence/residual-pipeline-profile.{json,txt,pstats}。

尝试缓存重复特征路径的精确CRC32值，保持累计顺序。ABBA四次各24局，逐局模型选择序列及结果完全一致：无缓存7.516/7.876秒，缓存7.398/8.022秒；平均7.696对7.710秒，没有稳定提速，已撤回代码。只保留evidence/feature-hash-cache-benchmark.json证据；未触碰训练冻结源码，不把这项性能尝试算作AI强度提高。
