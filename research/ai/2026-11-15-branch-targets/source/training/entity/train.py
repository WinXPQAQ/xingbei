"""Supervised bootstrap with game splits and bounded-memory sample loading."""
import argparse
import hashlib
import json
import os
import pickle
import random
import tempfile
import time
import torch
from model import SCHEMA, EntityPolicy, Vocabulary, collate, pack_observation, features
from checkpoint_io import recover_checkpoint, save_checkpoint
from learning import make_optimizers, restore_optimizers, parameter_groups
try:
    from orjson import loads as load_json
except ImportError:
    from json import loads as load_json


def read_games(path):
    with open(path, 'rb') as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                game = load_json(line)
            except ValueError as error:
                raise ValueError(f'Invalid dataset JSON at line {line_number}') from error
            if game.get('schema') != SCHEMA:
                raise ValueError(f'Line {line_number}: expected {SCHEMA}, found {game.get("schema")}; recollect with the current encoder')
            result = game.get('result', {})
            if not result.get('terminated') or result.get('truncated'):
                raise ValueError(f'Line {line_number}: teacher game must have a terminal result')
            if not game.get('decisions'):
                raise ValueError(f'Game {result.get("seed")} has no retained decisions; increase teacher sampling limits')
            for decision in game['decisions']:
                observation = decision['observation']
                if observation.get('schema') != SCHEMA or observation.get('wire'):
                    raise ValueError(f'Game {result.get("seed")} contains an incompatible observation')
                choice = decision.get('choice')
                if not isinstance(choice, int) or isinstance(choice, bool) or not 0 <= choice < len(observation['candidates']):
                    raise ValueError(f'Game {result.get("seed")} has an invalid teacher choice')
                if result.get('rewards', {}).get(str(decision['seat'])) not in (-1, 1):
                    raise ValueError(f'Game {result.get("seed")} has an invalid terminal reward')
            yield game


def inspect_data(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    seeds, teachers, sampling = [], set(), {}
    for game in read_games(path):
        seeds.append(game['result']['seed'])
        teachers.add(game['teacher'])
        info = game.get('sampling', {})
        version = info.get('config', {}).get('version', 'legacy')
        stat = sampling.setdefault(version, dict(games=0, retained=0, observed=0, observed_games=0))
        stat['games'] += 1
        stat['retained'] += len(game['decisions'])
        if 'observed' in info:
            stat['observed'] += info['observed']
            stat['observed_games'] += 1
    if len(set(seeds)) != len(seeds) or len(seeds) < 3:
        raise ValueError('Need at least three complete games with distinct seeds')
    return seeds, sorted(teachers), sampling, digest.hexdigest()


def increment_result(groups, key, hit, error):
    stat = groups.setdefault(key, dict(correct=0, count=0, squared_error=0.))
    stat['correct'] += hit
    stat['count'] += 1
    stat['squared_error'] += error


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('data'); parser.add_argument('output')
    parser.add_argument('--steps', type=int, default=100, help='Additional optimizer updates')
    parser.add_argument('--batch', type=int)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--seed', type=int, default=17)
    parser.add_argument('--architecture', choices=['entity', 'hash'])
    parser.add_argument('--resume')
    parser.add_argument('--width', type=int)
    parser.add_argument('--layers', type=int)
    parser.add_argument('--teacher-checkpoint', help='Warm-start a larger entity actor by distilling a frozen policy')
    parser.add_argument('--independent-updates', action=argparse.BooleanOptionalAction, default=None)
    args = parser.parse_args()
    if args.steps < 1 or (args.batch is not None and args.batch < 1):
        parser.error('steps and batch must be positive')
    if recover_checkpoint(args.output):
        parser.error('Output already exists')
    torch.set_num_threads(2)
    seeds, teachers, sampling, data_hash = inspect_data(args.data)
    resume = torch.load(args.resume, map_location='cpu', weights_only=False) if args.resume else None
    if resume and resume.get('trainer', {}).get('data_sha256') != data_hash:
        raise ValueError('Resume requires matching dataset hash and resumable trainer metadata')
    architecture = args.architecture or (resume.get('architecture', 'entity') if resume else 'entity')
    if resume and architecture != resume.get('architecture', 'entity'):
        raise ValueError('Resume architecture mismatch')
    independent = (args.independent_updates if args.independent_updates is not None else
                   resume['trainer'].get('independent_updates', False) if resume else architecture == 'entity')
    if independent and architecture != 'entity':
        parser.error('Independent updates require entity models')
    if resume and independent != resume['trainer'].get('independent_updates', False):
        parser.error('Resume optimizer mode changed')
    if architecture != 'entity' and (args.width is not None or args.layers is not None):
        parser.error('width and layers apply to entity models')
    if resume and any(value is not None and value != resume['config'][key]
                      for key, value in [('width', args.width), ('layers', args.layers)]):
        parser.error('Resume dimensions must match the checkpoint')
    teacher_path = args.teacher_checkpoint or (resume.get('trainer', {}).get('teacher_checkpoint') if resume else None)
    teacher, teacher_vocab, teacher_hash = None, None, None
    if teacher_path:
        if architecture != 'entity':
            parser.error('Policy distillation requires entity models')
        with open(teacher_path, 'rb') as source:
            teacher_hash = hashlib.file_digest(source, 'sha256').hexdigest()
        if resume and teacher_hash != resume['trainer'].get('teacher_sha256'):
            parser.error('Resume distillation teacher changed')
        teacher, teacher_vocab = EntityPolicy.restore(torch.load(teacher_path, map_location='cpu', weights_only=False))
        teacher.to(args.device).eval().requires_grad_(False)
    model_class, prepare, make_batch = EntityPolicy, pack_observation, collate
    if architecture == 'hash':
        from hash_baseline import HashPolicy, encode, collate as hash_collate
        model_class, prepare, make_batch = HashPolicy, encode, hash_collate
    batch_size = args.batch or (resume['trainer']['batch'] if resume else 32)
    if resume and batch_size != resume['trainer']['batch']:
        raise ValueError('Resume batch size mismatch')
    seed = resume['trainer']['seed'] if resume else args.seed
    random.seed(seed); torch.manual_seed(seed)
    if resume:
        train_seeds, validation_seeds = resume['train_seeds'], resume['validation_seeds']
        if set(train_seeds) & set(validation_seeds) or set(train_seeds + validation_seeds) != set(seeds):
            raise ValueError('Resume game split does not match dataset seeds')
    else:
        random.Random(seed).shuffle(seeds)
        cut = max(1, len(seeds) // 4)
        validation_seeds, train_seeds = seeds[:cut], seeds[cut:]
    training_set = set(train_seeds)
    if resume:
        model, vocab = model_class.restore(resume)
    else:
        if teacher is not None:
            vocab = teacher_vocab
        else:
            observations = (decision['observation'] for game in read_games(args.data)
                            if game['result']['seed'] in training_set for decision in game['decisions'])
            vocab = Vocabulary.fit(observations)
            if architecture == 'entity':
                from league import catalog
                vocab = Vocabulary(['<pad>', '<unknown>'] + sorted(set(vocab.symbols[2:]) | set(catalog()['vocabularySymbols'])))
        model = (EntityPolicy(len(vocab.symbols), width=96 if args.width is None else args.width,
                              layers=2 if args.layers is None else args.layers)
                 if architecture == 'entity' else model_class())
    if teacher is not None and vocab.digest != teacher_vocab.digest:
        raise ValueError('Student and teacher vocabularies differ')

    # Keep only offsets in RAM. Original games are decoded one at a time, and
    # packed observations are read for the current minibatch. Temporary storage
    # is removed on normal completion and exceptions.
    with tempfile.TemporaryFile(mode='w+b') as cache:
        positions = {}
        unknown, feature_total = 0, 0
        started = time.perf_counter()
        for game in read_games(args.data):
            game_seed = game['result']['seed']
            offsets = positions.setdefault(game_seed, [])
            for decision in game['decisions']:
                observation = decision['observation']
                if game_seed not in training_set:
                    for token in observation['entities'] + observation['candidates']:
                        for symbol, _ in features(token):
                            feature_total += 1
                            unknown += int(vocab.id(symbol) == 1)
                question = observation['entities'][observation['question']]['categorical']
                row = dict(observation=prepare(observation, vocab), choice=decision['choice'],
                           reward=game['result']['rewards'][str(decision['seat'])],
                           hero=game['heroIds'][decision['seat']], decision_type=question['type'],
                           stage=question.get('stage', 'complete'), skill=question.get('skill'))
                offsets.append(cache.tell())
                # This process creates and reads the private temporary cache.
                # Pickle also preserves tensors in the hash-control encoder.
                pickle.dump(row, cache, protocol=pickle.HIGHEST_PROTOCOL)
        cache.flush()
        train = [offset for game_seed in train_seeds for offset in positions[game_seed]]
        valid = [offset for game_seed in validation_seeds for offset in positions[game_seed]]
        if not train or not valid:
            raise ValueError('Both training and validation need retained decisions')
        prepare_seconds = time.perf_counter() - started
        coverage = dict(unknown=unknown, total=feature_total, rate=unknown / max(1, feature_total))

        def load_rows(offsets):
            rows = []
            for offset in offsets:
                cache.seek(offset)
                rows.append(pickle.load(cache))
            return rows

        model.to(args.device).train()
        optimizer = make_optimizers(model, 3e-4, 3e-4) if independent else torch.optim.AdamW(model.parameters(), lr=3e-4)
        groups = parameter_groups(model) if independent else None
        if resume:
            if independent:
                restore_optimizers(optimizer, resume['optimizer'], model)
            else:
                optimizer.load_state_dict(resume['optimizer'])
            random.setstate(resume['random_state']); torch.set_rng_state(resume['torch_rng'])
            if args.device == 'cuda' and resume['cuda_rng']:
                torch.cuda.set_rng_state_all(resume['cuda_rng'])
        losses = []
        started = time.perf_counter()
        for step in range(args.steps):
            selected = load_rows(random.choices(train, k=batch_size))
            batch = make_batch([row['observation'] for row in selected], vocab, args.device)
            logits, value = model(batch)
            if teacher is None:
                policy_loss = torch.nn.functional.cross_entropy(logits, torch.tensor([row['choice'] for row in selected], device=args.device))
            else:
                with torch.no_grad():
                    probabilities = teacher.policy_logits(batch).softmax(-1)
                log_probabilities = logits.log_softmax(-1).masked_fill(batch['mask'][:, batch['entities']:], 0)
                policy_loss = -(probabilities*log_probabilities).sum(-1).mean()
            value_loss = torch.nn.functional.mse_loss(value, torch.tensor([row['reward'] for row in selected], dtype=torch.float32, device=args.device))
            loss = policy_loss + value_loss
            if not torch.isfinite(loss):
                raise RuntimeError('Nonfinite training loss')
            if independent:
                for current in optimizer.values():
                    current.zero_grad(set_to_none=True)
                loss.backward()
                for key, current in optimizer.items():
                    torch.nn.utils.clip_grad_norm_(groups[key], 1)
                    current.step()
            else:
                optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1); optimizer.step()
            losses.append(float(loss.detach()))
        train_seconds = time.perf_counter() - started
        model.eval()
        correct, squared, count = 0, 0., 0
        teacher_agreement, teacher_count = 0, 0
        by_type, by_stage, by_skill, by_hero = {}, {}, {}, {}
        calibration = [dict(count=0, predicted=0., won=0) for _ in range(5)]
        with torch.no_grad():
            for start in range(0, len(valid), batch_size):
                rows = load_rows(valid[start:start + batch_size])
                batch = make_batch([row['observation'] for row in rows], vocab, args.device)
                logits, values = model(batch)
                if teacher is not None:
                    choices = teacher.policy_logits(batch).argmax(-1)
                    multiple = (~batch['mask'][:, batch['entities']:]).sum(-1) > 1
                    teacher_agreement += int(((choices == logits.argmax(-1)) & multiple).sum())
                    teacher_count += int(multiple.sum())
                for row, choice, value in zip(rows, logits.argmax(-1).tolist(), values.tolist()):
                    hit = int(choice == row['choice'])
                    error = (value - row['reward']) ** 2
                    correct += hit; squared += error; count += 1
                    increment_result(by_type, row['decision_type'], hit, error)
                    increment_result(by_stage, f'{row["decision_type"]}/{row["stage"]}', hit, error)
                    increment_result(by_hero, row['hero'], hit, error)
                    if row['skill']:
                        increment_result(by_skill, f'{row["hero"]}/{row["skill"]}', hit, error)
                    probability = max(0., min(1., (value + 1) / 2))
                    bucket = calibration[min(4, int(probability * 5))]
                    bucket['count'] += 1; bucket['predicted'] += probability; bucket['won'] += int(row['reward'] == 1)
        completed = (resume['steps'] if resume else 0) + args.steps
        checkpoint = model.checkpoint(vocab)
        checkpoint.update(revision=os.environ.get('XINGBEI_SOURCE_REVISION', 'development'), architecture=architecture,
                          optimizer={key:opt.state_dict() for key,opt in optimizer.items()} if independent else optimizer.state_dict(),
                          random_state=random.getstate(), torch_rng=torch.get_rng_state(),
                          cuda_rng=torch.cuda.get_rng_state_all() if torch.cuda.is_available() else [], steps=completed,
                          train_seeds=train_seeds, validation_seeds=validation_seeds, teacher_versions=teachers,
                          trainer=dict(data_sha256=data_hash, batch=batch_size, seed=seed, sampling=sampling,
                                       teacher_checkpoint=teacher_path, teacher_sha256=teacher_hash, independent_updates=independent))
        restored, vocabulary = model_class.restore(checkpoint)
        restored.eval()
        probe = make_batch([load_rows(valid[:1])[0]['observation']], vocabulary)
        with torch.no_grad():
            actual = model.cpu()(probe); expected = restored(probe)
            if not all(torch.equal(left, right) for left, right in zip(actual, expected)):
                raise RuntimeError('Checkpoint restoration changed model output')
        report = dict(architecture=architecture, steps=completed, additional_steps=args.steps, train_decisions=len(train),
                      validation_decisions=count, accuracy=correct / count, value_mse=squared / count, brier=squared / count / 4,
                      calibration=calibration, by_type=by_type, by_stage=by_stage, by_skill=by_skill, by_hero=by_hero,
                      sampling=sampling, first_loss=losses[0], last_loss=losses[-1], parameters=sum(p.numel() for p in model.parameters()),
                      prepare_seconds=prepare_seconds, train_seconds=train_seconds, data_sha256=data_hash,
                      entity_vocabulary_coverage=coverage, train_seeds=train_seeds, validation_seeds=validation_seeds,
                      device=args.device, output=args.output)
        if teacher is not None:
            report['distillation'] = dict(teacher_checkpoint=teacher_path, teacher_sha256=teacher_hash,
                multiple_choice_count=teacher_count, agreement=teacher_agreement/max(1, teacher_count),
                value_target='actual terminal team outcome')
        save_checkpoint(args.output, checkpoint, report)
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
