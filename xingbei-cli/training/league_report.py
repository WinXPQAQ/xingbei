"""Verify a completed round robin against raw records and write a readable table."""
import argparse
import hashlib
import itertools
import json
from pathlib import Path
import subprocess
import time
from league import configs
from evaluation_stats import summarize


def report(directory):
    manifest=json.loads((directory/'manifest.json').read_text())
    saved=json.loads((directory/'report.json').read_text())
    names=list(manifest['policies'])
    if saved['state']!='complete' or len(saved['pairs'])!=6:raise ValueError('Incomplete league')
    matrix={n:{} for n in names}
    results=[]
    for left,right in itertools.combinations(names,2):
        rows=[json.loads(line) for line in (directory/f'{left}-vs-{right}.jsonl').read_text().splitlines()]
        expected=configs(manifest['firstSeed'],manifest['seeds'],left,right)
        key=lambda r:(r['seed'],r['lineup'],r['team'],r['start'])
        actual={key(r):r for r in rows}
        if len(actual)!=len(rows) or set(actual)!={key(r) for r in expected}:raise ValueError('Missing/duplicate game')
        for item in expected:
            row=actual[key(item)]
            for field in ('heroIds','seatPolicies','samplingSeed'):
                if item[field]!=row[field]:raise ValueError('Scenario mismatch: '+field)
        a=summarize(rows);b=summarize([{**r,'team':'blue' if r['team']=='red' else 'red'} for r in rows])
        original=next(p for p in saved['pairs'] if p['left']==left and p['right']==right)
        if a!=original['leftResult'] or b!=original['rightResult']:raise ValueError('Reported statistics mismatch')
        matrix[left][right]=a['resolvedWinRate'];matrix[right][left]=b['resolvedWinRate']
        results.append({'left':left,'right':right,'leftResult':a})
    for entry in manifest['policies'].values():
        if entry.get('checkpoint') and hashlib.sha256(Path(entry['checkpoint']).read_bytes()).hexdigest()!=entry['sha256']:
            raise ValueError('Checkpoint changed')
    lines=['# 四组AI交叉对战','',f"每组{manifest['gamesPerPair']}局，共{manifest['totalGames']}局；行对列胜率。新开发种子，不是最终验收。",'',
           '| 行\\列 | '+' | '.join(names)+' |','|---|'+'---|'*len(names)]
    for name in names:
        lines.append('| '+name+' | '+' | '.join('—' if name==other else f'{matrix[name][other]:.2%}' for other in names)+' |')
    lines+=['','v1.5=原版1.5.0；ai151=当前体验版；unbiased=无促进192批；combined=此前提炼/咆哮混合促进192批。','',
            '逐对95%整种子簇区间、分阵容和截断见report.json；六对同时检验未作多重比较校正。不从小幅点估计直接推断显著优越。']
    for result in results:
        a=result['leftResult'];lines.append(f"- {result['left']} 对 {result['right']}：{a['wins']}胜{a['losses']}负，截断{a['truncated']}，95%区间{a['seedCluster95']}")
    (directory/'summary.md').write_text('\n'.join(lines)+'\n')
    (directory/'audit.json').write_text(json.dumps({'state':'passed','pairs':results,'matrix':matrix},indent=2)+'\n')
    print(json.dumps(matrix),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--directory',type=Path,required=True);p.add_argument('--wait-unit');args=p.parse_args()
    if args.wait_unit:
        deadline=time.monotonic()+3600
        while not (args.directory/'report.json').exists():
            state=subprocess.check_output(['systemctl','--user','show',args.wait_unit,'--property=ActiveState','--value'],text=True).strip()
            if state not in ('active','activating') or time.monotonic()>deadline:raise RuntimeError('League exited without final report')
            time.sleep(10)
    report(args.directory)
