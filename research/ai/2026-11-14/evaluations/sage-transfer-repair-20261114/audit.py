from pathlib import Path
import sys, importlib.util, json, copy, random, time, os
import torch
root=Path(__file__).resolve().parent
source=root/'source/xingbei-cli'
sys.path.insert(0,str(source/'training/entity'))
from model import EntityPolicy, collate
from pool import GameRuntime
from learning import training_samples, make_optimizers
from reinforce import update, decision_type, decision_group
from rehearsal import PolicyRehearsal
from specialists import configurations, summarize, paired_difference
spec=importlib.util.spec_from_file_location('drill',source/'training/entity/sage-drill.py')
drill=importlib.util.module_from_spec(spec); spec.loader.exec_module(drill)
manifest=json.loads((root/'manifest.json').read_text()); opponents=Path(manifest['opponents'])
os.environ['XINGBEI_DIAGNOSTIC_DIR']=str(root/'rule-failures')
torch.set_num_threads(1); torch.backends.cuda.matmul.allow_tf32=True
random.seed(20261114); torch.manual_seed(20261114)
initial=torch.load(manifest['initial'],map_location='cpu',weights_only=False)
models={key:EntityPolicy.restore(torch.load(opponents/name,map_location='cpu',weights_only=False)) for key,name in [('frozenCurrent','frozen-current.pt'),('anchor417','frozen-417.pt')]}
def save(name,data):
    (root/(name+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2))
    print(name,json.dumps(data.get('summary',data.get('learning',{})),ensure_ascii=False),flush=True)
def run_drills(runtime,model,vocab,label):
    summaries={}
    for kind,count in [('self',128),('poison',256)]:
        configs=drill.configurations(0,count,True,exercise=drill.EXERCISE if kind=='self' else drill.POISON_EXERCISE,sustain=kind=='poison')
        output=runtime.run(model,vocab,configs,workers=16,device='cuda',binary=True)
        summary=drill.summarize(output['results']); summaries[kind]=summary
        save(label+'-'+kind,dict(summary=summary,results=output['results'],configs=configs))
    return summaries
with GameRuntime() as runtime:
    teacher,vocab=EntityPolicy.restore(initial); teacher.to('cuda')
    # New practice seeds, entirely separate from the capability evaluation seeds.
    configs=drill.configurations(200000,64)+drill.configurations(200000,128,exercise=drill.POISON_EXERCISE,sustain=True)
    rollout=runtime.run(teacher,vocab,configs,workers=16,device='cuda',trajectory=True,sparse=False)
    candidates=[move['observation'] for result in rollout['results'] if result['terminated'] and not result['truncated'] for move in result['trajectory'] if decision_type(move['observation'])!='action']
    random.shuffle(candidates); candidates=candidates[:4096]
    bank=[]
    teacher.eval()
    with torch.no_grad():
        for start in range(0,len(candidates),32):
            observations=candidates[start:start+32]
            probabilities=teacher.policy_logits(collate(observations,vocab,'cuda')).softmax(-1).cpu()
            for observation,probability in zip(observations,probabilities):
                bank.append(dict(observation=observation,probabilities=probability[:len(observation['candidates'])].tolist(),group=decision_group(observation)))
    torch.save(dict(symbols=vocab.symbols,examples=bank,source=manifest['initial'],configs=configs),root/'skill-bank.pt')
    save('bank',dict(summary=dict(observations=len(bank),source_games=len(configs))))
    baseline=run_drills(runtime,teacher,vocab,'initial')
    train_configs=configurations('sage',96,300000,'development')
    rollout=runtime.run(teacher,vocab,train_configs,workers=16,device='cuda',models=models,trajectory=True,binary=True)
    rows=training_samples(rollout['results'])
    root_rows=[r for r in rows if decision_type(r['observation'])=='action']
    torch.save(root_rows,root/'root-action-rows.pt')
    save('collection',dict(summary=summarize(rollout['results'],train_configs),root_samples=len(root_rows),all_samples=len(rows)))
    for label,weight in [('action-only',0.),('action-only-rehearsed',1.)]:
        model,vocab=EntityPolicy.restore(initial);model.to('cuda')
        random.seed(789);torch.manual_seed(789)
        optimizer=make_optimizers(model,actor_lr=5e-5,critic_lr=3e-5)
        learning=update(model,vocab,optimizer,list(root_rows),batch_size=64,epochs=2,device='cuda',target_kl=.02,entropy_weight=.03,critic_mode='grouped',critic_updates=32,rehearsal=PolicyRehearsal(bank,vocab),rehearsal_weight=weight)
        save(label+'-update',dict(learning=learning))
        torch.save(model.checkpoint(vocab),root/(label+'.pt'))
        run_drills(runtime,model,vocab,label)
        del model,optimizer
    # Same normal games and frozen five-seat opponents. Only the first legal
    # empty-energy two-gem refinement is intervened on in the second arm.
    full_configs=configurations('sage',144,0,'development',evaluation=True)
    for label,path in [('initial',Path(manifest['initial'])),('full451',opponents.parent/'sage-full-activation-guard-20261113/sage/round-000451.pt')]:
        model,vocab=EntityPolicy.restore(torch.load(path,map_location='cpu',weights_only=False))
        control=None
        for forced in [False,True]:
            cfg=[dict(c,sageRefineFirst=forced) for c in full_configs]
            output=runtime.run(model,vocab,cfg,workers=16,device='cuda',models=models,binary=True)
            report=dict(summary=summarize(output['results'],cfg),results=output['results'],configs=cfg,stats=output['stats'])
            if control is not None:report['paired']=paired_difference(output['results'],control,cfg)
            else:control=output['results']
            save(label+('-refine-first' if forced else '-unrestricted'),report)
        del model
    # Isolate the context-marker shift without changing any game state or legal choice.
    configs=[dict(c,hideExerciseObjective=True) for c in drill.configurations(0,128,True)]
    output=runtime.run(teacher,vocab,configs,workers=16,device='cuda',binary=True)
    save('initial-without-practice-markers',dict(summary=drill.summarize(output['results']),results=output['results']))
print('DONE',flush=True)
