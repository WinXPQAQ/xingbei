"""Bounded supervised bootstrap, terminal reward only; not RL or strength proof."""
import argparse
import json
import random
from pathlib import Path
import torch
from model import EntityPolicy, Vocabulary, collate, pack_observation

parser = argparse.ArgumentParser()
parser.add_argument('data')
parser.add_argument('output')
parser.add_argument('--steps', type=int, default=100)
parser.add_argument('--batch', type=int, default=32)
parser.add_argument('--device', default='cpu')
parser.add_argument('--seed', type=int, default=17)
args = parser.parse_args()
random.seed(args.seed); torch.manual_seed(args.seed)
torch.set_num_threads(2)
games = [json.loads(line) for line in Path(args.data).read_text().splitlines()]
if len({game['result']['seed'] for game in games}) != len(games) or len(games) < 3:
    raise ValueError('Need at least three games with distinct seeds')
random.shuffle(games)
cut = max(1, len(games) // 4)
validation, training = games[:cut], games[cut:]

def samples(games):
    return [(d['observation'], d['choice'], game['result']['rewards'][str(d['seat'])])
            for game in games for d in game['decisions'] if game['result']['terminated']]

train, valid = samples(training), samples(validation)
vocab = Vocabulary.fit(row[0] for row in train)
train = [(pack_observation(o, vocab), choice, reward) for o, choice, reward in train]
valid = [(pack_observation(o, vocab), choice, reward) for o, choice, reward in valid]
model = EntityPolicy(len(vocab.symbols)).to(args.device)
optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4)
losses = []
for step in range(args.steps):
    selected = random.choices(train, k=args.batch)
    batch = collate([s[0] for s in selected], vocab, args.device)
    logits, value = model(batch)
    policy_loss = torch.nn.functional.cross_entropy(logits, torch.tensor([s[1] for s in selected], device=args.device))
    value_loss = torch.nn.functional.mse_loss(value, torch.tensor([s[2] for s in selected], dtype=torch.float32, device=args.device))
    loss = policy_loss + value_loss
    if not torch.isfinite(loss): raise RuntimeError('Nonfinite training loss')
    optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1); optimizer.step()
    losses.append(float(loss.detach()))

model.eval()
correct, squared, count = 0, 0., 0
by_type = {}
with torch.no_grad():
    for start in range(0, len(valid), args.batch):
        rows = valid[start:start + args.batch]
        batch = collate([s[0] for s in rows], vocab, args.device)
        logits, values = model(batch)
        for row, choice, value in zip(rows, logits.argmax(-1).tolist(), values.tolist()):
            hit = int(choice == row[1]); correct += hit; squared += (value - row[2]) ** 2; count += 1
            kind = row[0]['decision_type']
            stat = by_type.setdefault(kind, {'correct': 0, 'count': 0}); stat['correct'] += hit; stat['count'] += 1

checkpoint = model.checkpoint(vocab)
checkpoint.update(optimizer=optimizer.state_dict(), random_state=random.getstate(), torch_rng=torch.get_rng_state(),
                  cuda_rng=torch.cuda.get_rng_state_all() if torch.cuda.is_available() else [], steps=args.steps,
                  train_seeds=[g['result']['seed'] for g in training], validation_seeds=[g['result']['seed'] for g in validation],
                  teacher_versions=sorted({g['teacher'] for g in games}))
# Check exact restoration on CPU before publishing the file.
restored, vocabulary = EntityPolicy.restore(checkpoint)
restored.eval()
probe = collate([valid[0][0]], vocabulary)
with torch.no_grad():
    actual = model.cpu()(probe); expected = restored(probe)
    if not all(torch.equal(a, b) for a, b in zip(actual, expected)):
        raise RuntimeError('Checkpoint restoration changed model output')
Path(args.output).parent.mkdir(parents=True, exist_ok=True)
with open(args.output, 'xb') as file: torch.save(checkpoint, file)
print(json.dumps(dict(steps=args.steps, train_decisions=len(train), validation_decisions=count,
                     accuracy=correct / count, value_mse=squared / count, by_type=by_type,
                     first_loss=losses[0], last_loss=losses[-1], parameters=sum(p.numel() for p in model.parameters()),
                     device=args.device, output=args.output), indent=2))
