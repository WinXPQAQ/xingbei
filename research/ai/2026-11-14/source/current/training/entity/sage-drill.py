"""Fixed two-card self-codex exercise. Independent critic predicts exercise return, not win probability."""
import argparse
import collections
import copy
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import random
import time
import traceback
import torch
from model import EntityPolicy
from pool import GameRuntime
from learning import make_optimizers, restore_optimizers
from reinforce import update
from checkpoint_io import save_checkpoint, recover_checkpoint
from telemetry import Telemetry

CONTRACT = 'entities-v7+public-damage-plan-v1'
EXERCISE = 'sage-self-codex-v1'
POISON_EXERCISE = 'sage-poison-turn-v1'
CONDITIONING_CONTRACT = 'own-morale-budget-v1'
SUSTAIN_CONTRACT = 'initial-gems-and-retention-bonus-v1'

def write(path, value):
    temporary = path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.replace(path)

def migrate(checkpoint):
    # Same numeric wire/schema; explicit new observation contract and vocabulary.
    # Old files stay intact. New tokens can change attention even with zero weights.
    result = copy.deepcopy(checkpoint)
    additions = sorted({'kind=pendingDamage', 'number:depth', 'number:order', 'number:amount',
                        'ref:actor', 'ref:target', 'skill=arcaneCodex', 'skill=spellRebound',
                        'objective=enemyMoraleLoss','number:maxOwnMoraleLoss','number:ownMoraleLossSoFar',
                        'number:initialGems','number:gemRetentionBonus','number:rewardScale'} - set(result['symbols']))
    original = len(result['symbols'])
    result['symbols'] += additions
    result['config']['vocabulary_size'] = len(result['symbols'])
    for name in ('actor.features.weight','actor.roles.weight','critic.features.weight','critic.roles.weight'):
        old = result['state'][name]
        expanded = old.new_zeros((len(result['symbols']), old.shape[1]))
        expanded[:original] = old
        result['state'][name] = expanded
    result['observation_contract'] = CONTRACT
    # A team's win value is not a damage estimate; reset only the value head.
    model, vocab = EntityPolicy.restore(result)
    if checkpoint.get('observation_contract') != CONTRACT:
        for module in model.value.modules():
            if isinstance(module, torch.nn.Linear): module.reset_parameters()
    return model, vocab

def configurations(offset, count, evaluation=False, exercise=EXERCISE, rehearsal_fraction=0., sustain=False):
    configs=[]
    for i in range(count):
        kind=EXERCISE if not evaluation and i<int(count*rehearsal_fraction) else exercise
        paired = sustain and kind==POISON_EXERCISE
        base=(3400000000 if evaluation else 3100000000)+(100000000 if kind==POISON_EXERCISE else 0)
        if paired and not evaluation: base+=100000000
        initial_gems=1+((offset+i)//4)%2 if paired else 2
        configs.append(dict(exercise=kind,seed=base+(offset+i)//(8 if paired else 4) if kind==POISON_EXERCISE else base+offset+i,decisionLimit=256,
            lossBudget=(offset+i)%4 if kind==POISON_EXERCISE else 0,
            initialGems=initial_gems if kind==POISON_EXERCISE else 1,
            gemRetentionBonus=4 if paired and initial_gems==1 else 0,
            rewardScale=19 if paired else 15,
            seatPolicies=['model']+['v1.5']*5))
    return configs

def summarize(results, nested=True):
    valid = [r for r in results if r['eligible'] and not r['truncated']]
    safe = [r for r in valid if r['feasible']]
    mean = lambda rows, key: sum(r[key] for r in rows)/len(rows) if rows else None
    table = collections.defaultdict(list)
    for row in valid: table[','.join(map(str,row['signature']))].append(row)
    def group(rows):
        safe_rows = [r for r in rows if r['feasible']]
        n=len(rows); probability=len(safe_rows)/n; z=1.96
        center=(probability+z*z/(2*n))/(1+z*z/n)
        radius=z*math.sqrt(probability*(1-probability)/n+z*z/(4*n*n))/(1+z*z/n)
        safe_mean=mean(safe_rows,'usefulDamage')
        se=(math.sqrt(sum((r['usefulDamage']-safe_mean)**2 for r in safe_rows)/(len(safe_rows)-1)/len(safe_rows))
            if len(safe_rows)>1 else None)
        return dict(samples=n, safety_rate=probability, safety_interval95=[max(0,center-radius),min(1,center+radius)],
                    safe_damage_standard_error=se,
                    safe_damage_mean=mean(safe_rows,'usefulDamage'),
                    safe_damage_per_attempt=sum(r['usefulDamage'] for r in safe_rows)/len(rows),
                    direct_damage_mean=mean(rows,'directDamage') if all(r['exercise']==EXERCISE for r in rows) else None,
                    warning='Safety here means within the supplied loss budget; zero_loss_rate separately reports no own loss.')
    output = dict(games=len(results), eligible=len(valid), ineligible=sum(not r['eligible'] for r in results),
                truncated=sum(r['truncated'] for r in results), **(group(valid) if valid else {}),
                damage_mean=mean(valid,'enemySpellDamage'), enemy_morale_loss_mean=mean(valid,'enemyMoraleLoss'),
                own_morale_loss_mean=mean(valid,'ownMoraleLoss'), root_actions=dict(collections.Counter(a for r in valid for a in r.get('rootActions',[]))), return_mean=mean(valid,'drillReturn'),
                raw_score_mean=mean(valid,'rawScore'), continuation_bonus_mean=mean(valid,'continuationBonus'),
                ending_gems_mean=mean(valid,'endingGems'), gem_retention_rate=sum(r['endingGems']>0 for r in valid)/len(valid) if valid else None,
                wisdom_trigger_rate=sum(r['wisdomTriggers']>0 for r in valid)/len(valid) if valid else None,
                spent_and_recovered_rate=sum(r['gemSpent']>0 and r['gemGained']>0 and r['endingGems']>0 for r in valid)/len(valid) if valid else None,
                kept_without_spending_rate=sum(r['gemSpent']==0 and r['endingGems']>0 for r in valid)/len(valid) if valid else None,
                feasible_raw_score_per_attempt=sum(r['rawScore'] for r in valid if r['feasible'])/len(valid) if valid else None,
                rebound_mean=mean(valid,'reboundCount'), zero_loss_rate=sum(r['ownMoraleLoss']==0 for r in valid)/len(valid) if valid else None,
                by_hand={key:group(rows) for key,rows in table.items()})
    budgets=sorted({r['lossBudget'] for r in valid})
    if len(budgets)>1:
        output['by_budget']={str(b):summarize([r for r in valid if r['lossBudget']==b],nested=False) for b in budgets}
    if nested:
        conditions=sorted({(r['initialGems'],r['gemRetentionBonus']) for r in valid})
        output['by_initial_gems_and_bonus']={f'{g}gem+{bonus}bonus':summarize([r for r in valid if (r['initialGems'],r['gemRetentionBonus'])==(g,bonus)],nested=False) for g,bonus in conditions}
    output['budget_compliance_rate']=output.get('safety_rate')
    return output

def samples(results):
    rows=[]
    for result in results:
        if not result['terminated'] or result['truncated']: continue
        for move in result['trajectory']:
            if move['seat'] != 0: raise ValueError('Only Sage may learn in this drill')
            reward = result['drillReturn']
            rows.append({**move,'return':reward,'terminal_return':reward,'potential':0,
                         'reward_style':'sage-drill','advantage':reward-move['old_value'],
                         'source_seed':result['seed'],'game_id':result['seed']})
    return rows

def main(runtime):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    parser.add_argument('--parent',type=Path)
    parser.add_argument('--exercise',choices=[EXERCISE,POISON_EXERCISE],default=EXERCISE)
    parser.add_argument('--sustain',action='store_true',help='Mix one-gem continuation +4 and two-gem damage-only turns')
    parser.add_argument('--rehearsal-fraction',type=float,default=0.)
    parser.add_argument('--games',type=int,default=512)
    parser.add_argument('--eval-games',type=int,default=512)
    parser.add_argument('--workers',type=int,default=32)
    parser.add_argument('--rounds',type=int,default=0)
    parser.add_argument('--eval-every',type=int,default=10)
    args=parser.parse_args()
    args.workers=runtime.worker_limit(args.workers)
    if args.sustain and args.exercise!=POISON_EXERCISE: parser.error('Sustain requires poison-turn exercise')
    if args.sustain and (args.games%8 or args.eval_games%8): parser.error('Sustain counts must be multiples of eight')
    if not 0<=args.rehearsal_fraction<1: parser.error('Invalid rehearsal fraction')
    if min(args.games,args.eval_games,args.workers,args.eval_every)<1: parser.error('Counts must be positive')
    directory=args.directory.resolve();directory.mkdir(parents=True,exist_ok=True)
    lock=open(directory/'lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    os.environ['XINGBEI_DIAGNOSTIC_DIR']=str(directory/'rule-failures')
    torch.set_num_threads(int(os.environ.get('XINGBEI_TORCH_THREADS','2')));torch.backends.cuda.matmul.allow_tf32=True
    if not torch.cuda.is_available(): raise RuntimeError('CUDA required for drill training')
    random.seed(20261112);torch.manual_seed(20261112)
    manifest_path=directory/'manifest.json'
    if not manifest_path.exists():
        if args.parent is None: parser.error('First run requires --parent')
        parent=torch.load(args.parent,map_location='cpu',weights_only=False)
        model,vocab=migrate(parent)
        manifest=dict(source_snapshot=json.loads((directory/'source-manifest.json').read_text()) if (directory/'source-manifest.json').exists() else None,exercise=args.exercise,observation_contract=CONTRACT,conditioning_contract=CONDITIONING_CONTRACT if args.exercise==POISON_EXERCISE else None,parent=str(args.parent.resolve()),
            sustain=args.sustain,sustain_contract=SUSTAIN_CONTRACT if args.sustain else None,
            parent_sha256=hashlib.sha256(args.parent.read_bytes()).hexdigest(),
            objective=('(Enemy morale loss + 4 if one-gem start retains gem, otherwise 0) / 19' if args.sustain else 'Enemy morale loss / 15' if args.exercise==POISON_EXERCISE else 'Useful enemy spell damage / 15')+'; loss budgets 0/1/2/3; over budget or own defeat returns -1',
            loss_budgets=[0,1,2,3] if args.exercise==POISON_EXERCISE else [0],rehearsal_fraction=args.rehearsal_fraction,
            starting_state=('5 random cards, 2 healing, 1/2 gems mixed, one poison; end-of-turn gem bonus only in one-gem cases' if args.sustain else '5 random cards, 2 healing, 2 gems, one poison; real start through turn end; other seats use frozen rule responses' if args.exercise==POISON_EXERCISE else '6 random cards, 2 healing, 1 gem; mandatory two-distinct-card self-codex; full enemy target.'),
            configuration=dict(games=args.games,eval_games=args.eval_games),created=time.time())
        write(manifest_path,manifest)
        save_checkpoint(directory/'initial.pt',{**model.checkpoint(vocab),'observation_contract':CONTRACT},manifest)
    manifest=json.loads(manifest_path.read_text())
    if manifest.get('sustain',False)!=args.sustain or manifest['exercise']!=args.exercise or manifest.get('rehearsal_fraction',0)!=args.rehearsal_fraction: raise ValueError('Resume exercise changed')
    if manifest['configuration'] != dict(games=args.games,eval_games=args.eval_games): raise ValueError('Resume configuration changed')
    completed=[p for p in sorted(directory.glob('round-*.pt')) if recover_checkpoint(p)]
    checkpoint=torch.load(completed[-1] if completed else directory/'initial.pt',map_location='cpu',weights_only=False)
    if checkpoint['observation_contract'] != CONTRACT: raise ValueError('Contract mismatch')
    model,vocab=EntityPolicy.restore(checkpoint);model.to('cuda')
    optimizer=make_optimizers(model,actor_lr=5e-5,critic_lr=5e-5)
    round_number=checkpoint.get('drill_round',0)
    if completed: restore_optimizers(optimizer,checkpoint['optimizer'],model)
    status=dict(exercise=args.exercise,round=round_number,configuration=manifest,checkpoint=str(completed[-1]) if completed else str(directory/'initial.pt'))
    def publish(state,**extra):
        status.update(state=state,time=time.time(),**extra);write(directory/'status.json',status)
        print(json.dumps({k:status[k] for k in ('state','time','round','checkpoint') if k in status},ensure_ascii=False),flush=True)
    def evaluate(round_number):
        publish('evaluating',round=round_number)
        rollout=runtime.run(model,vocab,configurations(0,args.eval_games,True,exercise=args.exercise,sustain=args.sustain),workers=args.workers,device='cuda',binary=True)
        report=dict(round=round_number,summary=summarize(rollout['results']),stats=rollout['stats'],results=rollout['results'])
        write(directory/f'evaluation-{round_number:06d}.json',report)
        write(directory/'evaluation-latest.json',report)
        # f is a policy-dependent Monte Carlo lookup, never an exact optimum.
        if args.exercise==EXERCISE:
            write(directory/'hand-value.json',dict(policy_round=round_number,contract=CONTRACT,
                signature='light,dark,sorted-five-basic-counts',healing=2,gem=1,
                target='Full hand, no healing, inert; useful damage capped by victory at 15',
                note='Sorted five elements average over real deck frequencies; sparse groups need more samples.',
                values=report['summary']['by_hand']))
        else:
            # Same single network, old exercise only as a retained-skill diagnostic.
            old=runtime.run(model,vocab,configurations(0,args.eval_games,True),workers=args.workers,device='cuda',binary=True)
            write(directory/f'rebound-regression-{round_number:06d}.json',dict(round=round_number,summary=summarize(old['results']),results=old['results']))
        key=(report['summary']['safety_rate'], report['summary']['feasible_raw_score_per_attempt'] if args.sustain else report['summary']['safe_damage_per_attempt'])
        best_path=directory/'best-development.json'
        previous=json.loads(best_path.read_text()) if best_path.exists() else None
        if previous is None or key>tuple(previous['selection_key']):
            write(best_path,dict(round=round_number,checkpoint=status['checkpoint'],selection_key=key,summary=report['summary']))
        status['evaluation']={k:v for k,v in report.items() if k!='results'}
    try:
        with Telemetry(directory):
            if not (directory/'evaluation-000000.json').exists(): evaluate(0)
            performed=0
            while not (directory/'PAUSE').exists() and (not args.rounds or performed<args.rounds):
                current=round_number+1
                # Deterministic round RNG allows exact resume of the next round.
                random.seed(20261112+current);torch.manual_seed(20261112+current);torch.cuda.manual_seed_all(20261112+current)
                publish('collecting',round=current)
                rollout=runtime.run(model,vocab,configurations(round_number*args.games,args.games,exercise=args.exercise,rehearsal_fraction=args.rehearsal_fraction,sustain=args.sustain),
                    workers=args.workers,device='cuda',trajectory=True,binary=True)
                rows=samples(rollout['results']);metrics=summarize(rollout['results'])
                metrics['by_exercise']={kind:summarize([r for r in rollout['results'] if r['exercise']==kind]) for kind in {r['exercise'] for r in rollout['results']}}
                publish('updating',summary=metrics,stats=rollout['stats'])
                learning=update(model,vocab,optimizer,rows,batch_size=64,epochs=2,device='cuda',
                    target_kl=.02,entropy_weight=.015,critic_mode='grouped',critic_updates=32,critic_loss='mse')
                report=dict(round=current,summary=metrics,stats=rollout['stats'],learning=learning,
                    results=[{k:v for k,v in r.items() if k!='trajectory'} for r in rollout['results']])
                destination=directory/f'round-{current:06d}.pt'
                saved={**model.checkpoint(vocab),'observation_contract':CONTRACT,'conditioning_contract':manifest.get('conditioning_contract'),'sustain_contract':manifest.get('sustain_contract'),'drill_round':current,
                    'optimizer':{k:v.state_dict() for k,v in optimizer.items()},'manifest':manifest,
                    'random_state':random.getstate(),'torch_rng':torch.get_rng_state(),'cuda_rng':torch.cuda.get_rng_state_all()}
                save_checkpoint(destination,saved,report)
                round_number=current;performed+=1
                publish('checkpointed',checkpoint=str(destination),round=current)
                del rows,rollout,saved,report
                if current%args.eval_every==0 or current==1: evaluate(current)
            publish('paused' if (directory/'PAUSE').exists() else 'completed')
    except BaseException:
        publish('error',error=traceback.format_exc());raise

if __name__=='__main__':
    with GameRuntime() as runtime: main(runtime)
