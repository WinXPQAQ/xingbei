# AI 1.6.0-preview.1

用户选择三组对照中的B组用于当前4174体验：新评分规则`experimental/hero-foundation-1` + 原AI 1.5.1网络，没有继续训练。它不是将C组改名：源文件为hero-foundation-211/initial.pt，completed=0，16个参数张量逐项与原AI 1.5.1相同。旧1.5.3-preview.1与1.5.2身份保留。

推理权重为`training/models/ai-1.6.0-preview.1.pt`，SHA-256和组合配置见`training/ai-releases.json`。页面显示`测试 0.6.3 + AI 1.6.0-preview.1`。沿用评测时的greedy与terminal-v1，不添加额外应战后处理。4173不变，训练保持暂停。

B对A胜率49.60%（1008局），B对C为53.57%（1008局）；这是已用种子的诊断对照，不代表晋级或真人强度。细节见`ai-hero-foundation-attribution.md`。

```bash
python training/serve_model.py --checkpoint training/models/ai-1.6.0-preview.1.pt --release 1.6.0-preview.1 --port 4175
MODEL_PORT=4175 TEST_MODE=1 PORT=4174 npm run web
```
