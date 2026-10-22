# 温度1.3模型续训与诊断（2026-10-22）

用户恢复训练后，从 residual-temp13-211/checkpoint-192.pt 恢复权重、Adam及随机状态；保留温度1.3、学习率0.0001和终局±1奖励。192→384批，新增4608局，8个CPU对局进程，CUDA执行推理及梯度更新。协议为 training/residual-temp13-resume-protocol.json；288/384两点评测均已启动独立监视服务，结果保存于本机 evidence/residual-temp13-resume-211-series.json。当前训练尚未完成。

父模型开发胜率298/504=59.13%，复用开发种子，不是独立验收。相对此前296/504不能认定显著提升。最终保留种子未使用，4173和4174未更换模型。

## 父模型行为诊断

运行现有 trace_residual.py，24局、1967次模型决策、99次偏离基准、零截断。完整结果在 ~/.local/share/xingbei-ml/evidence/residual-temp13-192-greedy-trace.json，含检查点哈希与按英雄/决策分类的前三个例子。采用固定训练范围种子251600000起、greedy执行；不是胜率评测，也不是逐决策反事实收益证明。计数包含单候选决策，不能当作非强制决策偏离率。

| 决策 | 次数 | 偏离AI1.5 |
| --- | ---: | ---: |
| action | 779 | 25 |
| cardChoice | 59 | 0 |
| effectChoice | 23 | 0 |
| energyChoice | 2 | 0 |
| healing | 70 | 0 |
| numberChoice | 11 | 0 |
| overflow | 123 | 0 |
| playerChoice | 47 | 0 |
| response | 636 | 74 |
| skillChoice | 193 | 0 |
| weakness | 24 | 0 |

行为改变集中在响应，也已出现主动出牌/目标/提炼选择改变。此样本中弃牌与技能选择没有改变；不能推断其他局面永远不变。下一步按预登记检查点评测决定是否保留续训成果，若仍停滞则针对候选表示与长程信用分配做受控实验，不以改动次数作为训练奖励。
