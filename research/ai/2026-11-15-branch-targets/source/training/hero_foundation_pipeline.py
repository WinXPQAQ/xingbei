"""Wait for the registered endpoint, run fixed comparisons, and record promotion eligibility."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path.home()/'.local/share/xingbei-ml'
NAME = 'hero-foundation-211'
RUN = ROOT/'runs'/NAME
DEST = ROOT/'evaluations'/NAME
STATUS = ROOT/'evidence'/f'{NAME}-status.json'

def status(state, **fields):
    data={'state':state,'run':NAME,'updatedAtUnix':time.time(),**fields}
    temp=STATUS.with_suffix('.tmp');temp.write_text(json.dumps(data,indent=2)+'\n');temp.replace(STATUS)
    print(json.dumps(data),flush=True)

def run():
    deadline=time.monotonic()+7200
    while True:
        lines=(RUN/'metrics.jsonl').read_text().splitlines(keepends=True) if (RUN/'metrics.jsonl').exists() else []
        rows=[json.loads(line) for line in lines if line.endswith('\n')]
        completed=rows[-1]['iteration']+1 if rows else 0
        if completed>=192:break
        state=subprocess.check_output(['systemctl','--user','show','--property=ActiveState','--value',f'xingbei-ml-{NAME}.service'],text=True).strip()
        if state not in ('active','activating') or time.monotonic()>deadline:
            raise RuntimeError(f'Training stopped at {completed}: {state}')
        status('training',completed=completed,target=192)
        time.sleep(30)
    candidate=RUN/'checkpoint-192.pt'
    old=ROOT/'runs/residual-focused-candidate-211/checkpoint-192.pt'
    protocol={'scope':'Preregistered endpoint confirmation for hero foundation; no checkpoint selection on this set',
      'firstSeed':254100000,'seeds':36,
      'pairs':[['candidate','v1.5'],['candidate','ai151']],
      'policies':{'candidate':{'checkpoint':str(candidate),'sha256':hashlib.sha256(candidate.read_bytes()).hexdigest()},
       'v1.5':{'version':'v1.5'},'ai151':{'checkpoint':str(old),'sha256':hashlib.sha256(old.read_bytes()).hexdigest()}},
      'promotionGate':'Both direct-match seed-cluster 95% lower bounds > 0.5; zero truncations; 1008 games each. No seed/checkpoint retry.'}
    protocol_file=RUN/'confirmation-protocol.json';protocol_file.write_text(json.dumps(protocol,indent=2)+'\n')
    status('evaluating',protocol=str(protocol_file),completed=completed)
    with (ROOT/'evidence'/f'{NAME}-confirmation.log').open('x') as log:
        subprocess.run([sys.executable,str(RUN/'source/training/league.py'),'--protocol',str(protocol_file),'--output',str(DEST),'--device','cuda','--workers','8'],check=True,stdout=log,stderr=subprocess.STDOUT,timeout=7200)
    report=json.loads((DEST/'report.json').read_text())
    passed=len(report['pairs'])==2 and all(p['left']=='candidate' and p['leftResult']['games']==1008 and p['leftResult']['truncated']==0 and p['leftResult']['seedCluster95'][0]>.5 for p in report['pairs'])
    status('eligible-for-promotion' if passed else 'not-promoted',report=str(DEST/'report.json'),results=report['pairs'],checkpoint=str(candidate),checkpointSha256=protocol['policies']['candidate']['sha256'],next='Integrate and verify main without changing frozen historical aliases' if passed else 'Keep old baseline; do not push candidate as accepted')

if __name__=='__main__':
    try:run()
    except Exception as error:
        status('failed',error=str(error));raise
