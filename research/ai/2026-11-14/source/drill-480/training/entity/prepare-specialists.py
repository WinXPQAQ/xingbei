"""Create a reproducible local snapshot; never modify a service or source model."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import time


def prepare(directory, current, anchor, human):
    root=Path(__file__).resolve().parents[2]
    files={}
    for folder in ('src','training'):
        for path in (root/folder).rglob('*'):
            if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
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
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for key in ('directory','current','anchor','human'):parser.add_argument(key,type=Path)
    args=parser.parse_args()
    print(json.dumps(prepare(args.directory.resolve(),args.current.resolve(),args.anchor.resolve(),args.human.resolve()),ensure_ascii=False))
