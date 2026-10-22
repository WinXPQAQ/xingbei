# 直接对抗AI1.5的训练配比候选

协议为training/residual-focused-protocol.json。尚未启动正式实验，等待比较模块两组全部评测完成。当前原配比继续默认启用，冻结训练源码不变。

已有训练安排每24局有8局自博弈、4局全队对v1.5、4局全队对v1.4及8局混合。由于自博弈的六个座位都会贡献决策，实际数据中约61%模型决策来自自博弈、约15%来自全队对v1.5（两组138/140批快照，见evidence/residual-comparison-*-curriculum-audit.json）。这不是因果解释，只提供另一个值得控制比较的变量。

新增可选--curriculum v15-focused：每24局16局全队对v1.5、4局自博弈、4局混合（保留v1.4/v1.5队友）。种子、先手、阵容和合法决策不改变，评测安排不变。普通配比依然为balanced；旧检查点没有字段时视为balanced。resume拒绝更换配比，新的实验使用显式initialize并重置优化器；终局±1奖励不变。

测试覆盖原配比168局安排哈希完全一致、新配比数量/颜色平衡、六先手、六英雄与混合控制座位覆盖、未知配比拒绝。CPU两批连续执行与一批后新进程恢复，在模型、Adam、CPU/Python随机状态及已完成批次上完全一致；不据此声称GPU逐位恢复。证据evidence/focused-curriculum-resume/report.json。

如果满足协议启动条件，两组从同一父模型出发，每组4608局，在96/192批评测并报告全部结果。该候选不读取他人手牌或未来牌序，不引入中间奖励；没有推送或部署。

验证完成：25项Python测试通过；CUDA实跑24局，16全队/4自博弈/4混合，全部正常结束、零截断，证据evidence/focused-curriculum-smoke.json；git diff --check通过。不是强度测试，不作为晋级依据。

## 已启动

比较模块实验四个检查点均未超过父模型，启动条件已满足。两组从冻结源码de150eb执行，训练及预定评测服务均实际运行；initial.pt核查模型参数、CPU/Python/CUDA随机状态完全相同，两组Adam均为空且没有比较模块。证据evidence/residual-focused-initialization.json。登记协议中的未启动状态保留历史原文，实时状态见training/residual-status.json。
