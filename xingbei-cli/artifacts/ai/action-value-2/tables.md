
## 完整确认统计

| 候选/对手 | 胜/负/截断 | 得分率 | 簇95%区间 |
|---|---:|---:|---|
| experimental/action-value-2/v1.3 | 150/138/0 | 52.08% | 48.26%–55.56% |
| experimental/action-value-2/v1.2 | 175/113/0 | 60.76% | 57.29%–64.24% |
| experimental/action-value-2/v1.0 | 229/59/0 | 79.51% | 75.00%–84.03% |
| v1.3/v1.3 | 144/144/0 | 50.00% | 50.00%–50.00% |
| experimental/action-value-2/experimental/team-route-2 | 144/144/0 | 50.00% | 43.06%–55.56% |
| experimental/action-value-2-no-projection/v1.3 | 79/65/0 | 54.86% | 52.08%–56.25% |
| experimental/action-value-2-no-tempo/v1.3 | 74/70/0 | 51.39% | 47.92%–54.17% |
| experimental/action-value-2-no-energy/v1.3 | 72/72/0 | 50.00% | 50.00%–50.00% |
| experimental/action-value-2-no-allocation/v1.3 | 73/71/0 | 50.69% | 50.00%–52.08% |

相对同配置v1.3自博弈的配对差（百分点，按完整种子簇抽样）：

| 分组 | 差 | 簇95%区间 |
|---|---:|---|
| all | 2.08% | -1.74%–5.56% |
| mirrorAssault | -4.17% | -9.72%–2.78% |
| mirrorMixed | -4.17% | -9.72%–2.78% |
| asymmetric | 8.33% | -4.17%–19.44% |
| asymmetricReverse | 8.33% | -4.17%–20.83% |

| 完整候选减去消融 | 配对差 | 簇95%区间 |
|---|---:|---|
| experimental/action-value-2-no-projection | -2.78% | -6.25%–0.00% |
| experimental/action-value-2-no-tempo | 0.69% | -2.08%–4.17% |
| experimental/action-value-2-no-energy | 2.08% | 0.00%–4.17% |
| experimental/action-value-2-no-allocation | 1.39% | 0.00%–4.17% |

预登记统计/性能门：通过。通过不代表完整模型正确性，不能单凭胜率允许上线。主项仅6簇，消融3簇；未进行多重比较确认推断。完整阵容/先手/颜色细分见summary.json，全部原始逐局保留。
