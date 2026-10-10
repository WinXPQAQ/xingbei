# 原版代码与素材来源

本项目网页版从相邻 `xingbei-1.6.7-source/`（星杯传说 v1.6.7）提取和适配以下实现，原目录未修改：

| 新版用途 | 原版依据 |
| --- | --- |
| 四人相对座位、手牌和控制区锚点 | `layout/default/layout.css`、`layout/newlayout/global.css`、`layout/nova/layout.css` |
| 背景、阴影、圆角、选中状态和弹窗 | `theme/music/style.css`、`layout/default/layout.css`、`layout/newlayout/global.css` |
| 玩家头像、名字、阵营、计数与治疗槽 | `noname/library/element/player.js`、`layout/newlayout/global.css`、`theme/style/hp/xingBei.css` |
| 方形牌面及系别/命格文字层 | `noname/library/element/card.js`、`layout/default/layout.css` |
| 战绩表格和星石图标 | `noname/ui/index.js` 的 `updateShiQiInfo()`、`noname/ui/create/index.js` 的 `zhanJi()` |
| 手牌折叠和滚动 | `noname/ui/index.js` 的 `updatehl()`；处理了空手牌与单牌分支 |
| 逻辑视口、设备缩放 | 同文件的 `updated()`、`updatez()` |
| 合成、提炼材料选择及状态图标 | `noname/library/index.js` 的 `_heCheng`、`_tiLian`、`_xuRuo`、`_zhongDu`、`_shengDun` |
| 150张基础牌堆 | `card/xingBei.js`，由既有 `src/cards.js` 提取 |

字体、角色头像、卡牌、星石、music纹理和治疗槽图片通过服务器映射读取原目录，不复制或重新绘制。头像仅供展示；不表示已实现该角色技能。治疗槽读取共用引擎的 `healing` 值，不提供额外治疗操作。

原项目附带 GPL-3.0 许可证，适用许可证全文保留在本目录的 `LICENSE`。复用和适配原代码时继续保留来源及原版权；素材仍保留原文件及其适用权利说明。本文件不将原项目第三方资源的权利重新授予或改写。

六人布局继续提取自 `layout/nova/layout.css` 的 `#arena[data-number="6"]` 座位规则（287–307行）。新增显示头像使用原资源 `image/character/shenGuan.jpg` 与 `image/character/anShaZhe.jpg`，沿用上述项目来源与许可说明；头像展示不包含角色技能。

规则阶段来源：`noname/library/element/content.js` 的星杯回合与行动流程，`noname/library/index.js` 的中毒/虚弱/圣盾基础效果；具体位置和映射见 `docs/game-architecture.md`。新规则使用英文标识，原素材通过 `legacy-assets.json` 适配，原项目未修改。


动画适配来源：`noname/library/element/player.js` 的 `$draw`（12006起）、`$throwordered2`（12667起）、`$damagepop`（13660起）、`$damage`（13708起），`noname/game/index.js` 的 `linexy`（4750起），以及 `layout/default/layout.css` 的默认过渡、浮字与线条样式。新版 `web/animation.js`、`web/animation.css`复用这些行为与比例，不引入旧引擎。`/theme/cardback.png`读取原版 `theme/style/cardback/image/xingBei1.png`；牌背继续保留原项目版权和素材说明。
