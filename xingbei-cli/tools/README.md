# 开发工具

这些脚本不参与对局规则，也不由npm test自动执行；验证和采集脚本供开发手动运行，update-server.mjs用于服务器定时部署。浏览器工具需要环境已有Playwright；可通过PLAYWRIGHT_MODULE指定模块路径，通过PLAYWRIGHT_BROWSERS_PATH指定浏览器目录。未增加生产依赖。

| 脚本 | 当前用途 | 参数 |
| --- | --- | --- |
| verify-frontend-restoration.mjs | 开局、行动、状态、结束和重置的整体回归 | 输出目录 |
| verify-responses.mjs | 应战/魔弹、圣光待确认、无牌响应、伤害类别和暗弃 | 输出目录 |
| verify-heroes.mjs | 六英雄技能专项与直接点击角色选目标 | 英雄ID、输出目录 |
| verify-hero-selection.mjs | 开局模式/选角、测试按钮、重复回合与观战暂停 | 输出目录 |
| verify-animations.mjs | 实际动画、轨迹与取消，四视口专项 | 输出目录 |
| verify-resource-cache.mjs | HTTP缓存、ETag/304和浏览器磁盘缓存 | 可选结果JSON文件 |
| capture-original-six-player.mjs | 原版六人布局；CAPTURE_STATES=1另采集手牌/弹窗/状态 | 输出目录 |
| capture-original-animation.mjs | 原版动画录像、关键帧与隔离呈现调用 | 输出目录 |
| update-server.mjs | 独立目录拉取分支、检查、切换和失败回退 | --prepare（首次安装）、--status、--retry；见[部署说明](../docs/server-updates.md) |
| benchmark-ai.mjs | 相同种子换边对抗历史AI，记录胜负和实例守恒 | 种子数、结果JSON、历史提交哈希 |

在工作区根目录运行，先启动当前Web服务：

```bash
HOST=0.0.0.0 npm --prefix xingbei-cli run web
node xingbei-cli/tools/verify-responses.mjs xingbei-cli/artifacts/tools/responses-new
node xingbei-cli/tools/verify-heroes.mjs guardianAngel xingbei-cli/artifacts/tools/angel-new
node xingbei-cli/tools/verify-frontend-restoration.mjs xingbei-cli/artifacts/tools/frontend-new
```

六英雄ID为berserker、windSwordmaster、marksman、sealer、guardianAngel、priest。默认浏览器日常检查为1440×900桌面和390×844触屏，两视口均保持六人指定坐次；动画专项仍使用四视口。CURRENT_URL可修改当前服务地址（未支持该变量的英雄/选角专项仍使用本机4173）。

采集工具需要可访问的原版服务，ORIGINAL_URL默认http://127.0.0.1:4180。采集只调整隔离浏览器的运行时状态，不修改旧项目；这些准备不等同于自然业务全流程通过。输出目录应使用新的目录，避免覆盖已有证据。

## 精简与迁移

- verify-attack-response.mjs、verify-magic-target.mjs、verify-response-rules.mjs合并为verify-responses.mjs，共用浏览器、视口、错误监控及圣光检查函数。攻击/魔弹各运行共用圣光流程，独有的目标与传递规则仍分别验证；重复检查名称不重复计数，但每次调用都会断言。
- 移除capture-frontend-baseline.mjs、capture-original-restoration.mjs和write-frontend-comparison.mjs。这三个脚本用于历史四人基准/固定四人对照；旧restoration中仍需要的手牌数量、选目标、星石弹窗、状态标记及结束采集已合入六人采集的CAPTURE_STATES=1模式；布局和动态反馈分别由保留的两项原版采集覆盖。旧截图、HTML对照和报告保留，脚本原实现仍可从Git历史查阅。
- 历史报告内的旧命令仅记录当时运行，不再作为当前可执行入口。现在的整体静态对照可通过verify-frontend-restoration.mjs的ORIGINAL_EVIDENCE读取原版几何结果；并排图片仍可查看已经生成的历史对照页面。

扩展静态状态采集：`CAPTURE_STATES=1 node xingbei-cli/tools/capture-original-six-player.mjs xingbei-cli/artifacts/frontend/reference-new`。本次原版4180服务未运行，扩展模式仅完成迁移与语法检查，尚未重新实跑；保留旧结果作为历史依据。

## AI 对战基准

`benchmark-ai.mjs` 比较当前 AI 与指定历史提交的 AI，使用相同种子交换阵营，检查全局牌实例守恒并记录逐局胜负。它不是重复的浏览器测试；默认100种子/200局，可调整种子数量、输出JSON路径和旧AI提交哈希。需要本地 Git 历史，无额外依赖。

```bash
node xingbei-cli/tools/benchmark-ai.mjs 100 xingbei-cli/artifacts/ai/benchmark.json a0588bd
```

方法和限制见 [AI 说明](../docs/ai-policy.md)。
