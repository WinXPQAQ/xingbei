"""Fixed tiny-data learnability diagnostic. Accuracy is memorization, not strength."""
import asyncio,json,sys,time
from pathlib import Path
import argparse
parser=argparse.ArgumentParser()
parser.add_argument("--encoding",choices=["legacy-v2","categorical-seats-v3"],required=True)
parser.add_argument("--output",type=Path,required=True)
args=parser.parse_args()
import torch
from model import Policy,batch
from rollout import collect
from schedule import training_configs
from train import update
async def main():
 torch.set_num_threads(2);torch.manual_seed(313)
 model=Policy(feature_encoding=args.encoding).cuda();opt=torch.optim.Adam(model.parameters(),lr=3e-4)
 rows,games,_=await collect(model,training_configs(210010000,0,8,313,True),4,'cuda',teacher='v1.5')
 results=[]
 for epoch in range(160):
  loss=update(model,opt,rows,'cuda',True,epochs=1)
  if (epoch+1)%40:continue
  stats={}
  with torch.inference_mode():
   for offset in range(0,len(rows),64):
    part=rows[offset:offset+64];logits,_=model(*batch(part,'cuda'))
    for i,row in enumerate(part):
     if len(row['actions'])==1:continue
     for kind in ('all',row['kind']):
      val=stats.setdefault(kind,[0,0]);val[0]+=1;val[1]+=int(logits[i].argmax().item()==row['choice'])
  result={'epoch':epoch+1,'loss':loss,'memorizationOnly':{k:{'count':v[0],'accuracy':v[1]/v[0]} for k,v in stats.items()}};results.append(result);print(json.dumps(result),flush=True)
 args.output.open('w').write(json.dumps({'games':len(games),'rows':len(rows),'results':results},indent=2))
asyncio.run(main())
