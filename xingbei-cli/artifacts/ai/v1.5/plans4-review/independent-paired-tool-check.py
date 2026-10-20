import pathlib,json,subprocess,tempfile,copy
p=pathlib.Path('/workspace/xingbei/xingbei-cli');source=p/'tools/ai/v15-paired-analyze.mjs';protocol=json.loads((p/'artifacts/ai/mandatory-refresh/protocol.json').read_text());games=[]
for endpoint,n in [('v1.4',120),('v1.3',20),('v1.2',20),('v1.0',20),('flow',30),('reserve',30)]:
 mixed=endpoint in ['flow','reserve']
 for seed in range(1540001,1540001+n):
  for lineup,b in protocol['rosters'].items():
   for start in range(6):
    for team in ['red','blue']:
     seats=[0,3,4]if team=='red'else[1,2,5];heroes=b if team=='red'else[b[i]for i in[1,0,3,2,5,4]]
     for seat in seats if mixed else[None]:
      for arm in ['candidate','control']if mixed else['candidate']:
       cfg=dict(seed=seed,lineup=lineup,heroIds=heroes,start=start,team=team)
       if mixed:cfg['seatPolicies']=['experimental/plans-4'if i==seat and arm=='candidate'else'v1.4'if i==seat or i not in seats else'experimental/style-'+endpoint for i in range(6)]
       games.append(dict(id=len(games),endpoint=endpoint,opponent='v1.4'if mixed else endpoint,seat=seat,arm=arm,pairId=':'.join(map(str,[endpoint,seed,lineup,start,team,seat]))if mixed else None,config=cfg))
assert len(games)==25920
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d);(root/'analyze.mjs').write_text(source.read_text());pr=root/'artifacts/ai/mandatory-refresh';pr.mkdir(parents=True);(pr/'protocol.json').write_text(json.dumps(protocol));data=root/'data';data.mkdir()
 for i in range(4):(data/f'complete-{i}.json').write_text(json.dumps(dict(sha='synthetic',shard=i,count=4)))
 (data/'runner-exit.json').write_text(json.dumps([dict(shard=i,code=0)for i in range(4)]))
 results={}
 for mode in ['valid','wrong_hero','wrong_opponent','wrong_pair_id','negative_delta','duplicate_primary_cell','wrong_secondary_seed_range','missing_row','duplicate_row','wrong_arm','wrong_teammate','truncated','null_loss']:
  gs=copy.deepcopy(games)
  if mode=='wrong_hero':gs[0]['config']['heroIds'][0]='priest'
  if mode=='wrong_opponent':gs[0]['opponent']='v1.0'
  if mode=='wrong_pair_id':gs[-1]['pairId']='wrong'
  if mode=='duplicate_primary_cell':gs[2]['config']=copy.deepcopy(gs[0]['config'])
  if mode=='wrong_secondary_seed_range':
   for g in gs:
    if g['endpoint']=='v1.3':g['config']['seed']+=100000
  rows=[dict(**g,**g['config'],winner=g['config']['team'],outcome='win',turns=20)for g in gs]
  if mode=='negative_delta':
   for r in rows:
    if r['endpoint']=='flow' and r['arm']=='candidate':r.update(outcome='loss',winner='blue'if r['team']=='red'else'red')
  if mode=='missing_row':rows.pop()
  if mode=='duplicate_row':rows[-1]=copy.deepcopy(rows[-2])
  if mode=='wrong_arm':rows[-1]['arm']='candidate'
  if mode=='wrong_teammate':rows[-1]['seatPolicies']=['v1.4']*6
  if mode=='truncated':rows[0].update(winner=None,outcome='truncated')
  if mode=='null_loss':rows[0].update(winner=None,outcome='loss')
  (data/'manifest.json').write_text(json.dumps(dict(sha='synthetic',games=gs)))
  for i in range(4):(data/f'games-{i}.jsonl').write_text(''.join(json.dumps(r)+'\n'for r in rows if r['id']%4==i))
  run=subprocess.run(['node','analyze.mjs','data'],cwd=root,capture_output=True,text=True)
  results[mode]='ACCEPTED'if run.returncode==0 else'REJECTED'
  print(mode,results[mode],flush=True)
pathlib.Path('/tmp/v15-paired-analyzer-check-results.json').write_text(json.dumps(results,indent=2))
