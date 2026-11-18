"""Two isolated hero specialists, normal rules, frozen five-seat surroundings.

Only the focal seat contributes policy/value samples. Human games are fallible,
actor-only references. No mechanism metric is used as a reward.
"""
import argparse
import collections
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import random
import time
import traceback

import torch
from model import EntityPolicy, collate
from pool import GameRuntime
from league import catalog, roster
from learning import training_samples, make_optimizers, restore_optimizers, value_diagnostics
from reinforce import update
from checkpoint_io import save_checkpoint, recover_checkpoint
from telemetry import Telemetry
from rehearsal import PolicyRehearsal, evaluate_skill_retention
from branching import select_boundaries, expand_trees, build_targets, BranchBuffer

HEROES = ('magicArcher', 'sage')

def write_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.replace(path)

TEAMS = ["red", "blue", "blue", "red", "red", "blue"]  # engine DEFAULT_TEAMS by seat


def configurations(hero, count, offset, revision, *, evaluation=False, capture_focal=False, eval_seed=920000000, team=False,
                   rule_variant='standard', decision_mode='hierarchical-v1'):
    configs = []
    hero_index = HEROES.index(hero)
    for i in range(count):
        index = offset+i
        seat = index % 6
        group = index // 6
        # All six rotations of one lineup share an evaluation seed cluster.
        heroes = list(roster(group + hero_index*997))
        if hero in heroes:
            position = heroes.index(hero)
            heroes[0], heroes[position] = heroes[position], heroes[0]
        else:
            heroes[0] = hero
        heroes = heroes[-seat:] + heroes[:-seat] if seat else heroes
        rival = ('model:frozenCurrent', 'model:anchor417', catalog()['ruleTeacher'], 'legacy-score-partial-v1')[group % 4]
        policies = [rival]*6
        policies[seat] = 'model'
        if team:  # the focal hero's two teammates are also played (and trained) by the learner
            policies = ['model' if TEAMS[s] == TEAMS[seat] else rival for s in range(6)]
        configs.append(dict(seed=(eval_seed if evaluation else 850000000)+hero_index*10000000+(group if evaluation else index),
            heroIds=heroes, start=group % 6, revision=revision, ruleVariant='standard' if evaluation else rule_variant,
            decisionMode=decision_mode, profile=True, capture=False,
            seatPolicies=policies, focusSeat=seat, opponent=rival,
            **(dict(captureSeat=seat) if capture_focal else {})))
    return configs

def summarize(results, configs):
    clusters = collections.defaultdict(list)
    wins = completed = forfeits = 0
    victories = collections.Counter()
    behavior = collections.Counter()
    skills, actions, opponents = collections.Counter(), collections.Counter(), {}
    for result, config in zip(results, configs):
        seat = config['focusSeat']
        assert seat in result['learnerSeats']
        assert result['heroIds'][seat] in HEROES
        assert result['ruleVariant'] in ('standard', 'morale-only-v1')
        b = result.get('heroBehavior', {}).get(str(seat), {})
        for key in ('turns', 'coveredAdded', 'enemyAttackDamage', 'enemySpellDamage', 'refineGem', 'refineCrystal'):
            behavior[key] += b.get(key, 0)
        skills.update(b.get('skillNotes', {})); actions.update(b.get('rootActions', {}))
        if result['truncated'] or not result['terminated']:
            continue
        score = int(result['rewards'][str(seat)] == 1)
        wins += score; completed += 1
        clusters[config['seed']].append(score)
        opponent = opponents.setdefault(config['opponent'], dict(wins=0, completed=0))
        opponent['wins'] += score; opponent['completed'] += 1
        forfeits += bool(result.get('inabilityForfeits'))
        ending = result['publicBehavior']['teams'][result['winner']]['end']
        victories['forfeit' if result.get('inabilityForfeits') else 'cups' if ending['cups'] >= 5 else 'morale'] += 1
    cluster_means = [sum(values)/len(values) for values in clusters.values()]
    rng = random.Random(20261112)
    boot = sorted(sum(rng.choices(cluster_means, k=len(cluster_means)))/len(cluster_means) for _ in range(2000)) if cluster_means else []
    return dict(games=len(results), completed=completed, wins=wins, truncated=len(results)-completed,
        win_rate=wins/completed if completed else None, seed_cluster_interval95=[boot[49],boot[1949]] if boot else None,
        inability_forfeits=forfeits, victory_routes=dict(victories), behavior=dict(behavior),
        skill_notes=dict(skills), root_actions=dict(actions), opponents=opponents,
        behavior_note='Public event totals, not rewards. Skill notes can include multiple notes per activation; damage is not morale loss.')

def paired_difference(current, control, configs):
    groups = collections.defaultdict(list)
    for a, b, config in zip(current, control, configs):
        if a['truncated'] or b['truncated']:
            continue
        seat = str(config['focusSeat'])
        groups[config['seed']].append(int(a['rewards'][seat] == 1)-int(b['rewards'][seat] == 1))
    values = [sum(x)/len(x) for x in groups.values()]
    rng = random.Random(20261113)
    boot = sorted(sum(rng.choices(values, k=len(values)))/len(values) for _ in range(2000)) if values else []
    return dict(paired_completed=sum(map(len, groups.values())), difference=sum(values)/len(values) if values else None,
                seed_cluster_interval95=[boot[49],boot[1949]] if boot else None)

def human_diagnostic(model, vocab, rows, device):
    if not rows: return None
    model.eval()
    correct = loss = 0
    with torch.no_grad():
        for start in range(0, len(rows), 32):
            chosen = rows[start:start+32]
            logits = model.policy_logits(collate([r['observation'] for r in chosen], vocab, device))
            labels = torch.tensor([r['choice'] for r in chosen], device=device)
            correct += int((logits.argmax(-1) == labels).sum())
            loss += float(torch.nn.functional.cross_entropy(logits, labels, reduction='sum'))
    return dict(samples=len(rows), choice_match=correct/len(rows), cross_entropy=loss/len(rows),
                meaning='Agreement with fallible human choices, not a strength score')

def main(runtime):
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--heroes', nargs='+', choices=HEROES, default=list(HEROES))
    parser.add_argument('--games', type=int, default=192)
    parser.add_argument('--workers', type=int, default=64)
    parser.add_argument('--eval-games', type=int, default=144)
    parser.add_argument('--rounds', type=int, default=0, help='0 runs until PAUSE or exception')
    parser.add_argument('--eval-seconds', type=int, default=3600)
    parser.add_argument('--rehearsal-bank', type=Path)
    parser.add_argument('--rehearsal-weight', type=float, default=0.)
    parser.add_argument('--continuation-temperature', type=float, default=1.)
    parser.add_argument('--branch-boundaries', type=int, default=0, help='Positions per round for counterfactual branch targets; 0 disables')
    parser.add_argument('--branch-weight', type=float, default=0.)
    parser.add_argument('--branch-temperature', type=float, default=.5)
    parser.add_argument('--branch-depth', type=int, default=3)
    parser.add_argument('--branch-leaves', type=int, default=8)
    parser.add_argument('--branch-samples', type=int, default=8, help='Continuation seeds per leaf')
    parser.add_argument('--branch-z', type=float, default=2.)
    parser.add_argument('--branch-margin', type=float, default=.1)
    parser.add_argument('--rollback-margin', type=float, default=0., help='Restore the best development checkpoint when evaluation falls this far below it; 0 disables')
    parser.add_argument('--branch-window', type=int, default=3)
    parser.add_argument('--branch-count', type=int, default=32, help='Branch examples per PPO minibatch')
    parser.add_argument('--branch-explore-games', type=int, default=0, help='Sage only: greedy games that refine first, used only to sample gem-holding positions')
    parser.add_argument('--branch-explore-boundaries', type=int, default=0)
    parser.add_argument('--eval-seed', type=int, default=920000000)
    parser.add_argument('--team', action='store_true', help="Train the focal hero's two teammates with the same learner")
    parser.add_argument('--style', default='win', choices=['win', 'attack', 'cups', 'support', 'morale'],
                        help='Bounded public-behavior bonus added to the terminal reward (learning.style_score)')
    parser.add_argument('--style-weight', type=float, default=0.)
    parser.add_argument('--branch-phases', nargs='+', default=None, help='Only branch focal turns in these phases (early/middle/ending)')
    parser.add_argument('--endgame-fraction', type=float, default=0., help='Share of training games resumed from recent late positions')
    parser.add_argument('--endgame-phases', nargs='+', default=['ending', 'middle'])
    parser.add_argument('--endgame-bank', type=int, default=1500)
    parser.add_argument('--decision-mode', default='hierarchical-v1', choices=['hierarchical-v1', 'hierarchical-v2'])
    parser.add_argument('--rule-variant', default='standard', choices=['standard', 'morale-only-v1'],
                        help='Rules for training games; evaluation always uses standard rules')
    parser.add_argument('--target-kl', type=float, default=.02)
    parser.add_argument('--branch-min-steps', type=int, default=0, help='Minimum distillation steps per round')
    parser.add_argument('--branch-anchor', type=float, default=0., help='KL weight keeping ordinary rollout states at the post-PPO policy during distillation')
    parser.add_argument('--branch-epochs', type=float, default=2., help='Separate distillation passes over the branch buffer per round; 0 mixes into PPO minibatches')
    args = parser.parse_args()
    if args.branch_boundaries < 0 or bool(args.branch_boundaries) != bool(args.branch_weight):
        parser.error('Branch boundaries and positive branch weight must be supplied together')
    if args.branch_boundaries and args.rehearsal_bank:
        parser.error('Branch targets and a fixed rehearsal bank are separate experiments')
    if not 0 < args.branch_temperature <= 5 or args.branch_depth < 1 or args.branch_leaves < 2 or args.branch_window < 1:
        parser.error('Invalid branch configuration')
    args.workers = runtime.worker_limit(args.workers)
    if min(args.games, args.workers, args.eval_games) < 1 or args.games % 6 or args.eval_games % 6:
        parser.error('Positive games/evaluation counts must be multiples of six')
    if not 0 < args.continuation_temperature <= 1 or not 0 <= args.rehearsal_weight <= 5:
        parser.error('Invalid transfer learning configuration')
    if bool(args.rehearsal_bank) != bool(args.rehearsal_weight):
        parser.error('A rehearsal bank and positive rehearsal weight must be supplied together')
    if args.rehearsal_bank and args.heroes != ['sage']:
        parser.error('This skill bank is scoped to the Sage specialist')
    directory = args.directory.resolve()
    manifest = json.loads((directory/'manifest.json').read_text())
    revision = manifest['revision']
    lock = open(directory/'lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    os.environ['XINGBEI_DIAGNOSTIC_DIR'] = str(directory/'rule-failures')
    os.environ['XINGBEI_TRAINING_RULE_VARIANT'] = 'standard'
    torch.set_num_threads(int(os.environ.get('XINGBEI_TORCH_THREADS','2')))
    torch.manual_seed(20261112); random.seed(20261112)
    torch.backends.cuda.matmul.allow_tf32 = True
    if not torch.cuda.is_available(): raise RuntimeError('Specialist training requires CUDA')
    device = 'cuda'
    bank = torch.load(args.rehearsal_bank, map_location='cpu', weights_only=False) if args.rehearsal_bank else None
    transfer = dict(continuation_temperature=args.continuation_temperature,
        rehearsal_weight=args.rehearsal_weight,
        rehearsal_sha256=hashlib.sha256(args.rehearsal_bank.read_bytes()).hexdigest() if bank else None)
    if args.team:
        transfer['team'] = True
    if args.rule_variant != 'standard':
        transfer['rule_variant'] = args.rule_variant
    if args.decision_mode != 'hierarchical-v1':
        transfer['decision_mode'] = args.decision_mode
    if args.endgame_fraction:
        transfer['endgame'] = dict(fraction=args.endgame_fraction, phases=args.endgame_phases, bank=args.endgame_bank)
    endgame_bank = collections.deque(maxlen=args.endgame_bank)
    if args.style != 'win':
        transfer['style'] = dict(style=args.style, weight=args.style_weight)
    if args.branch_boundaries:
        transfer['branch'] = dict(boundaries=args.branch_boundaries, weight=args.branch_weight,
            temperature=args.branch_temperature, depth=args.branch_depth, leaves=args.branch_leaves,
            samples=args.branch_samples, z=args.branch_z, margin=args.branch_margin,
            window=args.branch_window, count=args.branch_count, target_kl=args.target_kl, epochs=args.branch_epochs,
            anchor=args.branch_anchor, honest=True, min_steps=args.branch_min_steps, phases=args.branch_phases,
            explore_games=args.branch_explore_games, explore_boundaries=args.branch_explore_boundaries)
    human_path = directory/'sage-human.jsonl'
    references = [json.loads(line) for line in human_path.read_text().splitlines() if line.strip()] if human_path.exists() else []
    game_ids = sorted({r['gameId'] for r in references})
    if references and len(game_ids) != 2: raise ValueError('This experiment expects two separately recorded Sage games')
    human_train = [r for r in references if r['gameId'] == game_ids[0]] if references else []
    human_holdout = [r for r in references if r['gameId'] == game_ids[1]] if references else []
    models = {}
    for key, filename in [('frozenCurrent', 'frozen-current.pt'), ('anchor417', 'frozen-417.pt')]:
        path = directory/filename
        if hashlib.sha256(path.read_bytes()).hexdigest() != manifest['checkpoint_sha256'][filename]:
            raise ValueError(f'Frozen checkpoint changed: {filename}')
        models[key] = EntityPolicy.restore(torch.load(path, map_location='cpu', weights_only=False))
    branches = {}
    status = dict(state='starting', revision=revision, ruleVariant='standard', branches={}, completed_games=0,
                  configuration=vars(args) | {'directory':str(directory),
                      'rehearsal_bank': str(args.rehearsal_bank) if args.rehearsal_bank else None})
    def publish(state, **extra):
        status.update(state=state, updated_at=time.time(), **extra)
        write_json(directory/'status.json', status)
        print(json.dumps(dict(time=time.time(), **status), ensure_ascii=False), flush=True)
    try:
        for hero in args.heroes:
            folder = directory/hero; folder.mkdir(exist_ok=True)
            files = sorted(folder.glob('round-*.pt'))
            completed = [p for p in files if recover_checkpoint(p)]
            initial = manifest.get('initial_checkpoints', {}).get(hero)
            path = completed[-1] if completed else directory/(initial['file'] if initial else 'frozen-current.pt')
            if not completed and initial and hashlib.sha256(path.read_bytes()).hexdigest() != initial['sha256']:
                raise ValueError(f'Initial specialist checkpoint changed: {hero}')
            checkpoint = torch.load(path, map_location='cpu', weights_only=False)
            model, vocabulary = EntityPolicy.restore(checkpoint)
            previous_transfer = checkpoint.get('transfer', dict(continuation_temperature=1., rehearsal_weight=0., rehearsal_sha256=None))
            if completed and previous_transfer != transfer:
                raise ValueError('Changed transfer settings require a separately recorded experiment')
            if bank and bank['symbols'] != vocabulary.symbols:
                raise ValueError('Skill bank vocabulary differs from the specialist')
            model.to(device)
            optimizer = make_optimizers(model, actor_lr=5e-5, critic_lr=3e-5)
            # New standard-rule experiment intentionally resets old morale-only
            # optimizer moments; subsequent specialist resumes restore exactly.
            if completed:
                if checkpoint['specialist']['configuration'] != {'games':args.games,'eval_games':args.eval_games}:
                    raise ValueError('Do not silently change resumed specialist schedule')
                restore_optimizers(optimizer, checkpoint['optimizer'], model)
            rounds = checkpoint['specialist']['round'] if completed else 0
            branch_buffer = BranchBuffer(args.branch_window)
            if completed and args.branch_boundaries:
                state_path = folder/f'branch-buffer-{rounds:06d}.pt'
                if state_path.exists():
                    branch_buffer.examples = torch.load(state_path, map_location='cpu', weights_only=False)
            branches[hero] = dict(model=model, vocabulary=vocabulary, optimizer=optimizer, round=rounds, buffer=branch_buffer,
                                  rehearsal=PolicyRehearsal(bank['examples'], vocabulary) if bank else None,
                                  completed=checkpoint['specialist']['completed'] if completed else 0)
            if completed and bank and checkpoint.get('rehearsal_rng') is not None:
                branches[hero]['rehearsal'].random.setstate(checkpoint['rehearsal_rng'])
            status['branches'][hero] = dict(round=rounds, checkpoint=str(path), completed_games=branches[hero]['completed'])
        # Same model initialization consumes RNG on restart, so reset per-round
        # seeds below. Checkpoints also preserve end-of-round RNG for inspection.
        status['completed_games'] = sum(b['completed'] for b in branches.values())
        with Telemetry(directory):
            performed = 0
            last_eval_path = directory/'evaluation-latest.json'
            last_eval = json.loads(last_eval_path.read_text())['time'] if last_eval_path.exists() else time.time()
            while not (directory/'PAUSE').exists() and (not args.rounds or performed < args.rounds):
                for hero in sorted(branches, key=lambda h:branches[h]['round']):
                    if (directory/'PAUSE').exists(): break
                    branch = branches[hero]
                    round_number = branch['round']+1
                    rng_seed = 20261112+round_number*2+HEROES.index(hero)
                    random.seed(rng_seed); torch.manual_seed(rng_seed); torch.cuda.manual_seed_all(rng_seed)
                    publish('collecting', hero=hero, round=round_number)
                    configs = configurations(hero, args.games, manifest.get('training_offset', 0)+branch['round']*args.games, revision,
                                             capture_focal=bool(args.branch_boundaries), team=args.team, rule_variant=args.rule_variant,
                                             decision_mode=args.decision_mode)
                    if args.endgame_fraction:
                        # Endgame curriculum: some games resume from recorded late
                        # positions of the learner's own recent games (same seed,
                        # lineup and seat policies; the prefix is replayed exactly).
                        rng = random.Random(rng_seed + 7)
                        for config in configs: config['capture'] = True
                        usable = [b for b in endgame_bank if b['category'] in args.endgame_phases]
                        count = int(round(args.endgame_fraction * len(configs))) if usable else 0
                        for index in rng.sample(range(len(configs)), count):
                            pick = rng.choice(usable)
                            configs[index] = dict(pick['config'], replay=pick['replay'], capture=True,
                                                  curriculumKind=pick['category'])
                    rollout = runtime.run(branch['model'], branch['vocabulary'], configs,
                        workers=args.workers, device=device, models=models, trajectory=True, binary=True, opponent_temperature=0.,
                        continuation_temperature=args.continuation_temperature)
                    for result, config in zip(rollout['results'], configs):
                        learners = [i for i, policy in enumerate(config['seatPolicies']) if policy == 'model']
                        if result['learnerSeats'] != learners or any(d['seat'] not in learners for d in result['trajectory']):
                            raise ValueError('Non-specialist trajectory leaked into training')
                    rows = training_samples(rollout['results'], method='mc', style=args.style, style_weight=args.style_weight)
                    metrics = summarize(rollout['results'], configs)
                    if args.endgame_fraction:
                        kinds = collections.Counter(c.get('curriculumKind', 'full') for c in configs)
                        wins_by_kind = collections.Counter(c.get('curriculumKind', 'full') for r, c in zip(rollout['results'], configs)
                                                           if r.get('rewards') and r['rewards'][str(c['focusSeat'])] == 1)
                        metrics['curriculum'] = {k: dict(games=n, wins=wins_by_kind[k]) for k, n in kinds.items()}
                        for result, config in zip(rollout['results'], configs):
                            base = {k: v for k, v in config.items() if k not in ('replay', 'curriculumKind', 'capture')}
                            for b in result.get('boundaries') or []:
                                endgame_bank.append(dict(category=b['category'], config=base, replay=dict(
                                    config=dict(ruleVariant=config.get('ruleVariant', 'standard')), choices=b['choices'],
                                    turns=b['turns'], hash=b['hash'], revision=b['revision'])))
                    branch_report = None
                    rehearsal = branch['rehearsal']
                    rehearsal_weight = args.rehearsal_weight
                    rehearsal_steps = 0
                    if args.branch_boundaries:
                        publish('branching', hero=hero, round=round_number)
                        picks = select_boundaries(rollout['results'], configs, args.branch_boundaries, random.Random(rng_seed),
                                                  phases=args.branch_phases)
                        if hero == 'sage' and args.branch_explore_games:
                            explore = [dict(config, sageRefineFirst=True, profile=False) for config in
                                       configurations(hero, args.branch_explore_games, 5000000+manifest.get('training_offset', 0)+branch['round']*args.branch_explore_games,
                                                      revision, capture_focal=True)]
                            explored = runtime.run(branch['model'], branch['vocabulary'], explore, workers=args.workers, device=device, models=models, binary=True)
                            picks += select_boundaries(explored['results'], explore, args.branch_explore_boundaries,
                                                       random.Random(rng_seed+1), require_gem=True)
                        nodes, leaves, branch_stats = expand_trees(runtime, branch['model'], branch['vocabulary'], picks,
                            workers=args.workers, device=device, models=models, max_depth=args.branch_depth, max_leaves=args.branch_leaves, samples=args.branch_samples)
                        examples, branch_report = build_targets(picks, nodes, leaves, temperature=args.branch_temperature,
                            z=args.branch_z, margin=args.branch_margin,
                            hero=hero, round_number=round_number)
                        branch['buffer'].add(examples, round_number)
                        branch_report.update(stats=branch_stats, examples=len(examples), buffer=len(branch['buffer'].examples),
                            weight=args.branch_weight, temperature=args.branch_temperature)
                        rehearsal = branch['buffer'].rehearsal(branch['vocabulary'], rng_seed)
                        rehearsal_weight = args.branch_weight if rehearsal else 0.
                        if rehearsal:
                            rehearsal.loss_count = args.branch_count
                            rehearsal_steps = max(args.branch_min_steps, math.ceil(args.branch_epochs*len(branch['buffer'].examples)/args.branch_count)) if args.branch_epochs else 0
                    reference = human_train if hero == 'sage' and human_train and round_number <= manifest.get('human_reference_rounds', 16) else None
                    publish('updating', hero=hero, round=round_number, last_collection=metrics)
                    learning = update(branch['model'], branch['vocabulary'], branch['optimizer'], rows,
                        batch_size=64, epochs=2, device=device, target_kl=args.target_kl, entropy_weight=.03,
                        critic_mode='grouped', critic_updates=32, critic_loss='bce' if args.style == 'win' else 'mse',
                        rehearsal=rehearsal, rehearsal_weight=rehearsal_weight, rehearsal_steps=rehearsal_steps,
                        anchor_weight=args.branch_anchor,
                        reference_rows=reference, reference_weight=.05 if reference else 0.)
                    branch['round'] = round_number; branch['completed'] += metrics['completed']
                    report = dict(hero=hero, round=round_number, summary=metrics, stats=rollout['stats'],
                        learning=learning, value=value_diagnostics(rows), human_reference=human_diagnostic(branch['model'],branch['vocabulary'],human_train,device) if hero=='sage' else None,
                        human_holdout=human_diagnostic(branch['model'],branch['vocabulary'],human_holdout,device) if hero=='sage' else None,
                        branch=branch_report,
                        results=[{k:v for k,v in result.items() if k not in ('trajectory','choices','focalBoundaries','boundaries')} for result in rollout['results']])
                    if bank and bank.get('validation'):
                        publish('checking-skill-retention', hero=hero, round=round_number)
                        report['skill_retention'] = evaluate_skill_retention(runtime, branch['model'], branch['vocabulary'],
                            bank['validation'], workers=args.workers, device=device)
                    saved = branch['model'].checkpoint(branch['vocabulary'])
                    saved.update(revision=revision, ruleVariant='standard', specialist=dict(hero=hero,round=round_number,completed=branch['completed'],configuration={'games':args.games,'eval_games':args.eval_games}),
                        transfer=transfer,
                        rehearsal_rng=branch['rehearsal'].random.getstate() if branch['rehearsal'] else None,
                        optimizer={k:v.state_dict() for k,v in branch['optimizer'].items()},random_state=random.getstate(),torch_rng=torch.get_rng_state(),cuda_rng=torch.cuda.get_rng_state_all(),
                        lineage=manifest['lineage'], human_reference_game=game_ids[0] if hero=='sage' and game_ids else None)
                    if not report.get('skill_retention', {}).get('passed', True):
                        rejected = directory/hero/f'rejected-{round_number:06d}.pt'
                        save_checkpoint(rejected, saved, report)
                        (directory/'PAUSE').write_text(f'Skill retention failed; inspect {rejected}\n')
                        publish('capability-regression', hero=hero, candidate=str(rejected),
                            skill_retention=report['skill_retention'])
                        return
                    destination=directory/hero/f'round-{round_number:06d}.pt'
                    save_checkpoint(destination, saved, report)
                    if args.branch_boundaries:
                        buffer_path = directory/hero/f'branch-buffer-{round_number:06d}.pt'
                        torch.save(branch['buffer'].state(), buffer_path)
                        old = directory/hero/f'branch-buffer-{round_number-1:06d}.pt'
                        if old.exists(): old.unlink()
                    status['branches'][hero]=dict(round=round_number,checkpoint=str(destination),completed_games=branch['completed'],summary=metrics,stats=rollout['stats'])
                    status['completed_games']=sum(b['completed'] for b in branches.values())
                    publish('checkpointed', hero=hero, round=round_number)
                    del rows, rollout, saved, report
                performed += 1
                due = time.time()-last_eval >= args.eval_seconds or not last_eval_path.exists()
                if due and not (directory/'PAUSE').exists():
                    evaluations = {}
                    for hero, branch in branches.items():
                        configs = configurations(hero,args.eval_games,0,revision,evaluation=True,eval_seed=args.eval_seed,team=args.team,
                                                 decision_mode=args.decision_mode)
                        control_path=directory/hero/f'control-{args.eval_games}.json'
                        if control_path.exists():
                            control=json.loads(control_path.read_text())
                        else:
                            publish('evaluating-control',hero=hero)
                            control=runtime.run(*models['frozenCurrent'],configs,workers=args.workers,device=device,models=models,binary=True)
                            write_json(control_path,control)
                        publish('evaluating-specialist',hero=hero,round=branch['round'])
                        current=runtime.run(branch['model'],branch['vocabulary'],configs,workers=args.workers,device=device,models=models,binary=True)
                        result=dict(hero=hero,round=branch['round'],checkpoint=status['branches'][hero]['checkpoint'],control=summarize(control['results'],configs),
                            specialist=summarize(current['results'],configs),paired=paired_difference(current['results'],control['results'],configs),stats=current['stats'])
                        write_json(directory/hero/f'evaluation-{branch["round"]:06d}-{args.eval_games}.json',dict(**result,results=current['results'],configs=configs))
                        evaluations[hero]=result
                        best_path=directory/hero/'best-development.json'
                        previous=json.loads(best_path.read_text()) if best_path.exists() else None
                        score=result['paired']['difference']
                        if score is not None and (previous is None or score > previous['paired']['difference']):
                            write_json(best_path,result)
                        elif (args.rollback_margin and score is not None and previous is not None
                              and score < previous['paired']['difference'] - args.rollback_margin):
                            # Restore weights and optimizer of the best development checkpoint;
                            # round numbering and the branch buffer continue.
                            restored = torch.load(previous['checkpoint'], map_location='cpu', weights_only=False)
                            branch['model'].load_state_dict(restored['state'])
                            restore_optimizers(branch['optimizer'], restored['optimizer'], branch['model'])
                            result['rollback'] = dict(to_round=previous['round'], checkpoint=previous['checkpoint'],
                                                      score=score, best=previous['paired']['difference'])
                            with open(directory/hero/'rollbacks.jsonl', 'a') as log:
                                log.write(json.dumps(dict(time=time.time(), at_round=branch['round'], **result['rollback'])) + '\n')
                    last_eval=time.time()
                    write_json(last_eval_path,dict(time=last_eval,protocol='Fixed development seeds. Replace focal hero only; frozen five other seats. Cluster bootstrap across six rotations.',heroes=evaluations))
                    status['evaluation']=evaluations
                    lines=['# 魔弓与贤者专项训练', '', '规则：正常合杯；终局团队胜负奖励。只训练指定英雄席位，其他五席冻结。',
                           '', '以下为反复使用的开发评测，不能当成最终验收。对照只替换指定英雄，其他五席、阵容和种子一致。', '']
                    for hero, result in evaluations.items():
                        lines += [f'## {hero} · 第 {result["round"]} 轮', '',
                            f'冻结当前模型：{result["control"]["wins"]}/{result["control"]["completed"]}；专项模型：{result["specialist"]["wins"]}/{result["specialist"]["completed"]}。',
                            f'配对胜率差与种子簇95%区间：{result["paired"]}。',
                            f'专项英雄机制统计（不作奖励）：{result["specialist"]["behavior"]}。',
                            f'技能日志次数（不等于发动次数）：{result["specialist"]["skill_notes"]}。', '']
                    (directory/'report.md').write_text('\n'.join(lines))
                    publish('evaluation-complete')
            publish('paused' if (directory/'PAUSE').exists() else 'round-limit-complete')
    except BaseException as error:
        write_json(directory/'failure.json',dict(time=time.time(),error=traceback.format_exc(),status=status))
        publish('error',error=str(error))
        raise

if __name__ == '__main__':
    with GameRuntime() as runtime: main(runtime)
