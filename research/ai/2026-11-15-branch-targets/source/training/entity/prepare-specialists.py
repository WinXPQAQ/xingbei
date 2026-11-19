"""Create a reproducible local snapshot; never modify a service or source model."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import time


def transfer_sage_policy(drill, full_game):
    """Keep the drill actor exactly; replace its return critic with a win critic."""
    import copy
    import torch
    from model import EntityPolicy
    if drill['schema'] != full_game['schema']:
        raise ValueError('Policy and full-game schemas differ')
    if any(drill['config'][k] != full_game['config'][k] for k in ('width', 'layers')):
        raise ValueError('Policy and full-game network dimensions differ')
    if not set(full_game['symbols']).issubset(drill['symbols']):
        raise ValueError('Drill vocabulary omits full-game symbols')
    state = {name: value.clone() for name, value in drill['state'].items()}
    symbol_ids = {symbol:i for i,symbol in enumerate(drill['symbols'])}
    indices = torch.tensor([symbol_ids[symbol] for symbol in full_game['symbols']])
    for name, value in full_game['state'].items():
        if not name.startswith(('critic.', 'value.')):
            continue
        if name in ('critic.features.weight', 'critic.roles.weight'):
            state[name].zero_()
            state[name][indices] = value
        else:
            if state[name].shape != value.shape:
                raise ValueError(f'Critic dimensions differ: {name}')
            state[name] = value.clone()
    config = copy.deepcopy(drill['config'])
    config.pop('value_scale', None)
    if full_game['config'].get('value_scale', 1) != 1:
        raise ValueError('Full-game critic must predict bounded team return')
    result = dict(schema=drill['schema'], architecture=drill['architecture'],
        config=config, symbols=list(drill['symbols']), state=state,
        observation_contract=drill.get('observation_contract'),
        transfer=dict(actor='unchanged drill actor and score', critic='full-game critic, vocabulary mapped by symbol',
                      optimizer='reset', reward='terminal-team-win-only', source_drill_round=drill.get('drill_round')))
    EntityPolicy.restore(result)
    return result


def prepare(directory, current, anchor, human, *, root=None, sage_policy=None):
    root=Path(root) if root else Path(__file__).resolve().parents[2]
    files={}
    for folder in ('src','training'):
        for path in (root/folder).rglob('*'):
            if path.is_file() and '__pycache__' not in path.parts and path.suffix not in ('.pyc', '.pt') and 'results' not in path.parts:
                files[str(path.relative_to(root))]=path.read_bytes()
    files['package.json']=(root/'package.json').read_bytes()
    digest=hashlib.sha256()
    for name, body in sorted(files.items()):
        digest.update(name.encode()+b'\0'+body)
    revision='specialists-standard-'+digest.hexdigest()[:16]
    directory.mkdir(parents=True,exist_ok=False)
    source=directory/'source/xingbei-cli'
    for name, body in files.items():
        destination=source/name;destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(body)
    hashes={}
    for filename, path in [('frozen-current.pt',current),('frozen-417.pt',anchor)]:
        shutil.copyfile(path,directory/filename)
        hashes[filename]=hashlib.sha256((directory/filename).read_bytes()).hexdigest()
    shutil.copyfile(human,directory/'sage-human.jsonl')
    shutil.copyfile(Path(str(human)+'.report.json'),directory/'sage-human.jsonl.report.json')
    manifest=dict(created_at=time.time(),revision=revision,ruleVariant='standard',source_sha256=digest.hexdigest(),
        source_files={name:hashlib.sha256(body).hexdigest()for name,body in files.items()},checkpoint_sha256=hashes,
        human_reference_sha256=hashlib.sha256(human.read_bytes()).hexdigest(),
        lineage=dict(current=str(current),anchor417=str(anchor),reward_change='morale-only to normal cups and morale',optimizer='reset on fork, preserved on specialist resume'),
        architecture='Same structured entities policy and parameter-independent critic; separate specialist copies',
        learning='One hero seat only; terminal team wins; no mechanism shaping',
        human='First Sage game actor reference weight 0.05 for first16 rounds; second diagnostic only, never treated as correct by definition',
        evaluation='Same seeded lineup and five frozen controllers; only focal hero replaced; six-rotation cluster intervals',
        inability_policy='terminal-loss-archive-and-continue',other_rule_errors='archive-and-stop')
    if sage_policy:
        import torch
        result=transfer_sage_policy(torch.load(sage_policy,map_location='cpu',weights_only=False),
                                   torch.load(current,map_location='cpu',weights_only=False))
        torch.save(result,directory/'sage-initial.pt')
        manifest['initial_checkpoints']={'sage':dict(file='sage-initial.pt',
            sha256=hashlib.sha256((directory/'sage-initial.pt').read_bytes()).hexdigest())}
        manifest['lineage'].update(sage_policy=str(sage_policy),sage_policy_sha256=hashlib.sha256(sage_policy.read_bytes()).hexdigest(),
            reward_change='Sage drill damage and retention bonus to terminal team win',transfer=result['transfer'])
        manifest['human_reference_rounds']=0
        manifest['human']='Historical games diagnostic only; no imitation restart for transferred Sage'
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for key in ('directory','current','anchor','human'):parser.add_argument(key,type=Path)
    parser.add_argument('--source',type=Path)
    parser.add_argument('--sage-policy',type=Path)
    args=parser.parse_args()
    print(json.dumps(prepare(args.directory.resolve(),args.current.resolve(),args.anchor.resolve(),args.human.resolve(),
        root=args.source,sage_policy=args.sage_policy.resolve() if args.sage_policy else None),ensure_ascii=False))
