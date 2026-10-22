# 训练实验自动监测

2026-10-22：用户要求将会话里的重复轮询改为后台脚本。`training/watch_experiment.py` 每次执行一次检查，由 systemd 用户 timer 调度，与聊天是否在线无关。训练及预定评测仍由已有服务执行，监测器不启动新实验、不更换体验模型。

本次已安装并启用 `xingbei-ml-watch-residual-focused-211.timer`，每次检查结束后60秒再运行。运行副本和协议固定在 `/home/xp/.local/share/xingbei-ml/monitors/residual-focused-211/runtime/`，不会因工作树后续修改而变化。服务CPU上限100%、内存上限2GB，不占用GPU做监测。

完成条件为两组各192批训练、各96/192批的预定评测均已结束。检查训练批次、完整种子序列、模型SHA-256及评测协议，再重新核验实际评测记录并生成两组配对比较。开发结果仍不能算70%独立验收通过。

输出目录：`/home/xp/.local/share/xingbei-ml/monitors/residual-focused-211/`。

- `status.json`：原子更新的当前状态、完成批数、评测统计；完成后包含配对结果和模型哈希。
- `summary.md`：完成或异常后生成的中文摘要。
- `desktop-notification.json`：本机桌面通知尝试的返回值；桌面通知不可用不影响结果保存。

只有训练/评测服务已退出且缺少必要结果时才记为实验失败。读取或审计异常先重试，连续三次失败记为监测器错误（不冒充训练失败）。终态写日志并尝试一次 `notify-send`，随后停止本监测timer，不停止训练、评测或4173/4174/4175服务。重复执行终态检查不会重复通知。当前没有可调用的聊天定时唤醒工具，因此不能保证主动发消息到本聊天；结果文件和systemd日志是可靠交付位置。

查看状态：

```bash
systemctl --user list-timers xingbei-ml-watch-residual-focused-211.timer
cat /home/xp/.local/share/xingbei-ml/monitors/residual-focused-211/status.json
journalctl --user -u xingbei-ml-watch-residual-focused-211.service
```

若监测器连续错误停止，先排除错误，再保存旧status.json并移开它，重新启动timer；不要删除训练或评测结果。服务和timer文件位于 `/home/xp/.config/systemd/user/`。更换实验须使用对应协议、固定脚本副本及新的同名timer，不能复用已有终态目录。

验证：4项Python检查覆盖训练/评测共同完成、异常退出、瞬时故障重试、终态幂等、连续监测错误，以及完整检查点哈希/协议核验和未写完的JSONL尾行。真实首轮检查成功，timer已安排下一次执行；原版、体验版和推理服务均保持active。尚未到达本轮真实最终完成时点，不能把模拟检查称为真实最终评测通过。

2026-10-22收尾修复：两组完成时间不同，监测器重复审计先完成的一组；审计工具用独占创建拒绝覆盖旧输出，导致三次监测错误。改为每次使用独立临时目录审计，成功后原子替换报告，补充连续两次审计的检查。旧错误状态保留为status-before-idempotence-fix.json；重跑真实四份评测审计及配对汇总成功，不涉及重训或修改评测记录。
