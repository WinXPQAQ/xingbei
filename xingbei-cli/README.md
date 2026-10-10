# 星杯传说 CLI

零依赖的第一版规则引擎，运行环境为 Node.js 20+。

当前前端重构的源码分析、阶段任务和验收标准见 [前端还原计划](docs/frontend-restoration-plan.md)。

P0 首批原版运行证据、实际布局差异及可重复截图命令见 [前端基准报告](docs/frontend-baseline-p0.md)。

```bash
npm test
npm start
HOST=0.0.0.0 npm run web
```

当前实现 2v2、自动回合、三个简单 AI、固定 150 张牌堆及全部 11 种基础牌。牌实例保留 `element`（系别）和 `fate`（命格）。

默认控制 0 号玩家；也可以用 `npm start -- 2` 控制 2 号玩家。主动攻击命中获得宝石，应战攻击命中获得水晶；购买获得一个宝石和一个水晶；合成消耗三个星石、摸三张牌并生成星杯；提炼可把一至两个战绩区星石转为个人能量。角色技能尚未实现。

终端界面快捷键：`Tab` 切换控制台/行动日志焦点，`PageUp`、`PageDown` 滚动当前面板；没有命令输入时也可用方向键逐行滚动。输入命令时方向键用于浏览和编辑命令历史。

网页版默认监听 `0.0.0.0:4173`（所有 IPv4 网络接口），上述命令也显式指定该地址，方便外部验证。启动后，本机访问 <http://localhost:4173>，其他设备使用 `http://服务器IP:4173`；`0.0.0.0` 是监听地址，访问时使用服务器实际 IP。如只允许本机访问，可运行 `HOST=127.0.0.1 npm run web`。网页与 CLI 共用同一套规则引擎，支持点击手牌选择目标，以及购买、合成、提炼、应战、魔弹、虚弱和爆牌弹窗。

网页使用原项目默认的 `music` + `nova` 外观，复用网格背景、字体、卡牌、头像、星石和治疗槽。已按实测公式还原四人座位、头像与手牌尺寸、战绩位置；角色头像仅作展示，不包含角色技能。运行时请保留相邻的 `xingbei-1.6.7-source` 目录。来源和许可见 [SOURCES.md](SOURCES.md)，实际验收范围及剩余差异见 [本次还原报告](docs/frontend-restoration-2026-10-10.md)。

默认日志收起，点击“记录”打开。选牌后可以点击“取消”、按 Esc 或再次点击手牌返回；应战与爆牌直接选择底部手牌。合成必须选择3个星石，提炼选择1至2个且不超过个人能量剩余容量；满足条件后点击“确认”才结算，选满不会自动提交，可取消或调整选择。战绩区宝石与水晶合计上限为5个，超过上限的新增星石不进入战绩区。整理手牌先将攻击牌、法术牌分别归组，再在各组内按系别、命格排序。

图片与字体使用浏览器本地缓存，有效期24小时；到期后通过 ETag 校验，未变化时返回304，无需重传资源。页面、脚本和样式不缓存，普通刷新即可读取界面更新。若修改图片素材后需要立即看到新图，使用浏览器强制刷新。缓存验证工具为 `tools/verify-resource-cache.mjs`，需要与前端验证工具相同的Playwright环境。

开发场景入口：<http://localhost:4173/web/dev.html?scene=opening>。工具栏可切换场景、重置、暂停/单步AI和导出状态；正常游戏不显示这些工具。`attack`、`magic` 场景点击单步进入响应。暂停在回合边界生效，需要应战时单步会等待人类输入。

本次原版/新版截图对照：<http://localhost:4173/review/restoration/2026-10-10/compare.html>。浏览器采集与验证工具需要环境已有Playwright，未引入生产依赖；命令及证据说明见本次报告。

从其他设备查看开发场景和截图对照时，将上述地址中的 `localhost` 换成服务器实际 IP，端口和路径保持不变。

通过 Tailscale 访问本机时，使用 <http://100.110.150.77:4173/>（该 IP 是当前验证机器的 Tailscale 地址）。本服务仅提供 HTTP，不能直接使用 HTTPS。

为避免交互终端结束后服务退出，当前验证机器已使用用户级 systemd 临时服务 `xingbei-web` 独立运行，并在异常退出时自动重启。可用以下命令查看或管理：

```bash
systemctl --user status xingbei-web.service
journalctl --user -u xingbei-web.service -n 50 --no-pager
systemctl --user restart xingbei-web.service
systemctl --user stop xingbei-web.service
```

临时服务不保证机器重启或用户级服务管理器退出后继续运行。需要重新创建时，在当前验证机器执行（服务尚在运行时无需重复执行）：

```bash
systemd-run --user --unit=xingbei-web \
  --property=WorkingDirectory=/home/xp/xingbei/xingbei-cli \
  --property=Restart=on-failure --property=RestartSec=2 \
  --setenv=HOST=0.0.0.0 --setenv=PORT=4173 --setenv=TEST_MODE=1 \
  /usr/bin/node /home/xp/xingbei/xingbei-cli/server.js
```

测试时使用 `TEST_MODE=1 HOST=0.0.0.0 npm run web`，页面顶部中央显示 `package.json` 中的版本号（当前为 `测试 v0.1.1`），正常启动时不显示。当前外部验证后台服务已开启此开关；修改版本号或开关后需要重启服务。原项目素材和浏览器截图产物保留在本地，首个提交包含重构代码、文档和测试，仍依赖相邻原项目目录。
