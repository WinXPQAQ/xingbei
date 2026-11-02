"""Small, reproducible transport/encoding check on identical saved decisions."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import torch
from model import EntityPolicy, collate, pack_observation

parser = argparse.ArgumentParser()
parser.add_argument('data')
parser.add_argument('checkpoint')
args = parser.parse_args()
torch.set_num_threads(2)
model, vocabulary = EntityPolicy.restore(torch.load(args.checkpoint, map_location='cpu', weights_only=False))
model.eval()
games = [json.loads(line) for line in Path(args.data).read_text().splitlines()]
all_observations = [d['observation'] for game in games for d in game['decisions']]
# Include the largest candidate set as well as evenly spaced decisions.
observations = [all_observations[i] for i in range(0, len(all_observations), max(1, len(all_observations) // 31))][:31]
observations.append(max(all_observations, key=lambda o: len(o['candidates'])))
root = Path(__file__).resolve().parents[2]
script = """
import fs from 'node:fs';
import {createWireEncoder} from './training/entity/wire.mjs';
const {symbols,observations} = JSON.parse(fs.readFileSync(0,'utf8'));
const pack = createWireEncoder(symbols), packed = observations.map(pack);
const start = performance.now();
for(let n=0;n<10;n++) observations.map(pack);
const packMs = (performance.now()-start)/10;
console.log(JSON.stringify({packed,packMs}));
"""
result = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=root,
                   input=json.dumps(dict(symbols=vocabulary.symbols, observations=observations)).encode()))
packed = result['packed']
raw_batch, packed_batch = collate(observations, vocabulary), collate(packed, vocabulary)
local_batch = collate([pack_observation(o, vocabulary) for o in observations], vocabulary)
for key, value in raw_batch.items():
    if isinstance(value, torch.Tensor) and not torch.equal(value, local_batch[key]):
        raise AssertionError(f'Cached feature changed {key}')
for key in raw_batch:
    a, b = raw_batch[key], packed_batch[key]
    if isinstance(a, torch.Tensor):
        if not torch.equal(a, b): raise AssertionError(f'Wire changed {key}')
    elif a != b: raise AssertionError(key)
with torch.inference_mode():
    if not torch.equal(model.policy_logits(raw_batch), model.policy_logits(packed_batch)):
        raise AssertionError('Wire changed model logits')

def measure(fn, device='cpu', repeats=10):
    fn()
    if device == 'cuda': torch.cuda.synchronize()
    start = time.perf_counter()
    for _ in range(repeats): fn()
    if device == 'cuda': torch.cuda.synchronize()
    return (time.perf_counter()-start)*1000/repeats

raw_json = json.dumps(observations, ensure_ascii=False, separators=(',', ':'))
packed_json = json.dumps(packed, separators=(',', ':'))
report = dict(samples=len(observations), candidates=sum(len(o['candidates']) for o in observations),
              node_pack_ms=result['packMs'], raw_bytes=len(raw_json.encode()), sparse_bytes=len(packed_json.encode()),
              raw_parse_ms=measure(lambda: json.loads(raw_json)), sparse_parse_ms=measure(lambda: json.loads(packed_json)),
              raw_collate_ms=measure(lambda: collate(observations, vocabulary)), sparse_collate_ms=measure(lambda: collate(packed, vocabulary)),
              tensors_equal=True, logits_equal=True, inference=[])
with torch.inference_mode():
    for device in ['cpu'] + (['cuda'] if torch.cuda.is_available() else []):
        model.to(device)
        for size in [1, 16, len(observations)]:
            batch = collate(packed[:size], vocabulary, device)
            elapsed = measure(lambda: model.policy_logits(batch), device)
            report['inference'].append(dict(device=device, batch=size, ms=elapsed))
print(json.dumps(report, indent=2))
