"""Audit three paired matchups; retain the already completed A-C comparison."""
import argparse
import hashlib
import json
from pathlib import Path
from evaluation_stats import summarize
from league import configs


def build(old, new):
    old_manifest=json.loads((old/'manifest.json').read_text())
    new_manifest=json.loads((new/'manifest.json').read_text())
    if (old_manifest['firstSeed'],old_manifest['seeds'])!=(new_manifest['firstSeed'],new_manifest['seeds']):
        raise ValueError('Seed schedules differ')
    # All runtime code is from the same frozen evaluation snapshot.
    if old_manifest['sourceHashes']!=new_manifest['sourceHashes']:
        raise ValueError('Evaluator/engine source changed')
    for old_name,new_name in [('candidate','trained'),('ai151','original')]:
        if old_manifest['policies'][old_name]['sha256']!=new_manifest['policies'][new_name]['sha256']:
            raise ValueError('Shared model identity differs')
    if not new_manifest['controlVerification']['identicalParentTensors'] or new_manifest['controlVerification']['completed']!=0:
        raise ValueError('Control is not an untrained exact weight transfer')
    labels={'original':'A: old rules + original network','unchanged':'B: new rules + original network','trained':'C: new rules + trained network'}
    matrix={key:{} for key in labels};pairs=[]
    for directory,left,right,alias_left,alias_right in [
        (new,'unchanged','original','unchanged','original'),
        (new,'trained','unchanged','trained','unchanged'),
        (old,'candidate','ai151','trained','original')]:
        path=directory/f'{left}-vs-{right}.jsonl'
        rows=[json.loads(line) for line in path.read_text().splitlines()]
        expected=configs(new_manifest['firstSeed'],new_manifest['seeds'],left,right)
        key=lambda r:(r['seed'],r['lineup'],r['team'],r['start'])
        reference={key(r):r for r in expected}
        if len(rows)!=len(expected) or len({key(r) for r in rows})!=len(rows) or set(reference)!={key(r) for r in rows}:
            raise ValueError('Missing or duplicate fixtures')
        if any(r['seatPolicies']!=reference[key(r)]['seatPolicies'] or r['heroIds']!=reference[key(r)]['heroIds'] for r in rows):
            raise ValueError('Actors/roster mismatch')
        forward=summarize(rows)
        backward=summarize([{**r,'team':'blue' if r['team']=='red' else 'red'} for r in rows])
        matrix[alias_left][alias_right]=forward['resolvedWinRate']
        matrix[alias_right][alias_left]=backward['resolvedWinRate']
        pairs.append({'left':alias_left,'right':alias_right,'result':forward,'rawFile':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'reused':directory==old})
    return {'state':'complete','scope':'Post-hoc diagnostic comparison on previously used seeds; not a fresh acceptance test. Direct win rates are not additive causal contributions.','labels':labels,'matrix':matrix,'pairs':pairs,'controlVerification':new_manifest['controlVerification']}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--old',type=Path,required=True);p.add_argument('--new',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();result=build(a.old,a.new);a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
