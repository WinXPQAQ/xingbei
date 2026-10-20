import pathlib,json,hashlib,collections
p=pathlib.Path('/workspace/xingbei/xingbei-cli');root=p/'artifacts/ai/v1.5/plans4-final-development';m=json.loads((root/'manifest.json').read_text());rows=[json.loads(l)for f in [root/'reused.jsonl',*sorted(root.glob('games-*.jsonl'))]for l in f.read_text().splitlines()];old=[json.loads(l)for l in(p/'artifacts/ai/v1.5/plans3-mixed-matched-development.jsonl').read_text().splitlines()];expected={r['id']:r for r in m['games']};assert len(rows)==len(expected)==384
for f,h in m['hashes'].items():assert hashlib.sha256((p/f).read_bytes()).hexdigest()==h
pairs=collections.defaultdict(dict);reused=0
key=lambda r:tuple(r[k]for k in ['style','seed','lineup','start','team','seat'])
for r in rows:
 e=expected.pop(r['id']);assert all(r[k]==v for k,v in e.items());assert all(r[k]==v for k,v in e['config'].items());assert type(r['turns'])is int and 0<=r['turns']<=300;assert r['outcome']in['win','loss'];assert r['winner']in['red','blue'];assert(r['outcome']=='win')==(r['team']==r['winner']);assert r['candidate']not in pairs[key(r)];pairs[key(r)][r['candidate']]=r
 if r['reuse']:
  reused+=1;assert r['seed']==1501001 and r['candidate']=='v1.4';matches=[o for o in old if key(o)==key(r)and o['candidate']=='v1.4'];assert len(matches)==1
  assert all(r[k]==v for k,v in matches[0].items());assert r['reusedFrom']=='plans3-mixed-matched-development.jsonl'
assert not expected and reused==96 and len(pairs)==192
rosters=json.loads((p/'artifacts/ai/mandatory-refresh/protocol.json').read_text())['rosters'];wanted={(style,seed,lineup,start,team,seat)for style in ['flow','reserve']for seed in [1501001,1501002]for lineup in rosters for start in [0,3]for team in ['red','blue']for seat in ([0,3,4]if team=='red'else[1,2,5])};assert set(pairs)==wanted
out={}
for style in ['flow','reserve']:
 c=collections.Counter();by={}
 for k,rs in pairs.items():
  assert set(rs)=={'v1.4','experimental/plans-4'};a,b=rs['experimental/plans-4'],rs['v1.4'];seat=a['seat'];seats=[0,3,4]if a['team']=='red'else[1,2,5]
  for field in ['seed','heroIds','lineup','start','team','initial']:assert a[field]==b[field]
  for i in range(6):
   assert a['seatPolicies'][i]==('experimental/plans-4'if i==seat else'experimental/style-'+a['style']if i in seats else'v1.4');assert b['seatPolicies'][i]==('v1.4'if i==seat else a['seatPolicies'][i])
  if k[0]!=style:continue
  av=int(a['outcome']=='win');bv=int(b['outcome']=='win');c['candidateWins']+=av;c['controlWins']+=bv;c['improved']+=av>bv;c['worsened']+=av<bv;by.setdefault(k[1],collections.Counter()).update({'candidateWins':av,'controlWins':bv})
 c['delta']=(c['candidateWins']-c['controlWins'])/96;out[style]={**c,'bySeed':by}
exits=json.loads((root/'runner-exit.json').read_text());assert sorted(x['shard']for x in exits)==[0,1,2,3]and all(x['code']==0 for x in exits)
result={'records':384,'reusedControls':reused,'newRecords':288,'hashesMatched':len(m['hashes']),'summary':out};print(json.dumps(result,indent=2));(root/'independent-development-review.json').write_text(json.dumps(result,indent=2))
