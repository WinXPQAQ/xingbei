"""Continuous all-hero league. Any game/interface error stops the whole run."""
import argparse
from datetime import datetime,timezone
import fcntl
import importlib.util
import json
import os
import random
from pathlib import Path
import subprocess
import sys
import time
import traceback
from league import history_pool, opponent_weights
from position_bank import PositionBank
from checkpoint_io import recover_checkpoint
from telemetry import Telemetry
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('hourly',Path(__file__).with_name('report-all.py'))
hourly=importlib.util.module_from_spec(spec);spec.loader.exec_module(hourly)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);parser.add_argument('--revision',required=True)
    parser.add_argument('--pilot',action='store_true');parser.add_argument('--once',action='store_true')
    parser.add_argument('--workers',type=int,default=16)
    parser.add_argument('--batch',type=int,default=32)
    parser.add_argument('--bootstrap-steps',type=int,default=12000)
    parser.add_argument('--round-games',type=int,default=192)
    args=parser.parse_args();directory=args.directory.resolve();directory.mkdir(parents=True,exist_ok=True)
    if min(args.workers,args.batch,args.bootstrap_steps,args.round_games)<1:
        parser.error('workers, batch, bootstrap-steps and round-games must be positive')
    configuration=dict(workers=args.workers,batch=args.batch,
        bootstrap_steps=8 if args.pilot else args.bootstrap_steps,
        round_games=8 if args.pilot else args.round_games,pilot=args.pilot)
    lock=open(directory/'lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    state_path=directory/'status.json'
    state=json.loads(state_path.read_text()) if state_path.exists() else dict(status='ready',stage='collect',revision=args.revision,cycle=0,completed_games=0,history=[],last_evaluation=0,best_score=-1)
    if state['revision']!=args.revision:raise ValueError('Immutable rule revision mismatch')
    if state.get('configuration',configuration)!=configuration:
        raise ValueError('Run configuration changed; start an explicitly recorded experiment')
    state['configuration']=configuration
    if state['status']=='error':return
    def save(**changes):
        state.update(changes,updated_at=datetime.now(timezone.utc).isoformat());p=state_path.with_suffix('.tmp');p.write_text(json.dumps(state,indent=2));p.replace(state_path)
    os.environ['XINGBEI_SOURCE_REVISION']=args.revision
    diagnostics=directory/'rule-failures';diagnostics.mkdir(exist_ok=True)
    os.environ['XINGBEI_DIAGNOSTIC_DIR']=str(diagnostics)
    def run(command):
        log_path=directory/'progress.log'
        while True:
            save(status='running',command=command,started_at=time.time(),resource_error=None)
            with open(log_path,'a',buffering=1) as log:
                log.write(f'\n{datetime.now(timezone.utc).isoformat()} {command!r}\n')
                offset=log.tell()
                result=subprocess.run(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
            if result.returncode==0:return
            with open(log_path,'rb') as log:
                log.seek(max(offset,log_path.stat().st_size-32768))
                failure=log.read().decode('utf-8',errors='replace')
            cuda_oom=any(line.startswith(('torch.OutOfMemoryError: CUDA out of memory',
                                          'torch.cuda.OutOfMemoryError: CUDA out of memory'))
                         for line in failure.splitlines())
            if not cuda_oom:
                raise subprocess.CalledProcessError(result.returncode,command)
            # A failed CUDA allocation is a resource wait. Rule/interface errors
            # still propagate to the global stop and retain their diagnostics.
            save(status='waiting_for_gpu',resource_error=failure[-4000:],retry_after_seconds=60)
            time.sleep(60)
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
                if not recover_checkpoint(output): run([python,'training/entity/train.py',str(directory/'corpus/teacher.jsonl'),str(output),'--steps',str(configuration['bootstrap_steps']),'--batch',str(args.batch),'--device','cuda'])
                save(stage='train',latest=str(output),best=str(output),history=[str(output)])
            elif state['stage']=='train':
                if time.time()-state['last_evaluation']>=3600:
                    output=directory/f"evaluation-{state['cycle']:06d}-{int(time.time())}.json"
                    run([python,'training/entity/evaluate-all.py',state['latest'],state['best'],str(output),'--revision',args.revision,'--pairs','2' if args.pilot else '144','--workers',str(args.workers)])
                    report=json.loads(output.read_text());metrics={key:{k:r[k] for k in ['games','wins','win_rate','truncated','paired_seed_interval95']} for key,r in report['opponents'].items()}
                    if any(m['truncated'] for m in metrics.values()):raise RuntimeError('Evaluation truncated; inspect evidence')
                    score=metrics[report['rule_opponent']]['win_rate']
                    if score>state['best_score']:state.update(best=state['latest'],best_score=score)
                    save(metrics=metrics,rule_opponent=report['rule_opponent'],last_evaluation=time.time(),
                         evaluated_checkpoint=report['checkpoint'],evaluation=str(output));hourly.report(directory)
                cycle=state['cycle']+1;output=directory/f'cycle-{cycle:06d}.pt'
                # Always sample across the complete checkpoint chronology.
                # Repeatedly thinning the already-thinned pool pins old versions.
                archive=sorted(str(path) for path in directory.glob('cycle-*.pt')
                               if path != Path(state['latest']) and Path(str(path)+'.json').exists())
                history_candidates=list(dict.fromkeys(state.get('history_seeds', [])+archive))
                pool=history_pool(history_candidates or [path for path in state['history'] if path!=state['latest']])
                league_results=state.get('league_results', {})
                history=(random.Random(831103000+cycle).choices(pool,
                    weights=opponent_weights(pool,league_results),k=1)[0] if pool else None)
                command=[python,'training/entity/reinforce.py',state['latest'],str(output),'--league','--positions',str(directory/'corpus/positions.jsonl'),
                         '--revision',args.revision,'--games',str(configuration['round_games']),'--workers',str(args.workers),'--batch',str(args.batch),'--epochs','2','--device','cuda']
                # A resumed experiment owns its sampling seed and RNG state.
                # Only the first reinforcement round supplies the legacy default.
                if not state.get('learning'):
                    command+=['--seed','831103000']
                if history:command+=['--history',history]
                if not recover_checkpoint(output): run(command)
                report=json.loads(Path(str(output)+'.json').read_text())
                if history:
                    record=league_results.setdefault(history,dict(games=0,wins=0))
                    for game in report['games']:
                        if game.get('opponent') != 'model:history' or not game['terminated']:
                            continue
                        side='red' if 0 in game['learnerSeats'] else 'blue'
                        record['games']+=1
                        record['wins']+=int(game['winner']==side)
                PositionBank(directory/'corpus/positions.jsonl').merge(report['games'])
                history_paths=history_candidates+[str(output)]
                save(latest=str(output),cycle=cycle,completed_games=report['completed_total'],history=history_pool(history_paths),
                     league_results=league_results,
                     learning=report.get('learning'),architecture=report.get('architecture'),
                     hero_coverage=report['hero_coverage'],curriculum=report['curriculum'],rollout=report['rollout'],update=report['update'],status='ready')
                if args.once:break
            else:raise ValueError('Unknown stage')
      except Exception:
        save(status='error',error=traceback.format_exc());hourly.report(directory);raise
      finally:hourly.report(directory)
if __name__=='__main__':main()
