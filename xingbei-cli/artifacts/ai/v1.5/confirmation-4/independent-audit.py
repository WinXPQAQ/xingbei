"""Independent fixed-design validation. --manifest-only never reads match outcomes."""
import collections
import hashlib
import json
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parent
project = root.parents[3]
manifest = json.loads((root / 'manifest.json').read_text())
assert manifest['sha'] == 'a0e9baaf622432935de4c01dbf996f738ff7801b'
rosters = {
 'mirrorAssault': ['berserker','berserker','windSwordmaster','windSwordmaster','marksman','marksman'],
 'mirrorMixed': ['sealer','sealer','guardianAngel','guardianAngel','priest','priest'],
 'asymmetric': ['berserker','priest','sealer','marksman','guardianAngel','windSwordmaster'],
 'asymmetricReverse': ['priest','berserker','marksman','sealer','windSwordmaster','guardianAngel'],
}
expected = []
for endpoint, seed_count in [('v1.4',120),('v1.3',20),('v1.2',20),('v1.0',20),('flow',30),('reserve',30)]:
 mixed = endpoint in ['flow','reserve']
 for seed in range(1540001,1540001+seed_count):
  for lineup, heroes in rosters.items():
   for start in range(6):
    for team in ['red','blue']:
     seats = [0,3,4] if team=='red' else [1,2,5]
     for seat in seats if mixed else [None]:
      for arm in ['candidate','control'] if mixed else ['candidate']:
       config = dict(seed=seed,lineup=lineup,heroIds=heroes if team=='red' else [heroes[i] for i in [1,0,3,2,5,4]],start=start,team=team)
       if mixed:
        policies=['v1.4']*6
        for teammate in seats: policies[teammate]='experimental/style-'+endpoint
        policies[seat]='experimental/plans-4' if arm=='candidate' else 'v1.4'
        config['seatPolicies']=policies
       expected.append(dict(id=len(expected),endpoint=endpoint,opponent='v1.4' if mixed else endpoint,seat=seat,arm=arm,pairId=':'.join(map(str,[endpoint,seed,lineup,start,team,seat])) if mixed else None,config=config))
assert len(expected)==25920 and manifest['games']==expected
for file,digest in manifest['hashes'].items():
 assert hashlib.sha256((project/file).read_bytes()).hexdigest()==digest, file
 frozen=subprocess.check_output(['git','show',manifest['sha']+':xingbei-cli/'+file],cwd=project)
 assert hashlib.sha256(frozen).hexdigest()==digest, file
result={'sha':manifest['sha'],'manifestGames':len(expected),'frozenFilesVerified':len(manifest['hashes']),'exactFactorial':True}
if '--manifest-only' in sys.argv:
 (root/'independent-manifest-audit.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2))
 sys.exit(0)

# Refuse partial runs before loading any outcome data.
for shard in range(4):
 done=json.loads((root/f'complete-{shard}.json').read_text())
 assert done['sha']==manifest['sha'] and done['shard']==shard and done['count']==4
exits=json.loads((root/'runner-exit.json').read_text())
assert len(exits)==4 and sorted(x['shard'] for x in exits)==list(range(4)) and all(x['code']==0 for x in exits)
assert {f.name for f in root.glob('games-*.jsonl')}=={f'games-{i}.jsonl' for i in range(4)}
rows=[]
for shard in range(4):
 chunk=[json.loads(line) for line in (root/f'games-{shard}.jsonl').read_text().splitlines()]
 assert len(chunk)==6480 and all(r['id']%4==shard for r in chunk)
 rows.extend(chunk)
assert len(rows)==25920 and {r['id'] for r in rows}==set(range(25920))
for r in rows:
 assert type(r['id']) is int
 spec=expected[r['id']]
 assert all(r[k]==v for k,v in spec.items())
 assert all(r[k]==v for k,v in spec['config'].items())
 assert type(r['turns']) is int and 0<=r['turns']<=300
 assert r['outcome'] in ['win','loss','truncated']
 assert r['winner'] in [None,'red','blue']
 outcome='truncated' if r['winner'] is None else 'win' if r['winner']==r['team'] else 'loss'
 assert r['outcome']==outcome and not r.get('error')

def score(r): return 1 if r['outcome']=='win' else 0 if r['outcome']=='loss' else .5

def absolute(data):
 counts=collections.Counter(r['outcome'] for r in data)
 return dict(games=len(data),wins=counts['win'],losses=counts['loss'],truncated=counts['truncated'],score=sum(map(score,data))/len(data))

state=1505001
def interval(data,metric,nseeds,cluster_size):
 global state
 groups=collections.defaultdict(list)
 for r in data: groups[r['seed']].append(metric(r))
 assert sorted(groups)==list(range(1540001,1540001+nseeds))
 assert all(len(a)==cluster_size for a in groups.values())
 means=[sum(groups[s])/len(groups[s]) for s in sorted(groups)]
 samples=[]
 for repeat in range(10000):
  total=0
  for _ in means:
   state=(1664525*state+1013904223)&0xffffffff
   total+=means[int(state/4294967296*nseeds)]
  samples.append(total/nseeds)
 return dict(mean=sum(means)/len(means),oneSided993Lower=sorted(samples)[70])

primary=[r for r in rows if r['endpoint']=='v1.4']
overall={**absolute(primary),**interval(primary,score,120,48)}
overall['passed']=overall['score']>=.5 and overall['oneSided993Lower']>=.45
lineups={}
for lineup in rosters:
 data=[r for r in primary if r['lineup']==lineup]
 item={**absolute(data),**interval(data,score,120,12)}
 item['passed']=item['oneSided993Lower']>=.45
 lineups[lineup]=item
mixed={}
for style in ['flow','reserve']:
 data=[r for r in rows if r['endpoint']==style]
 pairs=collections.defaultdict(dict)
 for r in data:
  assert r['arm'] not in pairs[r['pairId']]
  pairs[r['pairId']][r['arm']]=r
 assert len(pairs)==4320
 differences=[]
 for pair in pairs.values():
  assert set(pair)=={'candidate','control'}
  a,b=pair['candidate'],pair['control']
  assert {k:v for k,v in a['config'].items() if k!='seatPolicies'}=={k:v for k,v in b['config'].items() if k!='seatPolicies'}
  assert [i for i in range(6) if a['seatPolicies'][i]!=b['seatPolicies'][i]]==[a['seat']]
  differences.append(dict(seed=a['seed'],delta=score(a)-score(b)))
 item=dict(candidate=absolute([r for r in data if r['arm']=='candidate']),control=absolute([r for r in data if r['arm']=='control']),**interval(differences,lambda r:r['delta'],30,144))
 item['passed']=item['mean']>=0 and item['oneSided993Lower']>=-.05
 mixed[style]=item
secondary={}
for endpoint in ['v1.3','v1.2','v1.0']:
 item=absolute([r for r in rows if r['endpoint']==endpoint])
 item['passed']=item['score']>=.45
 secondary[endpoint]=item
match_passed=not any(r['outcome']=='truncated' for r in rows) and all(x['passed'] for x in [overall,*lineups.values(),*mixed.values(),*secondary.values()])

# Recalculate the separately measured frozen-candidate performance evidence.
perf=json.loads((project/'artifacts/ai/v1.5/plans4-performance.json').read_text())
assert len(perf['sourceHashes'])>=4
for file,digest in perf['sourceHashes'].items(): assert manifest['hashes'][file]==digest
records=perf['records'];candidate='experimental/plans-4';baseline='experimental/targeted-fixes-1'
assert len(records)==1800
assert {(r['index'],r['repeat'],r['version']) for r in records}=={(i,n,v) for i in range(180) for n in range(1,6) for v in [baseline,candidate]}
groups=collections.defaultdict(lambda:collections.defaultdict(list))
for r in records: groups[r['hero']+':'+str(r['group'])][r['version']].append(r['ms'])
assert len(groups)==18
quant=lambda a,p:sorted(a)[int(len(a)*p)]
ratios={}
for key,versions in groups.items():
 a,b=versions[candidate],versions[baseline]
 ratios[key]={'medianRatio':quant(a,.5)/quant(b,.5),'p95Ratio':quant(a,.95)/quant(b,.95)}
values=[r['ms'] for r in records if r['version']==candidate]
p95,maximum=quant(values,.95),max(values)
performance_passed=p95<=100 and maximum<=500 and all(r['medianRatio']<=2 and r['p95Ratio']<=2 for r in ratios.values())
result.update(games=len(rows),overall=overall,lineups=lineups,mixed=mixed,secondary=secondary,matchPassed=match_passed,performance={'p95':p95,'max':maximum,'groups':ratios,'passed':performance_passed},passed=match_passed and performance_passed,scope='Independent match and performance gates only; code/rules/privacy review and test gates require their separate evidence.')
(root/'independent-acceptance-recalculation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
