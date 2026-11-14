"""Render the fixed pilot's evidence; never select a checkpoint or tune a policy."""
import argparse
import csv
import hashlib
import json
import pathlib

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from schedule import TEAMS

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path.home() / '.local/share/xingbei-ml')
parser.add_argument('--output', type=pathlib.Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
seeds = [41, 73, 107]
training, final = {}, {}
for seed in seeds:
    training[seed] = [json.loads(line) for line in (args.root / f'runs/pilot-v2-{seed}/metrics.jsonl').read_text().splitlines()]
    final[seed] = json.loads((args.root / f'evaluations/final-{seed}/report.json').read_text())
    if [row['iteration'] for row in training[seed]] != list(range(32)):
        raise ValueError('Incomplete or duplicated training budget')
    if final[seed]['manifest']['firstSeed'] != 240000000 or final[seed]['manifest']['seeds'] != 12:
        raise ValueError('Unexpected final evaluation partition')

benchmark = json.loads((args.root / 'evidence/cpu-gpu-model-benchmark.json').read_text())
gpu = json.loads((args.root / 'evidence/torch-cuda-check.json').read_text())
privacy = json.loads((args.root / 'evidence/audit-private.json').read_text())
rows = []
fig, axes = plt.subplots(2, 2, figsize=(12, 8), constrained_layout=True)
for seed in seeds:
    fixed_wins, fixed_games = [], []
    for entry in training[seed]:
        eligible = [game for game in entry['games'] if game['seatPolicies'].count('model') in (1, 3)]
        wins = sum(game['winner'] == TEAMS[game['seatPolicies'].index('model')] for game in eligible)
        fixed_wins.append(wins); fixed_games.append(len(eligible))
        rows.append({'seed': seed, 'iteration': entry['iteration'], 'phase': entry['phase'],
                     'loss': entry['loss'], 'seconds': entry['seconds'], 'decisionsUsed': entry['decisionsUsed'],
                     'trainingFixedOpponentWins': wins, 'trainingFixedOpponentGames': len(eligible)})
    rolling = [100 * sum(fixed_wins[max(0, index - 3):index + 1]) / max(1, sum(fixed_games[max(0, index - 3):index + 1])) for index in range(32)]
    axes[0, 0].plot(range(4, 32), rolling[4:], label=str(seed))
    axes[0, 1].plot(range(4, 32), [row['loss'] for row in training[seed][4:]], label=str(seed))
    axes[1, 0].plot(range(32), [row['seconds'] for row in training[seed]], label=str(seed))
axes[0, 0].set(title='Training wins vs fixed opponents (4-batch mean)', ylabel='Win rate (%)', xlabel='Update')
axes[0, 0].legend(title='Training seed')
axes[0, 1].set(title='PPO optimization loss (not playing strength)', xlabel='Update', ylabel='Loss')
axes[1, 0].set(title='Sampling and optimization wall time', xlabel='Update', ylabel='Seconds')
axes[1, 0].axvspan(0, 3, alpha=0.1, color='gray')
rates = [final[seed]['team']['resolvedWinRate'] * 100 for seed in seeds]
lower = [rates[index] - final[seed]['team']['seedCluster95'][0] * 100 for index, seed in enumerate(seeds)]
upper = [final[seed]['team']['seedCluster95'][1] * 100 - rates[index] for index, seed in enumerate(seeds)]
axes[1, 1].bar([str(seed) for seed in seeds], rates, yerr=[lower, upper], capsize=5)
axes[1, 1].axhline(50, color='gray', linestyle='--', label='50% parity reference')
axes[1, 1].set(title='Final team evaluation vs v1.5', xlabel='Training seed', ylabel='Win rate (%)', ylim=(0, 60))
axes[1, 1].legend()
fig.suptitle('Offline six-hero pilot: terminal team reward only')
fig.savefig(args.output / 'learning-curves.svg')
fig.savefig(args.output / 'learning-curves.png', dpi=160)
plt.close(fig)
with (args.output / 'learning-curves.csv').open('w', newline='') as stream:
    writer = csv.DictWriter(stream, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)

total_games = sum(len(row['games']) for values in training.values() for row in values)
decisions = sum(row['decisionsUsed'] for values in training.values() for row in values)
seconds = sum(row['seconds'] for values in training.values() for row in values)
results = []
for seed in seeds:
    team, mixed, paired = (final[seed][name] for name in ('team', 'mixed', 'mixedPaired'))
    results.append(f"种子 {seed}：整队 {team['wins']}胜/{team['losses']}负，胜率 {team['resolvedWinRate']:.2%}，按种子分组95%区间 {team['seedCluster95'][0]:.2%}–{team['seedCluster95'][1]:.2%}；混合队友胜率 {mixed['resolvedWinRate']:.2%}，相对配对v1.5对照差 {paired['resolvedMeanWinRateDifference'] * 100:+.2f} 个百分点。")
diagnostics = []
for seed in seeds:
    cases = [case for case in final[seed]['knownDiagnosticsNotHoldout'] if not case['reversedHand']]
    diagnostics.append(f"种子 {seed}：有普通水时选择普通水的概率 {cases[0]['preferredProbability']:.1%}；只有水封印攻击牌能保命时，使用它的概率 {cases[1]['preferredProbability']:.1%}。")
summary = {'trainingGames': total_games, 'learningDecisions': decisions, 'trainingWallSeconds': seconds,
           'parameters': benchmark['parameters'], 'gpu': gpu, 'privacy': privacy,
           'final': {str(seed): {key: final[seed][key] for key in ('team', 'mixed', 'mixedPaired', 'byLineup', 'knownDiagnosticsNotHoldout')} for seed in seeds}}
(args.output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')

text = f'''本轮结论：离线训练、保存恢复、六英雄完整对局和独立评测已跑通；当前模型明显弱于 v1.5，不应替换线上 AI。胜率没有达到晋级水平，报告不把“代码跑通”描述成“训练出了强 AI”。

规则与基线固定为 d1560abd1be87b1aa5a56a33f550903508d23ac2，稳定对照 v1.5。工作位于 /home/xp/xingbei-ml，分支 codex/ml-terminal-reward；未向 main 推送，未改线上默认 AI。基础规则仅增加行动在启动后失效的可识别错误标记，以便重新选择；旧策略源码不变。

模型为六英雄共享的 {benchmark['parameters']:,} 参数 actor/critic。输入是语义特征和合法候选动作，各座位独立维护自己的观测摘要；不读取其他玩家手牌、牌序或测试日志，不把牌实体 ID 作为特征。输入采用固定特征哈希，当前状态2048维、座位记忆2048维、候选512维；存在哈希冲突和细粒度关系表达不足的限制，不能称其已经理解规则。候选来自规则，不按旧AI分数筛选，不会静默回退给旧AI。

强化学习只用终局团队胜利+1、失败−1，gamma=1。每个座位的决定均用本队终局结果计算蒙特卡洛回报；PPO使用裁剪概率比和价值拟合。没有命中、伤害、士气、留牌等奖励，也没有熵奖金。截断不会计为平局或奖励0；不完整轨迹被排除并单独报告，这一做法在高截断率下会有选择偏差。本轮正式试训和最终评测均无截断。

固定试训预算为三个模型种子41/73/107，每个32批、每批24局、每批优化3轮，每次限制15分钟、8GB cgroup内存和800% CPU配额；前4批仅做可撤除的v1.5示范热身，随后28批PPO。每批更新前冻结采样策略；训练混合了自博弈、整队对旧策略，以及只有一名模型玩家搭配旧策略队友，固定策略池为v1.5和v1.4。没有训练六种风格，也没有复杂搜索。

正式试训共 {total_games:,} 局、{decisions:,} 次用于学习的决定，三个运行的采样和优化合计约 {seconds / 60:.2f} 分钟。这包括示范数据，不等于同样数量的独立对局。每个种子只有768局，数据预算仍很小。曾有一次输入版本1的试训在发现圣光响应携带多余目标字段后停止，旧目录 runs/pilot-41 原样保留；最终使用输入版本2与新的训练种子区间。不能删掉这次尝试后声称从未出现问题。

训练/调参/诊断/最终评测种子明确分开，详见 training/protocol.json。最终保留的240000000–240000011共12个种子，在全部训练完成并冻结最后检查点后使用；七种阵容配置、红蓝两侧、先手0/1号、整队及混合队友模式全部覆盖。每个模型有336局整队、336局混合和336条配对基准对照记录，三个模型合计执行3024局。对照在颜色和模型之间有重复，换边局、阵容局和重复对照不能算独立种子；区间按整组种子重采样，各模型分别报告，不把三组结果合成“36个独立最终种子”。混合队友的六英雄覆盖来自全部阵容：默认六英雄阵容中，单模型座位与轮换相关，神箭手和神官没有作为唯一模型玩家出现；它们在镜像阵容中有覆盖。本轮不补抽最终样本来掩盖这一限制。12组仍然偏少，且同一物理服务器的时间不是通用训练时间保证。

{chr(10).join(results)}

最终测试仅支持“当前模型明显较弱”，不能据此证明终局奖励不可行，也不能保证单纯加长训练就会改善。当前没有保留示范结束时的独立模型对照，所以不能把任何改善单独归因于PPO。不能再用这批最终种子作为下一轮新留出。

封印师案例是事先已知诊断，不是独立泛化证据。通过真实结算验证：两组局面中不响应均会立即输。第一组同时有普通水与带水封印独有技的攻击牌；第二组只有后者可应战；两组都反转手牌顺序。
{chr(10).join(diagnostics)}
两个模型的最高分选择是保留水封印，一个模型仍优先消耗它。采样策略仍有犯错概率，不能说该问题已经解决。三个模型在必须消耗它保命时都倾向应战；反转手牌顺序后结果一致。

硬件已核实为RTX 4090 48GB，NVML总显存49140 MiB。原问题是内核驱动595.91.07与系统用户库595.99.02不一致。没有重启机器，也没有替换系统驱动；从Ubuntu签名快照取出匹配库，只为本任务子进程设置库路径。CUDA上下文、显存传输、PyTorch矩阵乘法以及模型CPU/GPU数值接近检查均通过。training/gpu_python.py 优先使用正常系统库，只有系统查询失败且本地库与当前内核版本严格匹配时才使用隔离库。重启后的系统库恢复正常时，不会继续强行加载旧库。

CPU版与GPU版PyTorch使用独立虚拟环境，生产Node服务仍零第三方依赖。GPU环境为 {gpu['torch']}，CUDA运行时 {gpu['cudaRuntime']}。GPU压力测试用真实合法的924候选爆牌场景，批量128完成前向、反向和Adam更新，峰值张量分配 {benchmark['trainingStress']['peakAllocatedBytes'] / 2**20:.1f} MiB，缓存保留 {benchmark['trainingStress']['peakReservedBytes'] / 2**20:.1f} MiB；这不包括全部驱动上下文开销，也不是所有未来模型的显存需求。该显卡足够本原型，当前不需要购买硬件。

吞吐证据见 evidence/ipc-benchmark.json 和 evidence/cpu-gpu-model-benchmark.json。模拟+JSON通信的随机策略测试中，单进程约1075次决策/秒，8进程约4187次/秒；这不包括网络学习。模型微测只测已编码张量的前向计算，不含编码、通信和传输，不能用来直接推算每小时训练局数。实际推理批次均值约2，尚未充分利用GPU；后续重点应是更多并行环境、减少重复JSON与哈希编码、集中批量推理，再考虑扩大模型。

此外，原CPU检查点复制到独立GPU验证目录后完成额外训练，并从GPU检查点再次恢复；这些验证局不参与正式试训胜率或最终评测，原三个最终检查点未覆盖。恢复会检查输入schema与关键训练日程，保存模型、优化器、CPU/CUDA随机状态以及源文件哈希。代码修正了CUDA RNG状态加载后需移回CPU再恢复的设备问题；它不影响此前CPU试训或最终评测。

功能证据包括251项Node测试、Python模型掩码/座位记忆/保存恢复测试、评测配对与截断统计测试。36局自然决策中完成 {privacy['comparisons']} 次隐藏信息反事实比较，覆盖六座位和12类实际决策；没有发现模型输入受他人隐藏手牌或牌序影响。牌实例守恒在对局过程中检查，错误和未知决策直接报错。另用独立复算脚本核对3024条对局的日程、团队奖励、冻结检查点哈希和分组胜率；见 evidence/audit-final.json。最终审查还为他人启动阶段预留费用增加拒绝编码的检查：当前六英雄仅神官在自己的启动阶段询问，正式数据不受影响；未来扩展不能将他人的行动计划传给响应者。这些是当前六英雄范围的工程证据，不是对所有未来英雄和任意代码扩展的安全证明。

建议下一轮继续保留终局奖励：先扩大和检查模仿数据，保存“仅模仿”检查点作为独立对照，验证模型能否拟合老师的关键选择；再用同样预算比较“仅模仿”“模仿+PPO”和必要的无热身对照。改进结构化牌/目标编码、事件记忆和采样吞吐，用调参集选择设置，然后重新预留最终种子。不要根据本轮最终集反复调权重，不要上线当前模型。

复现位置（所有命令从 /home/xp/xingbei-ml/xingbei-cli 执行）：
  npm test
  node training/audit-private.mjs
  python3 training/audit-final.py
  /home/xp/.local/share/xingbei-ml/venv/bin/python training/model_test.py
  python3 training/evaluation_test.py
  bash training/run-pilot.sh
  python3 training/gpu_python.py training/benchmark_model.py --checkpoint /home/xp/.local/share/xingbei-ml/runs/pilot-v2-41/checkpoint.pt
  /home/xp/.local/share/xingbei-ml/venv/bin/python training/evaluate.py --checkpoint /home/xp/.local/share/xingbei-ml/runs/pilot-v2-41/checkpoint.pt --output /home/xp/.local/share/xingbei-ml/evaluations/reproduction-41 --first-seed 240000000 --seeds 12 --workers 4
最后一条仅为已用最终集的复现，不能称新留出。评测拒绝覆盖已有输出目录。run-pilot.sh 对已完成检查点会恢复后直接结束，不会重复追加预算；从头重做需使用新的输出目录或明确保留、迁移旧目录。

GPU从CPU检查点恢复的实际命令：
  python3 training/gpu_python.py training/train.py --device cuda --output /home/xp/.local/share/xingbei-ml/runs/gpu-resume-verification --resume /home/xp/.local/share/xingbei-ml/runs/pilot-v2-41/checkpoint.pt --seed 41 --first-seed 220400000 --updates 33 --warmup 4 --games 24 --workers 4 --threads 2 --epochs 3
GPU到GPU再次恢复时将--resume指向gpu-resume-verification/checkpoint.pt，--updates设34。不要将这些验证检查点冒充固定预算的最终模型。

依赖完整版本固定在 training/requirements-cpu.txt、requirements-gpu.txt、requirements-analysis.txt。新建各自的 Python 3.14 虚拟环境后用 python -m pip install -r 对应文件安装；CPU、GPU和报告绘图环境保持独立。GPU启动器默认查找本报告所列本地环境，签名索引和匹配库已留存。

数据与模型根目录：{args.root}
  runs/pilot-v2-41、pilot-v2-73、pilot-v2-107：检查点和32批原始记录
  evaluations/final-41、final-73、final-107：逐局记录、冻结清单、分组区间和诊断
  evidence：环境、基准、测试、资源、隐私反事实与GPU验证记录
  gpu-diagnostic：Ubuntu签名索引、校验信息和隔离库
本目录中的 summary.json、learning-curves.csv、learning-curves.svg/png 提供汇总和学习曲线。训练曲线使用训练对手池且局面每批不同，不能代替独立胜率证据；优化损失下降也不等于棋力提高。

驱动包来源与校验依据：
  https://snapshot.ubuntu.com/ubuntu/20261001T000000Z/dists/resolute-updates/InRelease
  libnvidia-compute-595 595.91.07-0ubuntu0.26.04.1
  SHA256 bd3bc296e9cc3a520f0056159e49c9e1b0725040aec883f108126f4fa2a8fb60
  NVIDIA NVML接口说明：https://docs.nvidia.com/deploy/nvml-api/nvml-api-reference.html
'''
(args.output / 'report.txt').write_text(text)
paths = [args.root / f'runs/pilot-v2-{seed}/checkpoint.pt' for seed in seeds]
paths += [args.root / f'runs/pilot-v2-{seed}/metrics.jsonl' for seed in seeds]
paths += [args.root / f'evaluations/final-{seed}/games.jsonl' for seed in seeds]
paths += [args.root / f'evaluations/final-{seed}/report.json' for seed in seeds]
paths += [args.root / 'evidence' / name for name in ['audit-private.json', 'audit-final.json', 'cpu-gpu-model-benchmark.json', 'torch-cuda-check.json']]
paths += [path for path in args.output.iterdir() if path.name != 'manifest.json']
manifest = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
(args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'report': str(args.output / 'report.txt'), 'trainingGames': total_games, 'learningDecisions': decisions}, ensure_ascii=False))
