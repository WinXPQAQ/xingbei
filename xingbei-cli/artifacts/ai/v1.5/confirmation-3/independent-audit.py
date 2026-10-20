import json,pathlib,subprocess,hashlib,collections,math
p=pathlib.Path('/workspace/xingbei/xingbei-cli');root=p/'artifacts/ai/v1.5/confirmation-3';m=json.loads((root/'manifest.json').read_text());expected={r['id']:r for r in m['games']};errs=[];rows=[];partial=[]
for f in sorted(root.glob('games-*.jsonl')):
 for i,line in enumerate(f.read_text().splitlines()):
  try: rows.append(json.loads(line))
  except json.JSONDecodeError: partial.append([f.name,i])
for f,h in m['hashes'].items():
 if hashlib.sha256((p/f).read_bytes()).hexdigest()!=h:errs.append('hash '+f)
 commit=subprocess.check_output(['git','show',m['sha']+':xingbei-cli/'+f],cwd=p).strip() if False else None
seen=set()
for r in rows:
 if r['id'] in seen:errs.append('duplicate '+str(r['id']))
 seen.add(r['id']);e=expected.get(r['id'])
 if not e:errs.append('unexpected id');continue
 for k in ['endpoint','opponent','seat','config']:
  if r[k]!=e[k]:errs.append(f'row {r["id"]} {k}')
 for k,v in e['config'].items():
  if r[k]!=v:errs.append(f'row {r["id"]} flattened {k}')
 if r['outcome'] not in ['win','loss','truncated']:errs.append('outcome')
 if r['winner'] not in [None,'red','blue']:errs.append('winner enum')
 correct='truncated' if r['winner'] is None else 'win' if r['winner']==r['team'] else 'loss'
 if r['outcome']!=correct:errs.append('winner')
 if r['turns']>300:errs.append('turn bound')
counts=collections.Counter(r['endpoint'] for r in m['games']);route=[]
for e in m['games']:
 c=e['config'];seats=[0,3,4] if c['team']=='red' else [1,2,5]
 if e['seat'] is not None:
  pol=c['seatPolicies']
  want=['experimental/plans-3' if j==e['seat'] else 'experimental/style-'+e['endpoint'] if j in seats else 'v1.4' for j in range(6)]
  if pol!=want:route.append(e['id'])
perf=json.loads((p/'artifacts/ai/v1.5/development-performance.json').read_text());groups=collections.defaultdict(lambda:collections.defaultdict(list))
for r in perf['records']:groups[r['hero']+':'+str(r['group'])][r['version']].append(r['ms'])
def quant(a,q):return sorted(a)[int(len(a)*q)]
ratios={k:{'median':quant(v['experimental/plans-3'],.5)/quant(v['experimental/targeted-fixes-1'],.5),'p95':quant(v['experimental/plans-3'],.95)/quant(v['experimental/targeted-fixes-1'],.95)} for k,v in groups.items()}
v=[r['ms'] for r in perf['records'] if r['version']=='experimental/plans-3']
result={'sha':m['sha'],'expected':len(expected),'read':len(rows),'completeMarkers':[f.name for f in root.glob('complete-*')],'partialLines':partial,'errors':errs,'endpointExpected':dict(counts),'routingErrors':route,'performance':{'groups':len(groups),'records':len(perf['records']),'p95':quant(v,.95),'max':max(v),'maxMedianRatio':max(r['median'] for r in ratios.values()),'maxP95Ratio':max(r['p95'] for r in ratios.values())}}
print(json.dumps(result,indent=2))
# Verify every planned factorial cell, seed range, roster mapping and manifest hash against git object.
protocol=json.loads((p/'artifacts/ai/mandatory-refresh/protocol.json').read_text())
for endpoint,n in [('v1.4',120),('v1.3',20),('v1.2',20),('v1.0',20),('flow',30),('reserve',30)]:
 actual=collections.Counter((e['config']['seed'],e['config']['lineup'],e['config']['start'],e['config']['team'],e['seat']) for e in m['games'] if e['endpoint']==endpoint)
 want=collections.Counter((seed,lineup,start,team,seat) for seed in range(1530001,1530001+n) for lineup in protocol['rosters'] for start in range(6) for team in ['red','blue'] for seat in (([0,3,4] if team=='red' else [1,2,5]) if endpoint in ['flow','reserve'] else [None]))
 if actual!=want:errs.append('factorial '+endpoint)
for e in m['games']:
 c=e['config'];b=protocol['rosters'][c['lineup']];want=b if c['team']=='red' else [b[i] for i in [1,0,3,2,5,4]]
 if c['heroIds']!=want:errs.append('roster '+str(e['id']))
for f,h in m['hashes'].items():
 raw=subprocess.check_output(['git','show',m['sha']+':xingbei-cli/'+f],cwd=p)
 if hashlib.sha256(raw).hexdigest()!=h:errs.append('frozen object '+f)
print('Factorial / git-object audit:', 'PASS' if not errs else errs)
if len(rows)==len(expected) and seen==set(expected) and not errs and not partial:
 completes=[json.loads((root/f'complete-{i}.json').read_text()) for i in range(4)]
 assert all(c['sha']==m['sha'] and c['shard']==i and c['count']==4 for i,c in enumerate(completes))
 exits=json.loads((root/'runner-exit.json').read_text())
 assert len(exits)==4 and {e['shard'] for e in exits}==set(range(4)) and all(e['code']==0 for e in exits)
 rng=1505001
 def bootstrap(data):
  global rng
  grouped={}
  for r in data:grouped.setdefault(r['seed'],[]).append(1 if r['outcome']=='win' else 0 if r['outcome']=='loss' else .5)
  means=[sum(v)/len(v) for v in grouped.values()];samples=[]
  for i in range(10000):
   total=0
   for j in means:
    rng=(1664525*rng+1013904223)&0xffffffff
    total+=means[int(rng/4294967296*len(means))]
   samples.append(total/len(means))
  return sorted(samples)[100]
 def stats(data,boot=False):
  out=collections.Counter(r['outcome'] for r in data);score=(out['win']+.5*out['truncated'])/len(data)
  result={'games':len(data),'wins':out['win'],'losses':out['loss'],'truncated':out['truncated'],'score':score}
  if boot:result['oneSided99Lower']=bootstrap(data)
  result['gate']=result.get('oneSided99Lower',score)>=.45
  return result
 endpoints={e:stats([r for r in rows if r['endpoint']==e],e=='v1.4') for e in dict.fromkeys(r['endpoint'] for r in rows)}
 primary=[r for r in rows if r['endpoint']=='v1.4'];lineups={l:stats([r for r in primary if r['lineup']==l],True) for l in dict.fromkeys(r['lineup'] for r in primary)}
 result.update(endpoints=endpoints,lineups=lineups)
 result['passed']=all(r['outcome']!='truncated' for r in rows) and endpoints['v1.4']['score']>=.5 and all(r['gate'] for r in [*endpoints.values(),*lineups.values()])
 print(json.dumps(result,indent=2))
 (root/'independent-acceptance-recalculation.json').write_text(json.dumps(result,indent=2)+'\n')
