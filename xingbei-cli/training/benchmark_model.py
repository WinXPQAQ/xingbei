"""CPU/GPU parity and forward/training memory microbenchmarks on legal fixtures."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time

import torch
from model import policy_from_checkpoint, Policy, SeatMemory, batch
from encoding_candidate import seat_memory

parser = argparse.ArgumentParser()
parser.add_argument('--checkpoint', type=pathlib.Path, required=True)
args = parser.parse_args()
torch.set_num_threads(2)
saved = torch.load(args.checkpoint, map_location='cpu', weights_only=False)
project = pathlib.Path(__file__).resolve().parent.parent
cases = json.loads(subprocess.check_output(['node', str(project / 'training/diagnostics.mjs')]))
overflow = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', '''
import {Game} from './src/engine.js';
import {decisionCandidates} from './training/candidates.mjs';
import {encodeDecision} from './training/observation.mjs';
const game=new Game({seed:210000170}).setup();game.player(0).handLimit=6;
game.draw(0,12-game.player(0).hand.length,{overflow:'defer'});
const request={type:'overflow',player:game.player(0)};
console.log(JSON.stringify(encodeDecision({game,playerId:0,request,candidates:decisionCandidates(game,request)})));
'''], cwd=project))
model = policy_from_checkpoint(saved)
model.eval()
state, actions = seat_memory(model.feature_encoding).encode(0, cases[0]['observation'])
row = {'state': state, 'actions': actions}
with torch.inference_mode():
    cpu = model(*batch([row], 'cpu'))
    model.cuda()
    gpu = model(*batch([row], 'cuda'))
for expected, actual in zip(cpu, gpu):
    torch.testing.assert_close(expected, actual.cpu(), rtol=1e-4, atol=1e-5)
measurements = []
for label, observation in [('response', cases[0]['observation']), ('overflow', overflow)]:
    state, actions = seat_memory(model.feature_encoding).encode(0, observation)
    for device in ('cpu', 'cuda'):
        model.to(device)
        for size in (1, 8, 32, 128):
            inputs = batch([{'state': state, 'actions': actions}] * size, device)
            iterations = 5 if len(actions) > 100 else 50
            with torch.inference_mode():
                for _ in range(3):
                    model(*inputs)
                if device == 'cuda':
                    torch.cuda.synchronize()
                start = time.perf_counter()
                for _ in range(iterations):
                    model(*inputs)
                if device == 'cuda':
                    torch.cuda.synchronize()
            elapsed = time.perf_counter() - start
            measurements.append({'fixture': label, 'device': device, 'batch': size,
                                 'candidates': len(actions), 'batchMs': elapsed / iterations * 1000,
                                 'decisionsPerSecond': size * iterations / elapsed})

# Stress the same masked network with a real 924-choice legal overflow fixture.
model.cuda().train()
optimizer = torch.optim.Adam(model.parameters(), lr=3e-4)
inputs = batch([{'state': state, 'actions': actions}] * 128, 'cuda')
torch.cuda.reset_peak_memory_stats()
logits, value = model(*inputs)
loss = -logits.log_softmax(-1)[:, 0].mean() + value.square().mean()
optimizer.zero_grad(); loss.backward(); optimizer.step(); torch.cuda.synchronize()
print(json.dumps({'torch': torch.__version__, 'cudaRuntime': torch.version.cuda,
                  'device': torch.cuda.get_device_name(0), 'parameters': sum(p.numel() for p in model.parameters()),
                  'checkpointSha256': hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
                  'cpuGpuOutputsClose': True, 'measurements': measurements,
                  'trainingStress': {'batch': 128, 'candidates': len(actions),
                                     'peakAllocatedBytes': torch.cuda.max_memory_allocated(),
                                     'peakReservedBytes': torch.cuda.max_memory_reserved()},
                  'scope': 'Repeated legal fixtures, not full rollout throughput; excludes feature encoding, IPC and host-device copies in forward timing.'}, indent=2))
