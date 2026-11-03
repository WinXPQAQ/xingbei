"""Balanced all-hero configurations and source-disjoint replay curriculum."""
import json
import random
import subprocess
from functools import lru_cache
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
@lru_cache(maxsize=1)
def catalog():
    return json.loads(subprocess.check_output(['node','training/entity/rosters.mjs'],cwd=ROOT,text=True))
def roster(index): return catalog()['rosters'][index % 2400]
def configuration(index, seed_base, revision):
    return dict(seed=seed_base+index,heroIds=roster(index),start=index%6,revision=revision,profile=True)
def training_configs(*, index, count, completed, revision, positions, excluded, historical):
    weights=(.5,.25,.25) if completed<5000 else (.3,.3,.4) if completed<15000 else (.15,.15,.7)
    rng=random.Random(810103000+index)
    pools={k:[] for k in ['ending','middle']}
    for position in positions:
        if position['sourceSeed'] not in excluded and position['revision']==revision:
            pools[position['category']].append(position)
    for pool in pools.values(): rng.shuffle(pool)
    used=set(); configs=[]; counts=dict(ending=0,middle=0,full=0)
    kinds=['ending']*int(count*weights[0])+['middle']*int(count*weights[1])
    kinds+=['full']*(count-len(kinds));rng.shuffle(kinds)
    # Exactly half self, quarter rule, quarter history per round, spread over sides.
    opponents=['self']*(count//2)+['v1.9.0-preview.1']*(count//4)+[historical or 'self']*(count-count//2-count//4)
    rng.shuffle(opponents)
    for i,kind in enumerate(kinds):
        config=configuration(index+i,831103000,revision)
        if kind!='full':
            pool=pools[kind]
            while pool and pool[-1]['sourceSeed'] in used: pool.pop()
            if pool:
                position=pool.pop();used.add(position['sourceSeed'])
                config={**position['config'],'replay':position,'profile':True}
            else: kind='full'
        config.update(opponent=opponents[i],capture=True,curriculumKind=kind)
        # curriculumKind is bookkeeping; driver ignores unknown config fields.
        configs.append(config);counts[kind]+=1
    return configs,counts

def history_pool(paths):
    paths=list(dict.fromkeys(paths))
    if len(paths)<=8:return paths
    return [paths[round(i*(len(paths)-1)/7)] for i in range(8)]
