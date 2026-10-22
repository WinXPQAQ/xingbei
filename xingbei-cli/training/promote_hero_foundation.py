"""Conditionally publish the preregistered candidate, never force-push main."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import torch

ROOT=Path.home()/'.local/share/xingbei-ml'
NAME='hero-foundation-211'
STATUS=ROOT/'evidence'/f'{NAME}-promotion.json'

def record(state, **details):
    temp=STATUS.with_suffix('.tmp');temp.write_text(json.dumps({'state':state,'atUnix':time.time(),**details},indent=2)+'\n');temp.replace(STATUS)

def command(args,cwd):
    return subprocess.check_output(args,cwd=cwd,text=True,stderr=subprocess.STDOUT)

def main(args):
    deadline=time.monotonic()+15000
    gate=ROOT/'evidence'/f'{NAME}-status.json'
    while time.monotonic()<deadline:
        state=json.loads(gate.read_text()) if gate.exists() else {}
        if state.get('state') in ('not-promoted','failed'):
            record('not-promoted',reason=state);return
        if state.get('state')=='eligible-for-promotion':break
        time.sleep(30)
    else:raise RuntimeError('Timed out waiting for registered evaluation')
    run=ROOT/'runs'/NAME
    checkpoint=run/'checkpoint-192.pt'
    digest=hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    if digest!=state['checkpointSha256']:raise ValueError('Checkpoint changed after evaluation')
    sys.path.insert(0,str(run/'source/training'))
    from evaluation_stats import summarize
    from league import configs
    source_manifest=json.loads((run/'launch-manifest.json').read_text())
    eval_dir=ROOT/'evaluations'/NAME
    manifest=json.loads((eval_dir/'manifest.json').read_text())
    if manifest['policies']['candidate']['sha256']!=digest or manifest['firstSeed']!=254100000 or manifest['seeds']!=36:
        raise ValueError('Unexpected confirmation identity or seed range')
    results={}
    for opponent in ['v1.5','ai151']:
        rows=[json.loads(line) for line in (eval_dir/f'candidate-vs-{opponent}.jsonl').read_text().splitlines()]
        expected=configs(254100000,36,'candidate',opponent)
        key=lambda row:(row['seed'],row['lineup'],row['team'],row['start'])
        if len(rows)!=1008 or {key(r) for r in rows}!={key(r) for r in expected}:raise ValueError('Incomplete confirmation schedule')
        expected_by_key={key(r):r for r in expected}
        if any(r['seatPolicies']!=expected_by_key[key(r)]['seatPolicies'] or not r['terminated'] for r in rows):raise ValueError('Wrong actors or incomplete games')
        result=summarize(rows)
        if result['truncated'] or result['seedCluster95'][0]<=.5:raise ValueError('Independent gate recomputation failed')
        results[opponent]=result
    # Publish from a dedicated checkout; other threads' files and main checkout are untouched.
    repo=Path(args.repo)
    command(['git','fetch','origin','main'],repo)
    checkout=ROOT/'promotion'/NAME
    checkout.parent.mkdir(parents=True,exist_ok=True)
    command(['git','worktree','add','-b','codex/hero-foundation-release',str(checkout),'origin/main'],repo)
    git=['git','-c','user.name=Codex','-c','user.email=codex@localhost']
    command(git+['merge','--no-ff',args.commit,'-m','Merge evaluated hero foundation training and model support'],checkout)
    project=checkout/'xingbei-cli'
    # Engine/AI used for acceptance must exactly match the published implementation.
    for relative,sha in source_manifest['sourceHashes'].items():
        if relative.startswith('src/') and hashlib.sha256((project/relative).read_bytes()).hexdigest()!=sha:
            raise ValueError('Published engine differs from evaluated source: '+relative)
    saved=torch.load(checkpoint,map_location='cpu',weights_only=False)
    artifact=project/'training/models/ai-1.5.3.pt';artifact.parent.mkdir(parents=True,exist_ok=True)
    for key in ['optimizer','torch_rng','cuda_rng','python_rng']:saved.pop(key,None)
    # Training state is retained locally; the public artifact contains inference weights and metadata.
    torch.save(saved,artifact)
    artifact_sha=hashlib.sha256(artifact.read_bytes()).hexdigest()
    releases_path=project/'training/ai-releases.json'
    releases=json.loads(releases_path.read_text())
    if '1.5.3' in releases:raise ValueError('Refusing to overwrite release identity')
    releases['1.5.3']={'checkpointSha256':artifact_sha,'sourceCheckpointSha256':digest,'run':NAME,'completed':192,'baseline':'experimental/hero-foundation-1','scope':'Fixed checkpoint confirmation passed against frozen v1.5 and AI 1.5.1; full-team seven-lineup scope only','results':results}
    releases_path.write_text(json.dumps(releases,indent=2)+'\n')
    (project/'training/default-model.json').write_text(json.dumps({'release':'1.5.3','checkpoint':'models/ai-1.5.3.pt','baseline':'experimental/hero-foundation-1','sha256':artifact_sha},indent=2)+'\n')
    evidence=project/'docs/hero-foundation-confirmation';evidence.mkdir()
    for filename in ['manifest.json','report.json','candidate-vs-v1.5.jsonl','candidate-vs-ai151.jsonl']:
        (evidence/filename).write_bytes((eval_dir/filename).read_bytes())
    (project/'docs/ai-1.5.3-release.md').write_text('# AI 1.5.3\n\n新评分规则加适配网络作为当前混合模型基线；旧AI版本身份不覆盖。\n\n'+json.dumps(results,ensure_ascii=False,indent=2)+'\n\n仅证明本轮七阵容全队对战范围，不声称真人强度或70%达标。原始评测见hero-foundation-confirmation。\n\n`python training/serve_model.py --checkpoint training/models/ai-1.5.3.pt --release 1.5.3 --port 4175` 启动推理，随后 `MODEL_PORT=4175 TEST_MODE=1 npm run web` 启动混合模型网页。需要已有PyTorch环境。未配置MODEL_PORT时保持旧纯规则AI，不冒称已使用网络。服务部署独立于git发布，本次不停止或重启现有服务。\n')
    record('validating-release',checkout=str(checkout),results=results)
    with (ROOT/'evidence'/f'{NAME}-release-tests.log').open('w') as log:
        subprocess.run(['npm','test'],cwd=project,check=True,stdout=log,stderr=subprocess.STDOUT,timeout=300)
        subprocess.run([sys.executable,'-m','unittest','discover','-s','training','-p','*_test.py'],cwd=project,check=True,stdout=log,stderr=subprocess.STDOUT,timeout=300)
    command(git+['add','xingbei-cli/training/ai-releases.json','xingbei-cli/training/default-model.json','xingbei-cli/docs'],checkout)
    command(git+['add','-f','xingbei-cli/training/models/ai-1.5.3.pt'],checkout)
    command(git+['commit','-m','Promote confirmed hero foundation hybrid AI 1.5.3'],checkout)
    # Normal push fails safely if another thread advanced remote main.
    output=command(['git','push','origin','HEAD:main'],checkout)
    record('published',commit=command(['git','rev-parse','HEAD'],checkout).strip(),results=results,checkpointSha256=artifact_sha,push=output,services='unchanged')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',required=True);parser.add_argument('--commit',required=True)
    try:main(parser.parse_args())
    except Exception as error:
        record('blocked',error=str(error));raise
