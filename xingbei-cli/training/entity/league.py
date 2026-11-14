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
def training_configs(*, index, count, completed, revision, positions, excluded, historical, curriculum='scheduled', league_profile='classic', anchor=None):
    if league_profile not in ('classic', 'diverse-v1'):
        raise ValueError('Unknown opponent league profile')
    if league_profile == 'diverse-v1' and not anchor:
        raise ValueError('Diverse league requires the frozen 417 anchor')
    if curriculum not in ('scheduled', 'endgame'):
        raise ValueError('Unknown curriculum')
    weights=(.5,.25,.25) if curriculum=='endgame' or completed<5000 else (.3,.3,.4) if completed<15000 else (.15,.15,.7)
    rng=random.Random(810103000+index)
    pools={k:[] for k in ['ending','middle']}
    for position in positions:
        if (position['sourceSeed'] not in excluded and position['revision']==revision
            and not any(hero in catalog()['excludedTrainingHeroes'] for hero in position['config'].get('heroIds', []))):
            pools[position['category']].append(position)
    for pool in pools.values(): rng.shuffle(pool)
    used=set(); configs=[]; counts=dict(ending=0,middle=0,full=0)
    kinds=['ending']*int(count*weights[0])+['middle']*int(count*weights[1])
    kinds+=['full']*(count-len(kinds));rng.shuffle(kinds)
    # Exactly half self, quarter rule, quarter history per round, spread over sides.
    if league_profile == 'diverse-v1':
        mixture=[('self',.30),(anchor,.20),(historical or 'self',.15),
                 (catalog()['ruleTeacher'],.15),('v1.5',.10),('legacy-score-partial-v1',.10)]
        amounts=[int(count*weight) for _,weight in mixture]
        remainders=sorted(range(len(mixture)),key=lambda i:-(count*mixture[i][1]-amounts[i]))
        for i in remainders[:count-sum(amounts)]: amounts[i]+=1
        opponents=[name for (name,_),n in zip(mixture,amounts) for _ in range(n)]
    else:
        opponents=['self']*(count//2)+[catalog()['ruleTeacher']]*(count//4)+[historical or 'self']*(count-count//2-count//4)
    rng.shuffle(opponents)
    for i,kind in enumerate(kinds):
        config=configuration(index+i,831103000,revision)
        # v1.5 has six implemented hero policies; do not mislabel generic
        # fallback on 64 later heroes as a full-roster v1.5 opponent.
        if opponents[i] == 'v1.5':
            heroes=['berserker','windSwordmaster','marksman','sealer','guardianAngel','priest']
            rng.shuffle(heroes);config['heroIds']=heroes;kind='full'
        if kind!='full':
            pool=pools[kind]
            while pool and pool[-1]['sourceSeed'] in used: pool.pop()
            if pool:
                position=pool.pop();used.add(position['sourceSeed'])
                if hasattr(positions, 'resolve'): position=positions.resolve(position)
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


def opponent_weights(paths, results):
    """PFSP-style hard-opponent sampling with a uniform exploration floor.

    Counts come from completed training matches, with a 2-win/2-loss prior.
    They are matchmaking estimates, not held-out strength measurements.
    """
    if not paths:
        return []
    difficulty = []
    for path in paths:
        record = results.get(path, {})
        win_rate = (record.get('wins', 0)+2)/(record.get('games', 0)+4)
        difficulty.append((1-win_rate)**2)
    total = sum(difficulty)
    return [0.2/len(paths)+0.8*weight/total for weight in difficulty]
