# 第二批英雄显示修正

## 元素黄灯

原项目`character/shiZhouNian.js`的`yuanSu`定义使用`image/card/zhiShiWu/hong.png`。虽然文件名叫“红”，实际图片是金黄色的火焰灯。本次原样复制到`assets/image/card/zhiShiWu/hong.png`，对外英文URL为`/assets/markers/element.png`，未重绘或改色。原图400×400、76,943字节；资源清单增加SHA-256。当前资源总量39个文件、20,809,828字节。

原版`noname/library/element/player.js`的markimage节点使用`background-size: contain`并取消阴影，新版同样保留图片比例、不加边框阴影，右下角显示数量。元素为0时移除灯，正数时显示当前元素数量与“元素 n/3”可访问说明。

## 动画中的治疗上限

闪动来自两套呈现数据不一致：真实Game能计算瘟疫法师治疗上限5，动画快照原先只保存当前治疗，不包含上限。`presentationView`没有`getHealingLimit`，渲染就从5回退到2，动画结束再次变成5。

现在`Game.recordPresentation`在记录每个检查点时保存各玩家当时的`healingLimit`，`presentationView.getHealingLimit`读取这一副本。不能查询实时Game替代，因为圣枪的动态上限可能在后续规则步骤改变。渲染不再硬编码神官例外，所有英雄使用同一接口；已有超上限治疗仍保留完整治疗槽。

## 验证

- `node --test test/model.test.js`：8项通过，新增1项检查瘟疫5、圣枪动态3→2、神官6，以及旧快照不被未来状态改写。
- `tools/verify-hero-display-fixes.mjs`：1440×900及390×844触屏共15项检查通过，控制台错误0。两视口实际播放剧毒新星多人伤害，观察整个玩家区DOM更新期间瘟疫槽数；检查黄灯原图、数量、消耗后移除，以及快照上限隔离。结果和截图保存在`artifacts/heroes/display-fixes/`。
- 此次复用原版素材与尺寸规则，不代表全部英雄动态视觉完成原版逐像素验收。

复现：已有Playwright环境下，设置`BASE_URL`指向当前代码服务，执行`node tools/verify-hero-display-fixes.mjs`。可用`PLAYWRIGHT_MODULE`指定安装路径。
