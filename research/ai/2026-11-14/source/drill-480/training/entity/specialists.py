"""Two isolated hero specialists, normal rules, frozen five-seat surroundings.

Only the focal seat contributes policy/value samples. Human games are fallible,
actor-only references. No mechanism metric is used as a reward.
"""
import argparse
import collections
import fcntl
import hashlib
import json
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

HEROES = ('magicArcher', 'sage')

def write_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.replace(path)

def configurations(hero, count, offset, revision, *, evaluation=False):
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
        configs.append(dict(seed=(920000000 if evaluation else 850000000)+hero_index*10000000+(group if evaluation else index),
            heroIds=heroes, start=group % 6, revision=revision, ruleVariant='standard',
            decisionMode='hierarchical-v1', profile=True, capture=False,
            seatPolicies=policies, focusSeat=seat, opponent=rival))
    return configs

def summarize(results, configs):
    clusters = collections.defaultdict(list)
    wins = completed = forfeits = 0
    victories = collections.Counter()
    behavior = collections.Counter()
    skills, actions, opponents = collections.Counter(), collections.Counter(), {}
    for result, config in zip(results, configs):
        seat = config['focusSeat']
        assert result['learnerSeats'] == [seat]
        assert result['heroIds'][seat] in HEROES
        assert result['ruleVariant'] == 'standard'
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
    args = parser.parse_args()
    args.workers = runtime.worker_limit(args.workers)
    if min(args.games, args.workers, args.eval_games) < 1 or args.games % 6 or args.eval_games % 6:
        parser.error('Positive games/evaluation counts must be multiples of six')
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
    references = [json.loads(line) for line in (directory/'sage-human.jsonl').read_text().splitlines() if line.strip()]
    game_ids = sorted({r['gameId'] for r in references})
    if len(game_ids) != 2: raise ValueError('This experiment expects two separately recorded Sage games')
    human_train = [r for r in references if r['gameId'] == game_ids[0]]
    human_holdout = [r for r in references if r['gameId'] == game_ids[1]]
    models = {}
    for key, filename in [('frozenCurrent', 'frozen-current.pt'), ('anchor417', 'frozen-417.pt')]:
        path = directory/filename
        if hashlib.sha256(path.read_bytes()).hexdigest() != manifest['checkpoint_sha256'][filename]:
            raise ValueError(f'Frozen checkpoint changed: {filename}')
        models[key] = EntityPolicy.restore(torch.load(path, map_location='cpu', weights_only=False))
    branches = {}
    status = dict(state='starting', revision=revision, ruleVariant='standard', branches={}, completed_games=0,
                  configuration=vars(args) | {'directory':str(directory)})
    def publish(state, **extra):
        status.update(state=state, updated_at=time.time(), **extra)
        write_json(directory/'status.json', status)
        print(json.dumps(dict(time=time.time(), **status), ensure_ascii=False), flush=True)
    try:
        for hero in args.heroes:
            folder = directory/hero; folder.mkdir(exist_ok=True)
            files = sorted(folder.glob('round-*.pt'))
            completed = [p for p in files if recover_checkpoint(p)]
            path = completed[-1] if completed else directory/'frozen-current.pt'
            checkpoint = torch.load(path, map_location='cpu', weights_only=False)
            model, vocabulary = EntityPolicy.restore(checkpoint)
            model.to(device)
            optimizer = make_optimizers(model, actor_lr=5e-5, critic_lr=3e-5)
            # New standard-rule experiment intentionally resets old morale-only
            # optimizer moments; subsequent specialist resumes restore exactly.
            if completed:
                if checkpoint['specialist']['configuration'] != {'games':args.games,'eval_games':args.eval_games}:
                    raise ValueError('Do not silently change resumed specialist schedule')
                restore_optimizers(optimizer, checkpoint['optimizer'], model)
            rounds = checkpoint['specialist']['round'] if completed else 0
            branches[hero] = dict(model=model, vocabulary=vocabulary, optimizer=optimizer, round=rounds,
                                  completed=checkpoint['specialist']['completed'] if completed else 0)
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
                    configs = configurations(hero, args.games, branch['round']*args.games, revision)
                    rollout = runtime.run(branch['model'], branch['vocabulary'], configs,
                        workers=args.workers, device=device, models=models, trajectory=True, binary=True, opponent_temperature=0.)
                    for result, config in zip(rollout['results'], configs):
                        if result['learnerSeats'] != [config['focusSeat']] or any(d['seat'] != config['focusSeat'] for d in result['trajectory']):
                            raise ValueError('Non-specialist trajectory leaked into training')
                    rows = training_samples(rollout['results'], method='mc')
                    metrics = summarize(rollout['results'], configs)
                    reference = human_train if hero == 'sage' and round_number <= 16 else None
                    publish('updating', hero=hero, round=round_number, last_collection=metrics)
                    learning = update(branch['model'], branch['vocabulary'], branch['optimizer'], rows,
                        batch_size=64, epochs=2, device=device, target_kl=.02, entropy_weight=.03,
                        critic_mode='grouped', critic_updates=32, critic_loss='bce',
                        reference_rows=reference, reference_weight=.05 if reference else 0.)
                    branch['round'] = round_number; branch['completed'] += metrics['completed']
                    report = dict(hero=hero, round=round_number, summary=metrics, stats=rollout['stats'],
                        learning=learning, value=value_diagnostics(rows), human_reference=human_diagnostic(branch['model'],branch['vocabulary'],human_train,device) if hero=='sage' else None,
                        human_holdout=human_diagnostic(branch['model'],branch['vocabulary'],human_holdout,device) if hero=='sage' else None,
                        results=[{k:v for k,v in result.items() if k!='trajectory'} for result in rollout['results']])
                    saved = branch['model'].checkpoint(branch['vocabulary'])
                    saved.update(revision=revision, ruleVariant='standard', specialist=dict(hero=hero,round=round_number,completed=branch['completed'],configuration={'games':args.games,'eval_games':args.eval_games}),
                        optimizer={k:v.state_dict() for k,v in branch['optimizer'].items()},random_state=random.getstate(),torch_rng=torch.get_rng_state(),cuda_rng=torch.cuda.get_rng_state_all(),
                        lineage=manifest['lineage'], human_reference_game=game_ids[0] if hero=='sage' else None)
                    destination=directory/hero/f'round-{round_number:06d}.pt'
                    save_checkpoint(destination, saved, report)
                    status['branches'][hero]=dict(round=round_number,checkpoint=str(destination),completed_games=branch['completed'],summary=metrics,stats=rollout['stats'])
                    status['completed_games']=sum(b['completed'] for b in branches.values())
                    publish('checkpointed', hero=hero, round=round_number)
                    del rows, rollout, saved, report
                performed += 1
                due = time.time()-last_eval >= args.eval_seconds or not last_eval_path.exists()
                if due and not (directory/'PAUSE').exists():
                    evaluations = {}
                    for hero, branch in branches.items():
                        configs = configurations(hero,args.eval_games,0,revision,evaluation=True)
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
