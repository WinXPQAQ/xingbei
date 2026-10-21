# 混合AI手动体验服务

用户于2026-10-21授权部署本轮模型供手动体验。该授权覆盖本地实验服务，不代表70%训练目标验收通过，也不要求推送main。

- 地址：`http://100.110.150.77:4174/`；监听`0.0.0.0:4174`。原4173服务及main自动更新保持原配置。
- 模型：`residual-resume-211/checkpoint-192.pt`，SHA-256 `6da9db6c48d6c8280908019f1659756ce944029c0a34046687a32453bfde56ec`。开发评测整队296/504（58.73%），不是独立验收胜率。
- 正常/测试模式中五名电脑使用混合模型；观战模式六名电脑均使用。页面顶部标注“混合AI 第192批（实验）”。正常模式不公开其他手牌。
- 全部合法候选、观测编码、局部推演、1.5基准选择和按座位记忆均复用training模块。使用确定性最高分选择，不使用训练时随机探索。响应、技能、爆牌留牌也接入模型，不能只替换主动出牌后称为完整模型。
- 只将脱离Game的合法观测和基准候选序号发送到推理服务。每局使用独立随机会话，各座位分别维护记忆；重开不复用旧会话。错误直接提示，不回退成1.5。空闲两小时或超过128个会话可能要求重新开始。
- 推理为CPU两线程，后台端口4175仅监听127.0.0.1，由网页同源转发。训练仍使用原GPU任务。

代码快照保存在`~/.local/share/xingbei-ml/preview/releases/<commit>/xingbei-cli/`，部署模型副本位于`~/.local/share/xingbei-ml/preview/checkpoint-192.pt`。服务`xingbei-model-web.service`、`xingbei-model-inference.service`由用户systemd管理，工作目录固定到部署快照；修改开发工作树不会自动改变体验版。

查看状态：`systemctl --user status xingbei-model-web.service xingbei-model-inference.service`。停止体验版：`systemctl --user disable --now xingbei-model-web.service xingbei-model-inference.service`。模型指纹通过`/api/model/health`核对。普通静态服务不设置MODEL_PORT时不启用模型。

验证证据在`~/.local/share/xingbei-ml/evidence/`：253项Node测试通过；`model-server-game.json`与`model-server-parity.json`记录一局六人HTTP推理和本地推理的完整对局摘要相同，覆盖125次决策，不推广为所有局面逐决策等价证明。`model-browser-checks.json`记录1440×900及390×844的正常开局、重开进入观战、完整结束，各149次模型请求均成功，无pageerror；截图分别为`model-normal-*`和`model-finished-*`。这不是全部原版视觉还原验收。
