"""CPU inference for an explicitly selected entity-policy checkpoint."""
import argparse
from collections import OrderedDict
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import math
from pathlib import Path
import time

import torch

from model import SCHEMA, EntityPolicy, collate


MAX_BODY_BYTES = 8 * 1024 * 1024
MAX_ENTITIES = 4096
MAX_CANDIDATES = 20000
SESSION_LIMIT = 128
SESSION_SECONDS = 7200


def validate_observation(observation):
    if not isinstance(observation, dict) or observation.get('schema') != SCHEMA or observation.get('wire'):
        raise ValueError(f'Expected raw {SCHEMA} observation')
    entities, candidates = observation.get('entities'), observation.get('candidates')
    if not isinstance(entities, list) or not 0 < len(entities) <= MAX_ENTITIES:
        raise ValueError('Invalid entity count')
    if not isinstance(candidates, list) or not 0 < len(candidates) <= MAX_CANDIDATES:
        raise ValueError('Invalid candidate count')
    question = observation.get('question')
    if type(question) is not int or not 0 <= question < len(entities):
        raise ValueError('Invalid question reference')
    for token in entities + candidates:
        if not isinstance(token, dict) or not isinstance(token.get('kind'), str):
            raise ValueError('Invalid entity token')
        categorical, numbers, refs = (token.get(name) for name in ('categorical', 'numbers', 'refs'))
        if not all(isinstance(value, dict) for value in (categorical, numbers, refs)):
            raise ValueError('Invalid token fields')
        for value in categorical.values():
            for item in value if isinstance(value, list) else [value]:
                if item is not None and type(item) not in (str, bool, int, float):
                    raise ValueError('Invalid categorical feature')
                if type(item) in (int, float) and not math.isfinite(item):
                    raise ValueError('Nonfinite categorical feature')
        for value in numbers.values():
            if value is not None and (type(value) not in (bool, int, float) or not math.isfinite(value)):
                raise ValueError('Invalid numeric feature')
        for pointers in refs.values():
            if not isinstance(pointers, list) or any(type(pointer) is not int or not 0 <= pointer < len(entities) for pointer in pointers):
                raise ValueError('Invalid entity reference')
    if entities[question]['kind'] != 'question':
        raise ValueError('Question reference must identify a question token')


def create_handler(model, vocabulary, identity):
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
            self.reply(200 if self.path == '/health' else 404,
                       identity if self.path == '/health' else {'error': 'Not found'})

        def do_POST(self):
            if self.path != '/choose':
                self.reply(404, {'error': 'Not found'})
                return
            try:
                size = int(self.headers.get('Content-Length', 0))
                if not 0 < size <= MAX_BODY_BYTES:
                    raise ValueError('Invalid request size')
                raw = self.rfile.read(size)
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise ValueError('Expected a decision object')
                key, sequence, seat = data.get('session'), data.get('sequence'), data.get('seat')
                if not isinstance(key, str) or not 16 <= len(key) <= 100:
                    raise ValueError('Invalid session')
                if type(sequence) is not int or sequence < 0 or type(seat) is not int or not 0 <= seat < 6:
                    raise ValueError('Invalid sequence or seat')
                now = time.monotonic()
                for expired in [key for key, state in sessions.items() if now - state['time'] > SESSION_SECONDS]:
                    del sessions[expired]
                digest = hashlib.sha256(raw).hexdigest()
                state = sessions.get(key)
                if state and sequence == state['sequence'] - 1 and digest == state['request']:
                    # A lost HTTP response can be retried without advancing the game twice.
                    state['time'] = now
                    sessions.move_to_end(key)
                    self.reply(200, state['response'])
                    return
                expected = state['sequence'] if state else 0
                if sequence != expected:
                    raise ValueError('Stale decision or expired session; restart the game')
                observation = data.get('observation')
                validate_observation(observation)
                with torch.inference_mode():
                    logits = model.policy_logits(collate([observation], vocabulary, 'cpu'))
                    if not torch.isfinite(logits).all():
                        raise ValueError('Model returned nonfinite candidate scores')
                    choice = int(logits.argmax(-1).item())
                if not 0 <= choice < len(observation['candidates']):
                    raise ValueError('Model returned an invalid candidate')
                response = {'choice': choice, 'sequence': sequence, **identity}
                if key not in sessions and len(sessions) >= SESSION_LIMIT:
                    sessions.popitem(last=False)
                sessions[key] = {'sequence': sequence + 1, 'time': now, 'request': digest, 'response': response}
                sessions.move_to_end(key)
            except Exception as error:
                self.reply(400, {'error': str(error)})
                return
            # Preserve the accepted response if the client disconnects while reading it.
            self.reply(200, response)

        def log_message(self, *_):
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--port', type=int, default=4175)
    parser.add_argument('--label', help='Label shown alongside this checkpoint identity')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    torch.set_num_threads(2)
    checkpoint_hash = hashlib.sha256()
    with args.checkpoint.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            checkpoint_hash.update(block)
        source.seek(0)
        checkpoint = torch.load(source, map_location='cpu', weights_only=False)
    model, vocabulary = EntityPolicy.restore(checkpoint)
    model.eval()
    digest = checkpoint_hash.hexdigest()
    decision_mode = checkpoint.get('transfer', {}).get('decision_mode', 'hierarchical-v1')
    if decision_mode not in ('hierarchical-v1', 'hierarchical-v2'):
        raise ValueError(f'Unsupported checkpoint decision mode: {decision_mode}')
    identity = dict(schema=SCHEMA, architecture='entity', decisionMode=decision_mode,
                    checkpointSha256=digest, revision=checkpoint.get('revision', 'development'),
                    label=args.label or f'实体AI · {digest[:12]}', device='cpu')
    print(json.dumps(identity, ensure_ascii=False), flush=True)
    with HTTPServer(('127.0.0.1', args.port), create_handler(model, vocabulary, identity)) as server:
        server.serve_forever()


if __name__ == '__main__':
    main()
