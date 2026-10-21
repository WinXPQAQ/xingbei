# 定时收尾与暂停

用户确认的截止点是 **2026-10-22 00:53（Asia/Shanghai），即2026-10-21 16:53 UTC**。不是从实施时重新计算一小时。截止前不强行停止工作；截止后不启动新训练轮次，已登记训练及其预定评测自然结束。

本机`~/.local/share/xingbei-ml/training-control.json`为持久控制记录。`launch_frozen.py`和`train.py`启动入口检查该记录；时间到达或处于draining/paused时拒绝新训练。已运行的冻结训练不受影响，评测仍允许运行。未经用户明确恢复，不得绕过检查、从旧冻结脚本手动启动训练或删除控制文件。

`xingbei-training-drain.timer`在截止点触发`xingbei-training-drain.service`，Persistent=true，主机暂时离线后恢复也会执行。它只查询runs下launch-manifest登记的训练服务及对应验证服务；不停止任何进程，不操作4173/4174网页、模型推理或其他用户服务。所有登记任务均不再运行后，写入：

- `~/.local/share/xingbei-ml/evidence/training-pause-handoff.json`：各轮最新检查点、SHA-256、完成/计划批数、原始metrics和启动清单、恢复命令模板、所有同规格开发评测以及最高开发点估计模型。
- `training-control.json`中的本机状态变为paused。原模型文件含参数、优化器及随机状态，保持原路径，不覆盖或删除；体验版指纹不更换。

**本机状态不等于会话goal状态。** 当前没有可用的线程定时唤醒/automation_update工具，本机脚本不能调用会话的update_goal。收尾记录会明确保留goalStatusUpdate=pending；代理下次处理本线程时，先确认定时任务完成、无运行训练/验证，再执行`update_goal(status="paused")`并报告结果。不得提前声称会话goal已暂停，也不得恢复训练代替执行这项用户要求。

恢复必须由用户明确要求。先读交接报告和已保留实验失败，登记新的有限预算，再将控制记录标为resumed并以保留检查点恢复；模板默认追加192批仅是可审查起点，不应自动批量运行所有模板。原冻结命令中的--initialize已替换为--resume，保留温度、随机种子和采样起点；不得冒充从头训练为真正恢复。

查看定时器：`systemctl --user list-timers xingbei-training-drain.timer`；查看收尾：`journalctl --user -u xingbei-training-drain.service`。

验证：截止前/到点/过点、paused/draining、显式恢复、错误配置拒绝启动，以及等待登记任务自然退出且只查询不停止服务的测试通过；systemd单元校验通过。实际定时完成状态以后述交接文件为准。
