# 服务器自动更新

服务器每分钟主动检查GitHub指定分支，默认`main`。不需要公网入口或GitHub webhook，适合通过Tailscale访问的当前机器。GitHub Actions也可以通过SSH部署，webhook可以更即时地触发，但两者需要额外的网络和凭据配置；目前采用systemd用户级timer轮询。

## 更新过程

`tools/update-server.mjs`在独立裸仓库中fetch远端分支，按提交SHA导出到新的release目录，运行`npm test`，再用临时本机端口启动候选服务，核对首页、脚本、图片和字体。通过后原子切换`current`软链接，重启`xingbei-web.service`并再次检查实际HTTP内容及服务状态。

没有新提交时不重启；测试／预启动失败时保留当前服务；切换后的检查失败时切回旧release并重启。失败提交会记入`failed.json`，避免每分钟重复失败，修复环境后用`--retry`重试。无法连接GitHub时当前服务不变。`flock`防止定时和手动操作并发。保留当前版本、上一个运行版本和一个其他最近版本；不修改开发工作区，也不对它执行pull、reset或stash。

当前项目为零第三方依赖；将来增加依赖时更新会明确失败，需要先配置安装与锁文件策略。部署只验证规则测试和HTTP启动，不等于跑完浏览器交互／视觉验收。检查间隔为上一轮结束后60秒，加上拉取和测试耗时，并非推送后瞬间生效。切换期间可能短暂中断HTTP；对局仍在浏览器中，新版本请刷新后重新开局。

## 首次安装（当前Linux服务器）

需要Node.js 20+、npm、Git、tar、flock及systemd用户服务。运行用户需能无交互读取目标Git仓库；SSH使用现有密钥及known_hosts，不向仓库写入凭据。

在仓库根目录执行：

```bash
mkdir -p ~/.config/xingbei-deploy ~/.config/systemd/user ~/.local/share/xingbei-deploy
cp xingbei-cli/deploy/config.example.json ~/.config/xingbei-deploy/config.json
cp xingbei-cli/tools/update-server.mjs ~/.local/share/xingbei-deploy/update-server.mjs
node ~/.local/share/xingbei-deploy/update-server.mjs --prepare
```

先验证候选版本，再将当前网页服务迁移至独立部署目录。若已有服务，先保存`systemctl --user cat xingbei-web.service`输出，并暂停已有更新timer；`--prepare`只供首次安装使用，不重启现有服务，不应用于已在线的自动部署实例。

```bash
systemctl --user stop xingbei-web.service
cp xingbei-cli/deploy/xingbei-*.service xingbei-cli/deploy/xingbei-update.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now xingbei-web.service
systemctl --user enable --now xingbei-update.timer
```

运行文件均在用户目录中：

| 路径 | 用途 |
| --- | --- |
| `~/.config/xingbei-deploy/config.json` | Git仓库、分支、服务名和检查地址 |
| `~/.local/share/xingbei-deploy/update-server.mjs` | 稳定的更新程序副本 |
| `~/.local/share/xingbei-deploy/repository.git/` | 独立拉取仓库 |
| `~/.local/share/xingbei-deploy/releases/<SHA>/` | 每个通过预检查的版本 |
| `~/.local/share/xingbei-deploy/current` | 当前部署软链接 |
| `~/.local/share/xingbei-deploy/failed.json` | 最近失败信息；成功后移除 |

配置中的`root`可覆盖部署根目录，但需同步修改两个service中的路径；`artifactsDirectory`可指向已有的本地截图证据目录，仅将版本中缺少的证据子目录挂入，不覆盖已提交的证据，不随版本清理。当前服务器设置为`/home/xp/xingbei/xingbei-cli/artifacts`。`XINGBEI_DEPLOY_CONFIG`可覆盖配置文件路径。监听仍为`0.0.0.0:4173`，版本标记`TEST_MODE=1`。

更新脚本本身不会自动替换正在执行的更新程序。修改部署工具后，应检查后重新复制到上述稳定路径；修改unit后重新复制并执行`systemctl --user daemon-reload`。这样业务分支更新不会在部署途中替换控制脚本。

用户服务若需要在退出登录及重启后继续运行，执行`loginctl enable-linger "$USER"`；权限不足时由管理员开启，并用`loginctl show-user "$USER" -p Linger`核对。仅启用timer不代表系统已经允许用户服务在注销后常驻。

## 日常操作

```bash
# 立即检查并更新（与timer使用同一把锁）
systemctl --user start xingbei-update.service
# 查看部署版本和失败原因
node ~/.local/share/xingbei-deploy/update-server.mjs --status
# 查看更新日志与下一次检查
journalctl --user -u xingbei-update.service -n 80 --no-pager
systemctl --user list-timers xingbei-update.timer
# 暂停自动部署；不会停止游戏服务
systemctl --user disable --now xingbei-update.timer
# 恢复
systemctl --user enable --now xingbei-update.timer
# 修复环境后重新尝试同一个失败提交
node ~/.local/share/xingbei-deploy/update-server.mjs --retry
```

修改`config.json`的`branch`即可跟踪其他分支，下次检查生效。正常回滚建议在GitHub目标分支revert问题提交，随后自动部署这个回退提交。需要暂时固定某一旧版本时，先停timer和正在运行的update service，再切换current至保留的release并重启网页服务，避免下一轮又更新回来。

## 验证

隔离本地Git仓库和模拟systemd服务验证：首次准备、无更新跳过、新提交部署、测试失败保留服务、失败提交不重复执行、切换失败回退、手动重试成功、源工作区未修改、并发锁、保留本地截图目录。记录位于`artifacts/deployment/checks.json`。实际服务器安装结果另记录于本文件末尾。

### 当前服务器安装结果（2026-10-19）

已启用main轮询、持久网页服务及用户linger，注销后仍可运行。首次准备`31007a8`通过74项规则测试；启用timer后实际检测到另一任务新推送的`6946c095b2b5`，通过98项规则测试和HTTP检查后自动切换。Tailscale入口仍为`http://100.110.150.77:4173/`，本地旧截图入口已验证HTTP 200。远端新增已跟踪的artifacts目录后，补充按子目录挂载缺失本地证据的处理，保留远端AI证据及本地frontend证据两者。
