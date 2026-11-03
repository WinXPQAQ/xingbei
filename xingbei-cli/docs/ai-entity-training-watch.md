# 实体网络试训与定时推进

本轮目的是跑通 entities-v3 的训练、评测、保存和持续推进。使用共享策略网络及独立价值网络，强化学习只使用终局团队胜负；尚不替换网页服务模型。

初始批次：当前规则AI生成60局、18英雄轮换，整局分割训练与验证；GPU监督学习2000步。之后每10分钟运行一个批次：96局终局奖励训练、2遍更新，再评测。训练对手在当前规则AI与自博弈之间按轮交替。每轮从最新检查点继续，同时保留开发评测最高分的最佳检查点；不保证每轮提升。

每批对当前 `v1.8.0-preview.1` 跑36个种子换边、共72局，对旧 `v1.5` 跑18个种子换边、共36局。前者覆盖18英雄，后者限定原6英雄；相同种子、阵容和先手下交换模型阵营。报告按种子簇bootstrap的95%区间和截断数量。评测种子与训练分离，但会反复用于开发选模，不能称最终独立留出验收。小规模结果只用于判断流程及训练趋势。

本机使用用户级 systemd 服务 `xingbei-entity-training.service` 和每10分钟触发的 `xingbei-entity-training.timer`。该环境没有可用的 Codex automation_update 工具，使用本机定时器执行固定训练程序；它不会唤醒聊天代理自行修改代码。固定源码快照避免其他任务更新main时改变正在运行的实验。其他GPU进程保留；显存不足1800MiB时本次等待，不启动训练。

运行目录为 `/home/xp/.local/share/xingbei-ml/entity-v3-live/`：

- `status.json`：阶段、当前命令、最新/最佳模型、历次评测摘要。
- `progress.log`：采集、训练和评测日志。
- `teacher.jsonl`、`bootstrap.pt`、`cycle-NNNN.pt`：数据及模型；检查点保存优化器与随机状态。
- `evaluation-NNNN.json`：每局结果及分组胜率。
- `source/`：本次提交的固定源码快照。

查看与控制：

```bash
systemctl --user status xingbei-entity-training.service
systemctl --user list-timers xingbei-entity-training.timer
cat /home/xp/.local/share/xingbei-ml/entity-v3-live/status.json
tail -n 30 /home/xp/.local/share/xingbei-ml/entity-v3-live/progress.log
# 当前批次自然结束后暂停；定时器仍会检查暂停标记
 touch /home/xp/.local/share/xingbei-ml/entity-v3-live/PAUSE
# 恢复
rm /home/xp/.local/share/xingbei-ml/entity-v3-live/PAUSE
systemctl --user start xingbei-entity-training.service
# 取消后续定时触发，不中断当前批次
systemctl --user disable --now xingbei-entity-training.timer
```

文件锁和systemd防止重复训练；异常写入status.json并暂停后续推进，保留错误现场。进程崩溃恢复以已完成的检查点为准，不恢复半局采样。异常后需要检查部分输出、修复原因并调整阶段后再继续，避免覆盖证据。模型、数据和本机服务配置不上传Git；训练与监控工具及说明入库。


## 连续运行更新（2026-11-03）

现已改为常驻连续训练，每轮保存检查点，每5轮进行一次108局开发评测。10分钟定时器改为调用monitor检查服务与状态，在非暂停、非错误时恢复意外退出的服务；不再让每批等待10分钟。监控记录在monitor.json。暂停仍用PAUSE文件，当前轮结束后退出。停止定时器仅停止监控，暂停训练需创建PAUSE文件。

运行中一次短测：采样加参数更新进程GPU利用率平均约14.5%、峰值28%；评测约5.4%。这是进程级短窗口采样，不是长期平均或单独反向传播利用率。
