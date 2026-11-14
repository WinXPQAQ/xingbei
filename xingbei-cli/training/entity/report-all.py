"""Hourly local report. Never clears errors or restarts failed rules."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import subprocess

def report(directory):
    state=json.loads((directory/'status.json').read_text())
    progress=directory/'corpus/collection-progress.json'
    if progress.exists(): state['collection']=json.loads(progress.read_text())
    rows=[]
    gpu=directory/'gpu.log'
    if gpu.exists():
        cutoff=datetime.now(timezone.utc).timestamp()-3600
        for line in gpu.read_text().splitlines()[-30000:]:
            try:
                row=json.loads(line)
                if row['time']>=cutoff:rows.extend(row['processes'])
            except (ValueError,KeyError):pass
    summary=dict(status=state,generated_at=datetime.now(timezone.utc).isoformat(),
                 gpu=dict(samples=len(rows),mean_sm=sum(r['sm'] for r in rows)/len(rows) if rows else None,
                          peak_memory_mib=max((r['memory'] for r in rows),default=0)))
    folder=directory/'hourly';folder.mkdir(exist_ok=True)
    (folder/(datetime.now(timezone.utc).strftime('%Y%m%d-%H')+'.json')).write_text(json.dumps(summary,indent=2))
    (directory/'latest-report.json').write_text(json.dumps(summary,indent=2))
    metrics=state.get('metrics',{})
    text=f"状态：{state.get('status')}\n阶段：{state.get('stage')}\n完成强化局数：{state.get('completed_games',0)}\n轮次：{state.get('cycle',0)}\nGPU样本：{summary['gpu']}\n开发评测：{metrics}\n"
    text+=f"训练规则：{state.get('rule_variant','standard')}\n正式规则参考（不用于选模）：{state.get('standard_reference', '尚未评测')}\n"
    text+=f"训练累计无法行动判负：{state.get('inability_forfeits',0)}（完整留档，计入输赢，不因此停训）\n"
    if state.get('opponent_counts'):
        text+=f"最近陪练配比：{state['opponent_counts']}\n"
    for opponent, values in state.get('opponent_results',{}).items():
        rate=values['wins']/max(1,values['games']) if opponent!='self' else None
        text+=f"陪练累计（在线训练，非独立评测）：{opponent} {values} 胜率{rate}\n"
    if state.get('legacy_coverage'):
        text+=f"旧评分适配覆盖（含当前策略回退）：{state['legacy_coverage']}\n"
    if state.get('collection'):
        c=state['collection'];text+=f"教师采集：{c['completed']}/{c['games']}局；每英雄至少{c['coverageMinimum']}次\n"
        sampling = c.get('sampling')
        if sampling:
            text += (f"教师样本：观察{sampling['observed']}条，保留{sampling['retained']}条，"
                     f"完整选择链{sampling['retainedChains']}条，超预算链{sampling['omittedChains']}条\n")
    if state.get('rollout'):
        r=state['rollout'];text+=f"最近采样：{r['games_per_second']:.2f}局/秒，{r['decisions_per_second']:.0f}决策/秒，平均推理批次{r['mean_batch']:.1f}\n"
        if 'engine_requests_per_second' in r:
            text += f"全座位新引擎请求：{r['engine_requests_per_second']:.1f}次/秒（已扣除残局重放前缀）\n"
        forced = r.get('forced_choices', 0)
        text += f"单候选免推理：{forced}次，占模型席位选择{forced/max(1, forced+r['decisions']):.1%}\n"
    if state.get('learning'):
        method=state['learning']
        text += (f"学习配置：{method.get('learning_signal', 'mc')}，士气权重{method.get('morale_weight', 0)}，"
                 f"独立更新{method.get('independent_updates', False)}，课程{method.get('curriculum', 'scheduled')}\n")
    if state.get('architecture'):
        model=state['architecture']
        text += f"网络配置：宽度{model['width']}，每个网络{model['layers']}层\n"
    if state.get('curriculum'):
        text += f"最近实际课程：{state['curriculum']}\n"
    update = state.get('update', {})
    if update.get('samples'):
        text += (f"最近更新：{update['samples']}条轨迹样本，{update['sample_visits']}次更新访问，"
                 f"近似KL {update['approx_kl']:.5f}，裁剪比例{update['clip_fraction']:.1%}\n")
        for kind, values in sorted(update.get('by_decision_type', {}).items()):
            text += (f"  {kind}：{values['samples']}条（{values['sample_fraction']:.1%}），"
                     f"策略损失{values['policy_loss']:.4f}，价值损失{values['value_loss']:.4f}\n")
        if update.get('stopped_early'):
            text += f"策略更新达到配置的KL上限，停止值{update['stopping_kl']:.5f}\n"
        if 'actor_updates' in update:
            text += (f"独立更新计数：策略{update['actor_updates']}次，价值{update['critic_updates']}次；"
                     f"归一化策略熵{update['normalized_entropy']:.3f}\n")
        for phase, values in update.get('rollout_value_by_phase', {}).items():
            label = '风格回报预测' if values.get('value_semantics') == 'style_return' else '终局价值预测'
            text += f"  {phase}{label}：{values['samples']}条，采集时MSE {values['mse']:.4f}\n"
        for opponent, values in update.get('learner_samples_by_opponent', {}).items():
            text += f"  陪练{opponent}学习样本：{values['samples']}条（{values['fraction']:.1%}）\n"
        critic = update.get('critic')
        if critic:
            text += (f"价值来源留出：训练{critic['train_sources']}局，验证{critic['validation_sources']}局；"
                     f"尝试{critic['updates']}次更新，采用第{critic['best_update']}次\n")
            if critic.get('validation_after'):
                values = critic['validation_after']
                if values.get('value_semantics') == 'style_return':
                    text += f"  风格回报留出MSE {values['mse']:.4f}\n"
                else:
                    text += (f"  留出Brier {values['brier']:.4f}，NLL {values['nll']:.4f}，"
                             f"校准误差ECE {values['ece']:.4f}\n")
    if state.get('latest'):
        text += f"最新检查点：{state['latest']}\n"
    if state.get('evaluated_checkpoint'):
        text += f"最近评测检查点：{state['evaluated_checkpoint']}\n"
    if metrics:
        rate=state.get('selection_metric',{}).get('mean_win_rate',metrics[state.get('rule_opponent','v1.9.0-preview.1')]['win_rate']);best=state.get('best_score',rate)
        text+=f"开发趋势：固定陪练开发选模均值{rate:.1%}，历史最佳{best:.1%}；重复开发种子，不能视为独立强度验收。\n"
    if state.get('error'):text+='异常已停训，等待判断；错误：'+state['error']+'\n'
    (directory/'latest-report.txt').write_text(text)
    return summary
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);args=parser.parse_args();report(args.directory)
