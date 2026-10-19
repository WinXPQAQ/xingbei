
## 完整确认统计

| 候选/对手 | 胜/负/截断 | 得分率 | 簇95%区间 |
|---|---:|---:|---|
| experimental/action-value-1/v1.3 | 135/153/0 | 46.88% | 41.32%–52.08% |
| experimental/action-value-1/v1.2 | 185/103/0 | 64.24% | 60.07%–68.40% |
| experimental/action-value-1/v1.0 | 228/60/0 | 79.17% | 74.65%–83.68% |
| v1.3/v1.3 | 144/144/0 | 50.00% | 50.00%–50.00% |
| experimental/action-value-1/experimental/economy-capability-1 | 116/172/0 | 40.28% | 34.72%–46.18% |
| experimental/action-value-1-no-draws/v1.3 | 81/63/0 | 56.25% | 52.08%–62.50% |
| experimental/action-value-1-no-tempo/v1.3 | 72/72/0 | 50.00% | 45.83%–56.25% |
| experimental/action-value-1-no-energy/v1.3 | 70/74/0 | 48.61% | 35.42%–58.33% |
| experimental/action-value-1-no-allocation/v1.3 | 68/76/0 | 47.22% | 37.50%–54.17% |

相对同配置v1.3自博弈的配对差（百分点，按完整种子簇抽样）：

| 分组 | 差 | 簇95%区间 |
|---|---:|---|
| all | -3.13% | -8.68%–2.08% |
| mirrorAssault | -1.39% | -16.67%–13.89% |
| mirrorMixed | -13.89% | -23.61%–-4.17% |
| asymmetric | -11.11% | -22.22%–-1.39% |
| asymmetricReverse | 13.89% | 4.17%–23.61% |

| 完整候选减去消融 | 配对差 | 簇95%区间 |
|---|---:|---|
| experimental/action-value-1-no-draws | -7.64% | -25.00%–2.08% |
| experimental/action-value-1-no-tempo | -1.39% | -8.33%–4.17% |
| experimental/action-value-1-no-energy | 0.00% | -2.08%–2.08% |
| experimental/action-value-1-no-allocation | 1.39% | -2.08%–6.25% |

预登记统计/性能门：未通过。通过不代表完整模型正确性，不能单凭胜率允许上线。主项仅6簇，消融3簇；未进行多重比较确认推断。完整阵容/先手/颜色细分见summary.json，全部原始逐局保留。
