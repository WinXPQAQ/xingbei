"""Run an entity checkpoint through the existing persistent simulator worker."""
import argparse
import json
from pathlib import Path
import subprocess
import torch
from model import EntityPolicy, collate, SCHEMA

parser = argparse.ArgumentParser()
parser.add_argument('checkpoint')
parser.add_argument('--seed', type=int, default=211102200)
parser.add_argument('--device', default='cpu')
parser.add_argument('--opponent', default='v1.8.0-preview.1')
parser.add_argument('--heroes', nargs=6)
args = parser.parse_args()
torch.set_num_threads(2)
# Only load checkpoints generated locally by the training command.
model, vocabulary = EntityPolicy.restore(torch.load(args.checkpoint, map_location='cpu', weights_only=False))
model.to(args.device).eval()
root = Path(__file__).resolve().parents[2]
worker = subprocess.Popen(['node', 'training/worker.mjs'], cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

def send(message):
    worker.stdin.write(json.dumps(message) + '\n'); worker.stdin.flush()

config = {'seed': args.seed}
if args.heroes: config['heroIds'] = args.heroes
try:
    send({'type': 'start', 'schema': SCHEMA, 'config': config,
          'seatPolicies': ['model', args.opponent, args.opponent, 'model', 'model', args.opponent]})
    for line in worker.stdout:
        message = json.loads(line)
        if message['type'] == 'error': raise RuntimeError(message['error'])
        if message['type'] == 'result':
            print(json.dumps(message['result'], indent=2)); break
        with torch.inference_mode():
            logits = model.policy_logits(collate([message['observation']], vocabulary, args.device))
        send({'type': 'select', 'id': message['id'], 'index': int(logits[0].argmax())})
    else: raise RuntimeError('Worker exited before completing a game')
finally:
    worker.terminate(); worker.wait()
