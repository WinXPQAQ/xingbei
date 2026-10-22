"""Local CPU inference for the explicitly selected experimental checkpoint."""
import argparse
import hashlib
import json
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import torch
from model import policy_from_checkpoint, batch
from encoding_candidate import seat_memory

p = argparse.ArgumentParser()
p.add_argument('--checkpoint', type=Path, required=True)
p.add_argument('--port', type=int, default=4175)
p.add_argument('--release', help='Immutable local AI release; verify checkpoint hash before serving')
a = p.parse_args()
torch.set_num_threads(2)
saved = torch.load(a.checkpoint, map_location='cpu', weights_only=False)
model = policy_from_checkpoint(saved, 'cpu')
model.eval()
identity = {'label': '混合AI · 第192批 · 实验版', 'checkpointSha256': hashlib.sha256(a.checkpoint.read_bytes()).hexdigest(), 'completed': saved['completed'], 'baseline': model.baseline_version, 'device': 'cpu'}
if a.release:
    release = json.loads(Path(__file__).with_name('ai-releases.json').read_text())[a.release]
    if identity['checkpointSha256'] != release['checkpointSha256'] or identity['baseline'] != release['baseline']:
        raise ValueError('AI release does not match checkpoint/baseline')
    identity.update(version=a.release, label=f'AI {a.release}', rulesVersion='terminal-v1')
sessions = OrderedDict()
class Handler(BaseHTTPRequestHandler):
    def reply(self, status, value):
        payload = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
    def do_GET(self):
        self.reply(200 if self.path == '/health' else 404, identity if self.path == '/health' else {'error': 'Not found'})
    def do_POST(self):
        try:
            if self.path != '/choose':
                return self.reply(404, {'error': 'Not found'})
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 8 * 1024 * 1024:
                raise ValueError('Invalid request size')
            data = json.loads(self.rfile.read(size))
            key, seq, seat = data['session'], data['sequence'], data['seat']
            if not isinstance(key, str) or not 16 <= len(key) <= 100 or type(seq) is not int or type(seat) is not int or not 0 <= seat < 6:
                raise ValueError('Invalid session or seat')
            now = time.monotonic()
            for old in list(sessions):
                if now - sessions[old]['time'] > 7200:
                    del sessions[old]
            if key not in sessions:
                if seq != 0:
                    raise ValueError('Session expired; restart game')
                if len(sessions) >= 128:
                    sessions.popitem(last=False)
                sessions[key] = {'memory': seat_memory(model.feature_encoding), 'sequence': 0, 'time': now}
            state = sessions[key]
            if seq != state['sequence']:
                raise ValueError('Stale or duplicate decision')
            observation = data['observation']
            count = len(observation['candidates'])
            baseline = data['baseline']
            if not 0 < count <= 20000 or type(baseline) is not int or not 0 <= baseline < count:
                raise ValueError('Invalid candidates/baseline')
            features, actions = state['memory'].encode(seat, observation)
            with torch.inference_mode():
                logits, _ = model(*batch([{'state': features, 'actions': actions, 'baselineChoice': baseline}], 'cpu'))
                choice = logits.argmax(-1).item()
            state.update(sequence=seq + 1, time=now)
            sessions.move_to_end(key)
            self.reply(200, {'choice': choice, 'sequence': seq, **identity})
        except Exception as error:
            # No fallback to a different policy or silent memory reset.
            if isinstance(locals().get('key'), str):
                sessions.pop(key, None)
            self.reply(400, {'error': str(error)})
    def log_message(self, *_):
        pass
print(json.dumps(identity), flush=True)
HTTPServer(('127.0.0.1', a.port), Handler).serve_forever()
