"""Continuous all-hero league. Any game/interface error stops the whole run."""
import argparse
from datetime import datetime,timezone
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback
from league import history_pool
from telemetry import Telemetry
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('hourly',Path(__file__).with_name('report-all.py'))
hourly=importlib.util.module_from_spec(spec);spec.loader.exec_module(hourly)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);parser.add_argument('--revision',required=True)
    parser.add_argument('--pilot',action='store_true');parser.add_argument('--once',action='store_true')
    args=parser.parse_args();directory=args.directory.resolve();directory.mkdir(parents=True,exist_ok=True)
    lock=open(directory/'lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    state_path=directory/'status.json'
    state=json.loads(state_path.read_text()) if state_path.exists() else dict(status='ready',stage='collect',revision=args.revision,cycle=0,completed_games=0,history=[],last_evaluation=0,best_score=-1)
    if state['revision']!=args.revision:raise ValueError('Immutable rule revision mismatch')
    if state['status']=='error':return
    def save(**changes):
        state.update(changes,updated_at=datetime.now(timezone.utc).isoformat());p=state_path.with_suffix('.tmp');p.write_text(json.dumps(state,indent=2));p.replace(state_path)
    os.environ['XINGBEI_SOURCE_REVISION']=args.revision
    diagnostics=directory/'rule-failures';diagnostics.mkdir(exist_ok=True)
    os.environ['XINGBEI_DIAGNOSTIC_DIR']=str(diagnostics)
    def run(command):
        save(status='running',command=command,started_at=time.time())
        with open(directory/'progress.log','a',buffering=1) as log:
            log.write(f'\n{datetime.now(timezone.utc).isoformat()} {command!r}\n')
            subprocess.run(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)
    python=sys.executable
    with Telemetry(directory):
      try:
        while True:
            if (directory/'PAUSE').exists():save(status='paused');break
            if state['stage']!='collect':
                free=int(subprocess.check_output(['nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits'],text=True).splitlines()[0])
                if free<1800:save(status='waiting_for_gpu');time.sleep(60);continue
            if state['stage']=='collect':
                run(['node','training/entity/collect-all.mjs',str(directory/'corpus'),'12' if args.pilot else '2400'])
                save(stage='bootstrap')
            elif state['stage']=='bootstrap':
                output=directory/'bootstrap.pt'
                if not (output.exists() and Path(str(output)+'.json').exists()): run([python,'training/entity/train.py',str(directory/'corpus/teacher.jsonl'),str(output),'--steps','8' if args.pilot else '12000','--batch','32','--device','cuda'])
                save(stage='train',latest=str(output),best=str(output),history=[str(output)])
            elif state['stage']=='train':
                if time.time()-state['last_evaluation']>=3600:
                    output=directory/f"evaluation-{state['cycle']:06d}-{int(time.time())}.json"
                    run([python,'training/entity/evaluate-all.py',state['latest'],state['best'],str(output),'--revision',args.revision,'--pairs','2' if args.pilot else '144'])
                    report=json.loads(output.read_text());metrics={key:{k:r[k] for k in ['games','wins','win_rate','truncated','paired_seed_interval95']} for key,r in report['opponents'].items()}
                    if any(m['truncated'] for m in metrics.values()):raise RuntimeError('Evaluation truncated; inspect evidence')
                    score=metrics['v1.9.0-preview.1']['win_rate']
                    if score>state['best_score']:state.update(best=state['latest'],best_score=score)
                    save(metrics=metrics,last_evaluation=time.time(),evaluation=str(output));hourly.report(directory)
                cycle=state['cycle']+1;output=directory/f'cycle-{cycle:06d}.pt'
                pool=history_pool(state['history']);history=pool[(cycle-1)%len(pool)] if len(pool)>1 else None
                command=[python,'training/entity/reinforce.py',state['latest'],str(output),'--league','--positions',str(directory/'corpus/positions.jsonl'),
                         '--revision',args.revision,'--games','8' if args.pilot else '192','--workers','16','--batch','32','--epochs','2','--seed','831103000','--device','cuda']
                if history:command+=['--history',history]
                if not (output.exists() and Path(str(output)+'.json').exists()): run(command)
                report=json.loads(Path(str(output)+'.json').read_text())
                # Add fresh genuine boundaries after the successful round only.
                with open(directory/'corpus/positions.jsonl','a') as file:
                    for game in report['games']:
                        for boundary in game.get('boundaries',[]):file.write(json.dumps({**boundary,'sourceSeed':game['seed']})+'\n')
                bank=directory/'corpus/positions.jsonl'
                unique={}
                for line in bank.read_text().splitlines():
                    item=json.loads(line);unique[(item['sourceSeed'],item['category'])]=item
                kept=[]
                for kind in ['ending','middle']:
                    kept.extend([p for p in unique.values() if p['category']==kind][-10000:])
                temporary=bank.with_suffix('.tmp');temporary.write_text(''.join(json.dumps(p)+'\n' for p in kept));temporary.replace(bank)
                history_paths=state['history']+[str(output)]
                save(latest=str(output),cycle=cycle,completed_games=report['completed_total'],history=history_pool(history_paths),
                     hero_coverage=report['hero_coverage'],curriculum=report['curriculum'],rollout=report['rollout'],update=report['update'],status='ready')
                if args.once:break
            else:raise ValueError('Unknown stage')
      except Exception:
        save(status='error',error=traceback.format_exc());hourly.report(directory);raise
      finally:hourly.report(directory)
if __name__=='__main__':main()
