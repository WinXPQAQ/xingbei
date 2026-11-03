"""Supervised architecture control and resumable bootstrap; terminal value only."""
import argparse
import hashlib
import json
import os
import random
import time
from pathlib import Path
import torch
from model import EntityPolicy, Vocabulary, collate, pack_observation, features

parser = argparse.ArgumentParser()
parser.add_argument('data'); parser.add_argument('output')
parser.add_argument('--steps', type=int, default=100, help='Additional optimizer updates')
parser.add_argument('--batch', type=int)
parser.add_argument('--device', default='cpu')
parser.add_argument('--seed', type=int, default=17)
parser.add_argument('--architecture', choices=['entity', 'hash'])
parser.add_argument('--resume')
args = parser.parse_args()
if args.steps < 1 or (args.batch is not None and args.batch < 1): parser.error('steps and batch must be positive')
if Path(args.output).exists() or Path(args.output + '.json').exists(): parser.error('Output already exists')
torch.set_num_threads(2)
raw_data = Path(args.data).read_bytes(); data_hash = hashlib.sha256(raw_data).hexdigest()
games = [json.loads(line) for line in raw_data.splitlines()]
by_seed = {g['result']['seed']: g for g in games}
if len(by_seed) != len(games) or len(games) < 3 or any(not g['result']['terminated'] for g in games):
    raise ValueError('Need at least three complete games with distinct seeds')
resume = torch.load(args.resume, map_location='cpu', weights_only=False) if args.resume else None
if resume and resume.get('trainer', {}).get('data_sha256') != data_hash:
    raise ValueError('Resume requires matching dataset hash and resumable trainer metadata')
architecture = args.architecture or (resume.get('architecture', 'entity') if resume else 'entity')
if resume and architecture != resume.get('architecture', 'entity'): raise ValueError('Resume architecture mismatch')
model_class, prepare, make_batch = EntityPolicy, pack_observation, collate
if architecture == 'hash':
    from hash_baseline import HashPolicy, encode, collate as hash_collate
    model_class, prepare, make_batch = HashPolicy, encode, hash_collate
batch_size = args.batch or (resume['trainer']['batch'] if resume else 32)
if resume and batch_size != resume['trainer']['batch']: raise ValueError('Resume batch size mismatch')
seed = resume['trainer']['seed'] if resume else args.seed
random.seed(seed); torch.manual_seed(seed)
if resume:
    training = [by_seed[s] for s in resume['train_seeds']]
    validation = [by_seed[s] for s in resume['validation_seeds']]
else:
    random.Random(seed).shuffle(games)
    cut = max(1, len(games)//4); validation, training = games[:cut], games[cut:]

def samples(group):
    return [(d['observation'], d['choice'], game['result']['rewards'][str(d['seat'])]) for game in group for d in game['decisions']]

train, valid = samples(training), samples(validation)
if resume: model, vocab = model_class.restore(resume)
else:
    vocab = Vocabulary.fit(row[0] for row in train)
    if architecture == 'entity':
        from league import catalog
        vocab = Vocabulary(['<pad>', '<unknown>'] + sorted(set(vocab.symbols[2:]) | set(catalog()['vocabularySymbols'])))
    model = EntityPolicy(len(vocab.symbols)) if architecture == 'entity' else model_class()
unknown, feature_total = 0, 0
for observation, _, _ in valid:
    for token in observation['entities'] + observation['candidates']:
        for symbol, _ in features(token):
            feature_total += 1; unknown += int(vocab.id(symbol) == 1)
coverage = dict(unknown=unknown, total=feature_total, rate=unknown/max(1, feature_total))
start = time.perf_counter()
train = [(prepare(o, vocab), choice, reward) for o, choice, reward in train]
valid = [(prepare(o, vocab), choice, reward) for o, choice, reward in valid]
prepare_seconds = time.perf_counter()-start
model.to(args.device).train()
optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4)
if resume:
    optimizer.load_state_dict(resume['optimizer'])
    random.setstate(resume['random_state']); torch.set_rng_state(resume['torch_rng'])
    if args.device == 'cuda' and resume['cuda_rng']: torch.cuda.set_rng_state_all(resume['cuda_rng'])
losses = []; started = time.perf_counter()
for step in range(args.steps):
    selected = random.choices(train, k=batch_size)
    batch = make_batch([s[0] for s in selected], vocab, args.device)
    logits, value = model(batch)
    policy_loss = torch.nn.functional.cross_entropy(logits, torch.tensor([s[1] for s in selected], device=args.device))
    value_loss = torch.nn.functional.mse_loss(value, torch.tensor([s[2] for s in selected], dtype=torch.float32, device=args.device))
    loss = policy_loss + value_loss
    if not torch.isfinite(loss): raise RuntimeError('Nonfinite training loss')
    optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1); optimizer.step()
    losses.append(float(loss.detach()))
train_seconds = time.perf_counter()-started
model.eval(); correct, squared, count = 0, 0., 0
by_type = {}; calibration = [dict(count=0, predicted=0., won=0) for _ in range(5)]
with torch.no_grad():
    for start in range(0, len(valid), batch_size):
        rows = valid[start:start+batch_size]
        logits, values = model(make_batch([s[0] for s in rows], vocab, args.device))
        for row, choice, value in zip(rows, logits.argmax(-1).tolist(), values.tolist()):
            hit = int(choice == row[1]); correct += hit; squared += (value-row[2])**2; count += 1
            stat = by_type.setdefault(row[0]['decision_type'], dict(correct=0, count=0)); stat['correct'] += hit; stat['count'] += 1
            probability = (value+1)/2; bucket = calibration[min(4, int(probability*5))]
            bucket['count'] += 1; bucket['predicted'] += probability; bucket['won'] += int(row[2] == 1)
completed = (resume['steps'] if resume else 0)+args.steps
checkpoint = model.checkpoint(vocab)
checkpoint.update(revision=os.environ.get('XINGBEI_SOURCE_REVISION','development'), architecture=architecture, optimizer=optimizer.state_dict(), random_state=random.getstate(), torch_rng=torch.get_rng_state(),
                  cuda_rng=torch.cuda.get_rng_state_all() if torch.cuda.is_available() else [], steps=completed,
                  train_seeds=[g['result']['seed'] for g in training], validation_seeds=[g['result']['seed'] for g in validation],
                  teacher_versions=sorted({g['teacher'] for g in games}), trainer=dict(data_sha256=data_hash, batch=batch_size, seed=seed))
# Restoring also verifies architecture/schema compatibility. This construction
# consumes RNG only after it has been saved for the NEXT training update.
restored, vocabulary = model_class.restore(checkpoint); restored.eval()
probe = make_batch([valid[0][0]], vocabulary)
with torch.no_grad():
    actual = model.cpu()(probe); expected = restored(probe)
    if not all(torch.equal(a, b) for a, b in zip(actual, expected)): raise RuntimeError('Checkpoint restoration changed model output')
Path(args.output).parent.mkdir(parents=True, exist_ok=True)
with open(args.output, 'xb') as file: torch.save(checkpoint, file)
report = dict(architecture=architecture, steps=completed, additional_steps=args.steps, train_decisions=len(train), validation_decisions=count,
              accuracy=correct/count, value_mse=squared/count, brier=squared/count/4, calibration=calibration, by_type=by_type,
              first_loss=losses[0], last_loss=losses[-1], parameters=sum(p.numel() for p in model.parameters()),
              prepare_seconds=prepare_seconds, train_seconds=train_seconds, data_sha256=data_hash, entity_vocabulary_coverage=coverage,
              train_seeds=checkpoint['train_seeds'], validation_seeds=checkpoint['validation_seeds'], device=args.device, output=args.output)
with open(args.output+'.json', 'x') as file: json.dump(report, file, indent=2)
print(json.dumps(report, indent=2))
