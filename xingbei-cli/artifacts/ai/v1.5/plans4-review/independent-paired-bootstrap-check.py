from pathlib import Path
exec(Path(__file__).with_name('independent-paired-tool-check.py').read_text().split('with tempfile.TemporaryDirectory()')[0])
with tempfile.TemporaryDirectory()as d:
 root=pathlib.Path(d);(root/'analyze.mjs').write_text(source.read_text());pr=root/'artifacts/ai/mandatory-refresh';pr.mkdir(parents=True);(pr/'protocol.json').write_text(json.dumps(protocol));data=root/'data';data.mkdir();rows=[]
 for g in games:
  seed=g['config']['seed'];mixed=g['endpoint']in['flow','reserve'];k=g['id']//2 if mixed else g['id'];win=(k%10<(2 if g['arm']=='control'else 2+seed%4))if mixed else k%12<7+seed%4
  rows.append(dict(**g,**g['config'],winner=g['config']['team']if win else'blue'if g['config']['team']=='red'else'red',outcome='win'if win else'loss',turns=20))
 (data/'manifest.json').write_text(json.dumps(dict(sha='synthetic',games=games)))
 for i in range(4):
  (data/f'complete-{i}.json').write_text(json.dumps(dict(sha='synthetic',shard=i,count=4)))
  (data/f'games-{i}.jsonl').write_text(''.join(json.dumps(r)+'\n'for r in rows if r['id']%4==i))
 (data/'runner-exit.json').write_text(json.dumps([dict(shard=i,code=0)for i in range(4)]))
 run=subprocess.run(['node','analyze.mjs','data'],cwd=root,capture_output=True);actual=json.loads((data/'summary.json').read_text());rng=1505001;out={}
 def boot(group):
  global rng
  seeds=sorted(group);means=[sum(group[s])/len(group[s])for s in seeds];samples=[]
  for i in range(10000):
   total=0
   for j in means:
    rng=(rng*1664525+1013904223)&0xffffffff;total+=means[int(rng/4294967296*len(means))]
   samples.append(total/len(means))
  return sorted(samples)[70]
 for name in ['overall',*protocol['rosters'],'flow','reserve']:
  group={}
  if name in ['flow','reserve']:
   pairs={}
   for r in rows:
    if r['endpoint']==name:pairs.setdefault(r['pairId'],{})[r['arm']]=r
   for pair in pairs.values():
    a,b=pair['candidate'],pair['control'];group.setdefault(a['seed'],[]).append(int(a['outcome']=='win')-int(b['outcome']=='win'))
   target=actual['mixed'][name]
  else:
   for r in rows:
    if r['endpoint']=='v1.4'and(name=='overall'or r['lineup']==name):group.setdefault(r['seed'],[]).append(int(r['outcome']=='win'))
   target=actual['overall']if name=='overall'else actual['lineups'][name]
  bound=boot(group);assert abs(bound-target['oneSided993Lower'])<1e-12;out[name]=bound
 print(json.dumps({'independentPythonSevenBoundsMatch':True,'bounds':out},indent=2));pathlib.Path('/tmp/v15-paired-bootstrap-check-results.json').write_text(json.dumps(out,indent=2))
