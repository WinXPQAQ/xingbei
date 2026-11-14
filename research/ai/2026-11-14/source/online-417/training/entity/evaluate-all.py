import argparse
import asyncio
import json
from pathlib import Path
import torch
from model import EntityPolicy
from pool import run_games, ROSTERS
from league import configuration, catalog
from evaluate import summarize

async def evaluate(current,best,revision,pairs=144,workers=16,seed_base=931103000,temperature=0.0,opponents=('rule','best','legacy')):
    model,vocab=EntityPolicy.restore(torch.load(current,map_location='cpu',weights_only=False))
    best_model,best_vocab=EntityPolicy.restore(torch.load(best,map_location='cpu',weights_only=False))
    reports={}
    groups = {'rule': (catalog()['ruleTeacher'],pairs), 'best': ('model:best',pairs),
              'legacy': ('v1.5',36 if pairs==144 else 2)}
    for group in opponents:
        opponent,count = groups[group]
        configs=[]
        # Fix the sampling seed; asynchronous workers may change draw order.
        torch.manual_seed(seed_base)
        for i in range(count):
            config=configuration(i,seed_base if opponent!='v1.5' else seed_base+10000000,revision)
            if opponent=='v1.5':config['heroIds']=ROSTERS[0]
            configs.extend([dict(config),dict(config)])
        result=await run_games(model,vocab,configs,workers=workers,device='cuda',opponent=opponent,models={'best':(best_model,best_vocab)},binary=True,
                               evaluation_temperature=temperature)
        by_hero={}
        for i,(config,game) in enumerate(zip(configs,result['results'])):
            side='red' if i%2==0 else 'blue'
            for seat,hero in enumerate(config['heroIds']):
                if (seat in [0,3,4]) != (side=='red'):continue
                row=by_hero.setdefault(hero,dict(games=0,wins=0));row['games']+=1;row['wins']+=int(game['winner']==side)
        reports[opponent]={**summarize(result['results']),'by_hero':by_hero,**result}
    return dict(rule_opponent=catalog()['ruleTeacher'],checkpoint=current,best_opponent=best,revision=revision,
                development=True,seed_base=seed_base,temperature=temperature,opponents=reports)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('checkpoint');parser.add_argument('best');parser.add_argument('output')
    parser.add_argument('--revision',required=True);parser.add_argument('--pairs',type=int,default=144)
    parser.add_argument('--workers',type=int,default=16)
    parser.add_argument('--seed-base',type=int,default=931103000)
    parser.add_argument('--temperature',type=float,default=0.0)
    parser.add_argument('--opponents',nargs='+',choices=['rule','best','legacy'],default=['rule','best','legacy'])
    args=parser.parse_args();torch.set_num_threads(2)
    if min(args.pairs,args.workers)<1:parser.error('pairs and workers must be positive')
    if not 0 <= args.temperature < float('inf'):parser.error('temperature must be finite and nonnegative')
    result=asyncio.run(evaluate(args.checkpoint,args.best,args.revision,args.pairs,args.workers,args.seed_base,args.temperature,args.opponents))
    with open(args.output,'x') as f:json.dump(result,f)
    print(json.dumps({k:{n:r[n] for n in ['games','wins','win_rate','truncated','paired_seed_interval95']} for k,r in result['opponents'].items()}))
