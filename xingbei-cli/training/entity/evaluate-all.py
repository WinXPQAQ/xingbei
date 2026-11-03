import argparse
import asyncio
import json
from pathlib import Path
import torch
from model import EntityPolicy
from pool import run_games, ROSTERS
from league import configuration
from evaluate import summarize

async def evaluate(current,best,revision,pairs=144):
    model,vocab=EntityPolicy.restore(torch.load(current,map_location='cpu',weights_only=False))
    best_model,best_vocab=EntityPolicy.restore(torch.load(best,map_location='cpu',weights_only=False))
    reports={}
    for opponent,count in [('v1.9.0-preview.1',pairs),('model:best',pairs),('v1.5',36 if pairs==144 else 2)]:
        configs=[]
        for i in range(count):
            config=configuration(i,931103000 if opponent!='v1.5' else 941103000,revision)
            if opponent=='v1.5':config['heroIds']=ROSTERS[0]
            configs.extend([dict(config),dict(config)])
        result=await run_games(model,vocab,configs,workers=16,device='cuda',opponent=opponent,models={'best':(best_model,best_vocab)})
        by_hero={}
        for i,(config,game) in enumerate(zip(configs,result['results'])):
            side='red' if i%2==0 else 'blue'
            for seat,hero in enumerate(config['heroIds']):
                if (seat in [0,3,4]) != (side=='red'):continue
                row=by_hero.setdefault(hero,dict(games=0,wins=0));row['games']+=1;row['wins']+=int(game['winner']==side)
        reports[opponent]={**summarize(result['results']),'by_hero':by_hero,**result}
    return dict(checkpoint=current,best_opponent=best,revision=revision,development=True,opponents=reports)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('checkpoint');parser.add_argument('best');parser.add_argument('output')
    parser.add_argument('--revision',required=True);parser.add_argument('--pairs',type=int,default=144)
    args=parser.parse_args();torch.set_num_threads(2)
    result=asyncio.run(evaluate(args.checkpoint,args.best,args.revision,args.pairs))
    with open(args.output,'x') as f:json.dump(result,f)
    print(json.dumps({k:{n:r[n] for n in ['games','wins','win_rate','truncated','paired_seed_interval95']} for k,r in result['opponents'].items()}))
