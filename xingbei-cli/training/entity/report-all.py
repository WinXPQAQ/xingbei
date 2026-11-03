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
    if state.get('collection'):
        c=state['collection'];text+=f"教师采集：{c['completed']}/{c['games']}局；每英雄至少{c['coverageMinimum']}次\n"
    if state.get('rollout'):
        r=state['rollout'];text+=f"最近采样：{r['games_per_second']:.2f}局/秒，{r['decisions_per_second']:.0f}决策/秒，平均推理批次{r['mean_batch']:.1f}\n"
    if metrics:
        rate=metrics['v1.9.0-preview.1']['win_rate'];best=state.get('best_score',rate)
        text+=f"开发趋势：当前对规则胜率{rate:.1%}，历史最佳{best:.1%}；重复开发种子，不能视为独立强度验收。\n"
    if state.get('error'):text+='异常已停训，等待判断；错误：'+state['error']+'\n'
    (directory/'latest-report.txt').write_text(text)
    return summary
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);args=parser.parse_args();report(args.directory)
