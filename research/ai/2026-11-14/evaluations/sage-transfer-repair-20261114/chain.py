from pathlib import Path
import sys,json,random,importlib.util,subprocess
import torch
root=Path(__file__).resolve().parent;source=root/'source/xingbei-cli';sys.path.insert(0,str(source/'training/entity'))
from model import EntityPolicy,collate
from pool import GameRuntime
from prepared import PreparedObservations
from rehearsal import PolicyRehearsal
from learning import make_optimizers,parameter_groups
from specialists import configurations,summarize,paired_difference
spec=importlib.util.spec_from_file_location('drill',source/'training/entity/sage-drill.py');drill=importlib.util.module_from_spec(spec);spec.loader.exec_module(drill)
manifest=json.loads((root/'manifest.json').read_text());opponents=Path(manifest['opponents'])
torch.set_num_threads(1);torch.backends.cuda.matmul.allow_tf32=True;random.seed(999);torch.manual_seed(999)
initial=torch.load(manifest['initial'],map_location='cpu',weights_only=False)
models={key:EntityPolicy.restore(torch.load(opponents/name,map_location='cpu',weights_only=False)) for key,name in [('frozenCurrent','frozen-current.pt'),('anchor417','frozen-417.pt')]}
def save(name,data):
 (root/(name+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2));s=data.get('summary',{});print(name,{k:s[k] for k in ['games','wins','enemy_morale_loss_mean','own_morale_loss_mean','root_actions'] if k in s},flush=True)
with GameRuntime() as runtime:
 model,vocab=EntityPolicy.restore(initial);model.to('cuda')
 configs=[dict(c,capture=True) for c in drill.configurations(500000,128,True)]
 output=runtime.run(model,vocab,configs,workers=16,device='cuda',binary=True)
 save('opening-teacher',dict(results=output['results']))
 if not (root/'chain-reference.jsonl').exists(): subprocess.run(['node',str(source/'training/entity/sage-opening-reference.mjs'),str(root/'opening-teacher.json'),str(root/'chain-reference.jsonl')],check=True)
 examples=[json.loads(line) for line in (root/'chain-reference.jsonl').read_text().splitlines()]
 prepared=PreparedObservations([row['observation'] for row in examples],vocab)
 rehearsal=PolicyRehearsal(torch.load(root/'skill-bank.pt',weights_only=False)['examples'],vocab)
 configs=[dict(c,normalOpening=True,unrestrictedChoices=True) for c in drill.configurations(600000,128,True)]
 output=runtime.run(model,vocab,configs,workers=16,device='cuda',binary=True)
 save('chain-normal-before',dict(summary=drill.summarize(output['results']),results=output['results']))
 optimizer=make_optimizers(model,actor_lr=5e-5,critic_lr=3e-5)['actor'];model.train()
 for step in range(200):
  selected=random.sample(examples,min(32,len(examples)))
  logits=model.policy_logits(prepared.collate([r['observation'] for r in selected],'cuda'))
  loss=torch.nn.functional.cross_entropy(logits,torch.tensor([r['choice'] for r in selected],device='cuda'))+rehearsal.loss(model,'cuda',count=32)
  optimizer.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(parameter_groups(model)['actor'],1);optimizer.step()
 torch.save(model.checkpoint(vocab),root/'chain-bridged.pt')
 for label,cfg in [('chain-normal-after',configs),('chain-bridged-self',drill.configurations(0,128,True)),('chain-bridged-poison',drill.configurations(0,256,True,exercise=drill.POISON_EXERCISE,sustain=True))]:
  output=runtime.run(model,vocab,cfg,workers=16,device='cuda',binary=True)
  save(label,dict(summary=drill.summarize(output['results']),results=output['results']))
 configs=configurations('sage',144,0,'development',evaluation=True)
 for forced in [False,True]:
  cfg=[dict(c,sageRefineFirst=forced) for c in configs]
  output=runtime.run(model,vocab,cfg,workers=16,device='cuda',models=models,binary=True)
  save('chain-bridged-'+('refine' if forced else 'free'),dict(summary=summarize(output['results'],cfg),results=output['results'],configs=cfg))
print('DONE',flush=True)
