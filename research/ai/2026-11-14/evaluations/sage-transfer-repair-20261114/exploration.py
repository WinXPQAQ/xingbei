from pathlib import Path
import sys, importlib.util, json, random, os
import torch
root=Path(__file__).resolve().parent; source=root/'source/xingbei-cli'
sys.path.insert(0,str(source/'training/entity'))
from model import EntityPolicy
from pool import GameRuntime
from learning import training_samples, make_optimizers
from reinforce import update
from rehearsal import PolicyRehearsal
from specialists import configurations, summarize, paired_difference
spec=importlib.util.spec_from_file_location('drill',source/'training/entity/sage-drill.py');drill=importlib.util.module_from_spec(spec);spec.loader.exec_module(drill)
manifest=json.loads((root/'manifest.json').read_text());opponents=Path(manifest['opponents'])
os.environ['XINGBEI_DIAGNOSTIC_DIR']=str(root/'rule-failures')
torch.set_num_threads(1);torch.backends.cuda.matmul.allow_tf32=True
initial=torch.load(manifest['initial'],map_location='cpu',weights_only=False)
models={key:EntityPolicy.restore(torch.load(opponents/name,map_location='cpu',weights_only=False)) for key,name in [('frozenCurrent','frozen-current.pt'),('anchor417','frozen-417.pt')]}
bank=torch.load(root/'skill-bank.pt',map_location='cpu',weights_only=False)
def save(name,data):
 (root/(name+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2))
 s=data.get('summary',{});print(name,{k:s[k] for k in ['games','wins','enemy_morale_loss_mean','own_morale_loss_mean','root_actions'] if k in s},flush=True)
with GameRuntime() as runtime:
 model,vocab=EntityPolicy.restore(initial);model.to('cuda')
 for name,flags in [('markers-hidden',dict(hideExerciseObjective=True)),('legal-choices',dict(unrestrictedChoices=True)),('both',dict(hideExerciseObjective=True,unrestrictedChoices=True))]:
  configs=[dict(c,**flags) for c in drill.configurations(0,256,True,exercise=drill.POISON_EXERCISE,sustain=True)]
  output=runtime.run(model,vocab,configs,workers=16,device='cuda',binary=True)
  save('domain-'+name,dict(summary=drill.summarize(output['results']),results=output['results']))
 for temperature in [1.,.25]:
  random.seed(1024);torch.manual_seed(1024)
  configs=drill.configurations(0,128,True)
  output=runtime.run(model,vocab,configs,workers=16,device='cuda',trajectory=True,binary=True,continuation_temperature=temperature)
  save(f'explore-drill-{temperature}',dict(summary=drill.summarize(output['results']),results=[{k:v for k,v in r.items() if k!='trajectory'} for r in output['results']]))
 for temperature in [1.,.25]:
  random.seed(1024);torch.manual_seed(1024)
  configs=configurations('sage',96,300000,'development')
  output=runtime.run(model,vocab,configs,workers=16,device='cuda',models=models,trajectory=True,binary=True,continuation_temperature=temperature)
  save(f'explore-full-{temperature}',dict(summary=summarize(output['results'],configs),results=[{k:v for k,v in r.items() if k!='trajectory'} for r in output['results']]))
 # Short bounded trial. Keep the complete game return, and protect old execution
 # using actor-only soft distributions on the skill bank.
 optimizer=make_optimizers(model,actor_lr=5e-5,critic_lr=3e-5)
 rehearsal=PolicyRehearsal(bank['examples'],vocab)
 for round_number in range(1,4):
  random.seed(20261114+round_number);torch.manual_seed(20261114+round_number)
  configs=configurations('sage',192,400000+(round_number-1)*192,'development')
  output=runtime.run(model,vocab,configs,workers=16,device='cuda',models=models,trajectory=True,binary=True,continuation_temperature=.25)
  rows=training_samples(output['results'])
  learning=update(model,vocab,optimizer,rows,batch_size=64,epochs=2,device='cuda',target_kl=.02,entropy_weight=.03,critic_mode='grouped',critic_updates=32,rehearsal=rehearsal,rehearsal_weight=1.)
  saved=model.checkpoint(vocab);saved.update(optimizer={k:v.state_dict() for k,v in optimizer.items()},random_state=random.getstate(),torch_rng=torch.get_rng_state(),cuda_rng=torch.cuda.get_rng_state_all(),round=round_number,transfer=dict(continuation_temperature=.25,rehearsal_weight=1.,bank=str(root/'skill-bank.pt')))
  torch.save(saved,root/f'repaired-{round_number:03}.pt')
  save(f'repaired-{round_number:03}',dict(summary=summarize(output['results'],configs),learning=learning,stats=output['stats']))
 for kind,count in [('self',128),('poison',256)]:
  configs=drill.configurations(0,count,True,exercise=drill.EXERCISE if kind=='self' else drill.POISON_EXERCISE,sustain=kind=='poison')
  output=runtime.run(model,vocab,configs,workers=16,device='cuda',binary=True)
  save('repaired-final-'+kind,dict(summary=drill.summarize(output['results']),results=output['results']))
 configs=configurations('sage',144,0,'development',evaluation=True)
 output=runtime.run(model,vocab,configs,workers=16,device='cuda',models=models,binary=True)
 control=json.loads((root/'initial-unrestricted.json').read_text())['results']
 save('repaired-final-full',dict(summary=summarize(output['results'],configs),paired=paired_difference(output['results'],control,configs),results=output['results'],configs=configs))
print('DONE',flush=True)
