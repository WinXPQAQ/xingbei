import argparse
import asyncio
import json
import os
from pathlib import Path
import tempfile
import torch
from model import EntityPolicy
from pool import run_games, ROSTERS
from league import configuration, catalog
from evaluate import summarize
from reinforce import check_revision

async def evaluate(current,best,revision,pairs=144,workers=16,seed_base=931103000,temperature=0.0,opponents=('rule','best','legacy'),anchor=None):
    current_checkpoint=torch.load(current,map_location='cpu',weights_only=False)
    best_checkpoint=torch.load(best,map_location='cpu',weights_only=False)
    check_revision(current_checkpoint,revision,'Evaluation model')
    check_revision(best_checkpoint,revision,'Evaluation opponent')
    model,vocab=EntityPolicy.restore(current_checkpoint)
    best_model,best_vocab=EntityPolicy.restore(best_checkpoint)
    models={'best':(best_model,best_vocab)}
    if anchor:
        frozen=torch.load(anchor,map_location='cpu',weights_only=False)
        check_revision(frozen,revision,'Frozen 417 opponent')
        models['anchor417']=EntityPolicy.restore(frozen)
    reports={}
    groups = {'rule': (catalog()['ruleTeacher'],pairs), 'best': ('model:best',pairs),
              'legacy': ('v1.5',36 if pairs==144 else 2),
              'anchor': ('model:anchor417',pairs), 'original': ('legacy-score-partial-v1',pairs)}
    for group in opponents:
        opponent,count = groups[group]
        configs=[]
        # Fix the sampling seed; asynchronous workers may change draw order.
        torch.manual_seed(seed_base)
        for i in range(count):
            config=configuration(i,seed_base if opponent!='v1.5' else seed_base+10000000,revision)
            if opponent=='v1.5':config['heroIds']=ROSTERS[0]
            configs.extend([dict(config),dict(config)])
        result=await run_games(model,vocab,configs,workers=workers,device='cuda',opponent=opponent,models=models,binary=True,
                               evaluation_temperature=temperature)
        by_hero={}
        for i,(config,game) in enumerate(zip(configs,result['results'])):
            side='red' if i%2==0 else 'blue'
            for seat,hero in enumerate(config['heroIds']):
                if (seat in [0,3,4]) != (side=='red'):continue
                row=by_hero.setdefault(hero,dict(games=0,wins=0));row['games']+=1;row['wins']+=int(game['winner']==side)
        reports[opponent]={**summarize(result['results']),'by_hero':by_hero,**result}
    return dict(rule_variant=os.environ.get('XINGBEI_TRAINING_RULE_VARIANT','standard'),rule_opponent=catalog()['ruleTeacher'],checkpoint=current,best_opponent=best,revision=revision,
                development=True,seed_base=seed_base,temperature=temperature,opponents=reports)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('checkpoint');parser.add_argument('best');parser.add_argument('output')
    parser.add_argument('--revision',required=True);parser.add_argument('--pairs',type=int,default=144)
    parser.add_argument('--workers',type=int,default=16)
    parser.add_argument('--seed-base',type=int,default=931103000)
    parser.add_argument('--temperature',type=float,default=0.0)
    parser.add_argument('--rule-variant',choices=['standard','morale-only-v1'])
    parser.add_argument('--anchor')
    parser.add_argument('--opponents',nargs='+',choices=['rule','best','legacy','anchor','original'],default=['rule','best','legacy'])
    args=parser.parse_args();torch.set_num_threads(2)
    if args.rule_variant:os.environ['XINGBEI_TRAINING_RULE_VARIANT']=args.rule_variant
    if min(args.pairs,args.workers)<1:parser.error('pairs and workers must be positive')
    if not 0 <= args.temperature < float('inf'):parser.error('temperature must be finite and nonnegative')
    if 'anchor' in args.opponents and not args.anchor:parser.error('Anchor group requires --anchor')
    output=Path(args.output)
    if output.exists():raise FileExistsError(f'Evaluation already exists: {output}')
    output.parent.mkdir(parents=True,exist_ok=True)
    result=asyncio.run(evaluate(args.checkpoint,args.best,args.revision,args.pairs,args.workers,args.seed_base,args.temperature,args.opponents,args.anchor))
    with tempfile.NamedTemporaryFile(mode='w',dir=output.parent,prefix=output.name+'.',suffix='.pending',delete=False) as f:
        pending=Path(f.name)
        json.dump(result,f)
        f.flush()
        os.fsync(f.fileno())
    pending.replace(output)
    print(json.dumps({k:{n:r[n] for n in ['games','wins','win_rate','truncated','paired_seed_interval95']} for k,r in result['opponents'].items()}))
