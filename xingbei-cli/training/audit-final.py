import json,hashlib,random,sys
from pathlib import Path
from collections import defaultdict
from schedule import evaluation_configs,TEAMS
root=Path('/home/xp/.local/share/xingbei-ml');frozen={r['seed']:r for r in json.loads((root/'evidence/frozen-pilot-checkpoints.json').read_text())};reports=[];controls=None
for model_seed in [41,73,107]:
 ckpt=root/f'runs/pilot-v2-{model_seed}/checkpoint.pt';assert hashlib.sha256(ckpt.read_bytes()).hexdigest()==frozen[model_seed]['sha256']
 p=root/f'evaluations/final-{model_seed}';games=[json.loads(x) for x in (p/'games.jsonl').read_text().splitlines()];report=json.loads((p/'report.json').read_text());assert report['manifest']['checkpointSha256']==frozen[model_seed]['sha256']
 key=lambda g:(g['seed'],g['lineup'],g['team'],g['start'],g['mode'],g['arm'])
 expected={key(c):c for c in evaluation_configs(240000000,12,model_seed)}
 assert len(games)==len(expected)==1008 and len({key(g) for g in games})==1008
 for g in games:
  c=expected[key(g)]
  for field in ['heroIds','seatPolicies','samplingSeed']:assert g[field]==c[field]
  assert g['terminated'] and not g['truncated'] and g['turns']>0
  assert g['rewards']=={str(i):(1 if team==g['winner'] else -1) for i,team in enumerate(TEAMS)}
 this_controls={key(g):(g['winner'],g['turns'],g['decisions']) for g in games if g['arm']=='control'}
 if controls is None:controls=this_controls
 assert controls==this_controls
 for mode in ['team','mixed']:
  selected=[g for g in games if g['arm']=='model' and g['mode']==mode];wins=sum(g['winner']==g['team'] for g in selected)
  assert len(selected)==336 and wins==report[mode]['wins'] and report[mode]['losses']==336-wins
  grouped=defaultdict(list)
  for g in selected:grouped[g['seed']].append(int(g['winner']==g['team']))
  values=[sum(v)/len(v) for v in grouped.values()];assert len(values)==12
  rng=random.Random(938721);sample=sorted(sum(values[rng.randrange(12)] for _ in range(12))/12 for _ in range(10000));ci=[sample[250],sample[9749]]
  assert all(abs(a-b)<0.02 for a,b in zip(ci,report[mode]['seedCluster95']))
  reports.append({'modelSeed':model_seed,'mode':mode,'wins':wins,'losses':336-wins,'independentBootstrap95':ci})
print(json.dumps({'allSchedulesAndCheckpointsVerified':True,'terminalTeamRewardsVerified':True,'controlsIdenticalAcrossModels':True,'physicalGames':3024,'independentFinalSeedClusters':12,'independentStatistics':reports},indent=2))
