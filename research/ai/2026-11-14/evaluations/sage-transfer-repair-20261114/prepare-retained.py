from pathlib import Path
import sys,json,hashlib,shutil,importlib.util
import torch
base=Path('/home/xp/.local/share/xingbei-ml'); audit=base/'sage-transfer-repair-20261114'; parent=base/'sage-full-action-boundary-20261114'; dest=base/'sage-retained-skills-20261114';work=Path('/home/xp/xingbei/xingbei-cli')
dest.mkdir(exist_ok=True); source=dest/'source/xingbei-cli'
if not source.exists():shutil.copytree(parent/'source/xingbei-cli',source,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
names=['training/entity/pool.py','training/entity/reinforce.py','training/entity/rehearsal.py','training/entity/specialists.py','training/entity/sage-transfer.mjs','training/entity/sage-drill.mjs','training/worker.mjs']
for name in names:shutil.copyfile(work/name,source/name)
for name in ['frozen-current.pt','frozen-417.pt','sage-human.jsonl']:shutil.copyfile(parent/name,dest/name)
shutil.copyfile(audit/'repaired-003.pt',dest/'sage-initial.pt')
sys.path.insert(0,str(source/'training/entity'))
spec=importlib.util.spec_from_file_location('drill',source/'training/entity/sage-drill.py');drill=importlib.util.module_from_spec(spec);spec.loader.exec_module(drill)
bank=torch.load(audit/'skill-bank.pt',map_location='cpu',weights_only=False);bank['validation']=[]
for name,configs,file in [('self',drill.configurations(0,128,True),'initial-self.json'),('poison',drill.configurations(0,256,True,exercise=drill.POISON_EXERCISE,sustain=True),'initial-poison.json'),('normal-opening',[dict(c,normalOpening=True,unrestrictedChoices=True) for c in drill.configurations(600000,128,True)],'normal-opening-before.json')]:
 summary=json.loads((audit/file).read_text())['summary']
 bank['validation'].append(dict(name=name,configs=configs,minimum_enemy_morale_loss=summary['enemy_morale_loss_mean']*.95,maximum_own_morale_loss=summary['own_morale_loss_mean']+.02))
torch.save(bank,dest/'skill-bank.pt')
manifest=json.loads((parent/'manifest.json').read_text())
manifest['revision']='sage-retained-skills-20261114';manifest['training_offset']=500000
manifest['initial_checkpoints']={'sage':dict(file='sage-initial.pt',sha256=hashlib.sha256((dest/'sage-initial.pt').read_bytes()).hexdigest())}
manifest['lineage']['retained_skill_fork']=dict(parent=str(audit/'repaired-003.pt'),pilot_games=576,optimizer='reset for new controlled experiment',actor='same single policy',reward='terminal team win only',continuation_temperature=.25,rehearsal_weight=1.,capability_guard='every round; >=95% old mean damage, <=old own loss +0.02; reject candidate and pause on failure')
manifest['overlay_sha256']={n:hashlib.sha256((source/n).read_bytes()).hexdigest() for n in names}
manifest['human_reference_rounds']=0
(dest/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(dest)
