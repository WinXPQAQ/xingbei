# AI 1.5.3 测试版：已完成，未晋级

192批、4608局训练结束。固定确认结果：对旧纯规则v1.5为559/1008（55.46%，种子簇95%区间52.28%–58.63%）；对旧混合AI 1.5.1为463/1008（45.93%，43.25%–48.71%）。两组均零截断。没有达到同时超过两个旧版本的晋级条件，不能称为胜率提升后的新基线。原始记录见hero-foundation-confirmation。

用户随后要求上传并手动体验最新AI，因此以`1.5.3-preview.1`登记、页面显示“AI 1.5.3-测试版”。候选分支发布，不更改main的正式基线或4173。4174更新为本次真实新规则与第192批网络，未加评测之外的应战后处理。旧1.5.2版本身份和模型保留，可回退。

推理权重：`training/models/ai-1.5.3-preview.1.pt`；完整优化器、随机状态和恢复检查点仍保存在本机运行目录。权重和源码版本的对应关系见`training/ai-releases.json`。

运行（需要已有PyTorch环境）：

```bash
python training/serve_model.py --checkpoint training/models/ai-1.5.3-preview.1.pt --release 1.5.3-preview.1 --port 4175
MODEL_PORT=4175 TEST_MODE=1 HOST=0.0.0.0 PORT=4174 npm run web
```

页面版本由应用package版本及实际推理服务身份共同生成，不按浏览器缓存或手工假定模型版本。浏览器用服务声明的基础策略生成输入，推理服务再次校验baseline身份。
