"""Counterfactual branch targets for the focal specialist seat.

At a sampled position just before the focal seat's turn, the turn's strategic
choices (action direction, hero skill, skill cost size) are enumerated. Each
child replays the exact recorded choices up to its forced label, so siblings
start from the identical state. After the focal turn the remaining deck and
later randomness are redrawn with continuation seeds 0..K-1, shared by all
leaves of a tree (common random numbers). Continuations use the current greedy
policy; the five frozen seats keep their usual controllers.

A target is produced only when the paired outcome difference is significant.
The hidden state is used only to produce outcomes for training targets; the
policy receives its ordinary observation.
"""
import collections
import math
import random

from rehearsal import PolicyRehearsal


def select_boundaries(results, configs, count, rng, *, require_gem=False, phases=None):
    candidates = []
    for index, (result, config) in enumerate(zip(results, configs)):
        boundaries = result.get('focalBoundaries') or []
        if require_gem:
            boundaries = [b for b in boundaries if (b.get('energy') or {}).get('gem', 0) >= 1]
        if phases:
            boundaries = [b for b in boundaries if b.get('phase', 'early') in phases]
        if boundaries:
            candidates.append((index, rng.choice(boundaries)))
    rng.shuffle(candidates)
    picks = []
    for index, boundary in candidates[:count]:
        result, config = results[index], configs[index]
        picks.append(dict(config=config, replay=dict(config=dict(ruleVariant=config.get('ruleVariant', 'standard')),
            choices=result['choices'][:boundary['choiceCount']], turns=boundary['turns'],
            hash=boundary['hash'], revision=config['revision']), seat=config['focusSeat'], turns=boundary['turns'],
            source='explore' if config.get('sageRefineFirst') else 'policy'))
    return picks


def branch_config(pick, forced, expand, seed):
    # The prefix may include forced exploration; the branch continuation does not.
    base = {key: value for key, value in pick['config'].items()
            if key not in ('captureSeat', 'capture', 'profile', 'sageRefineFirst')}
    return dict(base, profile=False, capture=False, replay=pick['replay'], returnChoices=expand,
                forced=list(forced), focalTurn=pick['turns'] + 1, continuationSeed=seed,
                branch=dict(seat=pick['seat'], focalTurn=pick['turns'] + 1, expand=expand))


def outcome(result, seat):
    if result.get('terminated') and result.get('rewards'):
        return float(result['rewards'][str(seat)])
    return None


def expand_trees(runtime, model, vocabulary, picks, *, workers, device, models, samples=8,
                 max_depth=6, max_leaves=8):
    """nodes[(i, path)] -> node; leaves[(i, path)] -> list of K outcomes."""
    nodes, leaves, invalid = {}, {}, collections.Counter()
    budgets = [max_leaves] * len(picks)
    broken = set()
    # (tree, label path, forced prefix, expand, seed)
    frontier = [(i, (), [], True, 0) for i in range(len(picks))]
    pending_leaves = collections.defaultdict(dict)
    stats = dict(jobs=0, seconds=0., levels=0)
    while frontier:
        configs = [branch_config(picks[i], forced, expand and len(path) < max_depth, seed)
                   for i, path, forced, expand, seed in frontier]
        output = runtime.run(model, vocabulary, configs, workers=workers, device=device, models=models, binary=True)
        stats['jobs'] += len(configs); stats['seconds'] += output['stats']['seconds']; stats['levels'] += 1
        following = []
        for (i, path, forced, expand, seed), result in zip(frontier, output['results']):
            if i in broken:
                continue
            info = result.get('branchInfo') or {}
            status = info.get('status')
            seat = picks[i]['seat']
            if result.get('truncationReason') == 'branchStop' and status != 'node':
                invalid['forcedDiverged'] += 1; broken.add(i); continue
            if result.get('forcedUsed', 0) != len(forced):
                invalid['forcedUnused'] += 1; broken.add(i); continue
            if status == 'node':
                recorded = result.get('recorded') or []
                labels = info['labels']
                unique = list(dict.fromkeys(labels))
                if len(recorded) != 1 or recorded[0]['record']['labels'] != labels:
                    invalid['recordMismatch'] += 1; broken.add(i); continue
                if budgets[i] < len(unique) - 1:
                    # Budget exhausted: this node's greedy continuation becomes a leaf.
                    following.append((i, path, forced, False, seed)); continue
                budgets[i] -= len(unique) - 1
                prefix = result['choices'][len(picks[i]['replay']['choices']):]
                nodes[(i, path)] = dict(labels=labels, unique=unique, observation=recorded[0]['observation'],
                                        greedy=recorded[0]['choice'], depth=len(path))
                for label in unique:
                    entry = dict(playerId=seat, type='action', stage=info['stage'], index=labels.index(label))
                    following.append((i, path + (label,), prefix + [entry], True, 0))
            elif status == 'complete':
                value = outcome(result, seat)
                if value is None:
                    invalid['truncated'] += 1; broken.add(i); continue
                pending_leaves[(i, path)][seed] = value
                if seed == 0:
                    following.extend((i, path, forced, False, k) for k in range(1, samples))
            else:
                invalid[status or 'missing'] += 1; broken.add(i)
        frontier = following
    for key, values in pending_leaves.items():
        if len(values) == samples:
            leaves[key] = [values[k] for k in range(samples)]
        else:
            broken.add(key[0])
    for key in [k for k in nodes if k[0] in broken]: del nodes[key]
    for key in [k for k in leaves if k[0] in broken]: del leaves[key]
    stats['invalid'] = dict(invalid)
    stats['trees'] = len({i for i, _ in nodes} | {i for i, _ in leaves})
    stats['nodes'] = len(nodes)
    stats['leaves'] = len(leaves)
    return nodes, leaves, stats


def node_kind(labels):
    head = labels[0].split(':')[0] if labels else ''
    return dict(skill='skill', stop='cost', more='cost', target='target', count='target').get(head, 'direction')


def paired(a, b):
    differences = [x - y for x, y in zip(a, b)]
    mean = sum(differences) / len(differences)
    variance = sum((d - mean) ** 2 for d in differences) / max(1, len(differences) - 1)
    return mean, math.sqrt(variance / len(differences))


# One-sided Student t quantiles at 97.7% (matching z=2 for large samples).
T_QUANTILE = {1: 13.97, 2: 4.53, 3: 3.31, 4: 2.87, 5: 2.65, 6: 2.52, 7: 2.43, 8: 2.37, 9: 2.32, 10: 2.28,
              11: 2.25, 12: 2.23, 15: 2.18, 20: 2.13, 30: 2.09}


def critical(z, n):
    df = max(1, n - 1)
    key = max(k for k in T_QUANTILE if k <= df)
    return z * T_QUANTILE[key] / 2.


def build_targets(picks, nodes, leaves, *, temperature, hero, round_number, z=2., margin=.1,
                  train=None, honest=True):
    """Targets from the first `train` continuation seeds; any remaining seeds are a holdout.

    With honest=True the training seeds are split: the first half selects the
    best label, the second half tests it against the alternative. This avoids
    the upward bias of testing the maximum of several noisy means on the same
    samples that selected it.
    """
    examples = []
    report = dict(nodes=0, informative=0, greedy_optimal=0, greedy_regret_sum=0., significant_changes=0, labels={},
                  holdout=dict(changes=0, gain_sum=0., positive=0, by_kind={}))
    mean = lambda values: sum(values) / len(values)

    def value(i, path):
        if (i, path) in leaves:
            return leaves[(i, path)]
        node = nodes[(i, path)]
        unique = node['unique']
        full = [value(i, path + (label,)) for label in unique]
        count = train or len(full[0])
        samples = [s[:count] for s in full]
        holdout = [s[count:] for s in full]
        half = count // 2 if honest else count
        select = [s[:half] for s in samples]
        test = [s[half:] for s in samples] if honest else samples
        means = [mean(s) for s in samples]
        chosen = [mean(s) for s in select]
        top = max(range(len(unique)), key=lambda k: chosen[k])
        greedy = unique.index(node['labels'][node['greedy']])
        weights = [math.exp((m - max(means)) / temperature) for m in means]
        total = sum(weights)
        label_probabilities = [w / total for w in weights]
        report['nodes'] += 1
        report['greedy_optimal'] += int(top == greedy)
        report['greedy_regret_sum'] += max(means) - means[greedy]
        kind = node_kind(unique)
        for label, m, p in zip(unique, means, label_probabilities):
            entry = report['labels'].setdefault(f"{kind}:d{node['depth']}:{label}",
                dict(available=0, q_sum=0., best=0, target_sum=0., greedy=0))
            entry['available'] += 1; entry['q_sum'] += m; entry['target_sum'] += p
            entry['best'] += int(m == max(means))
        report['labels'][f"{kind}:d{node['depth']}:{unique[greedy]}"]['greedy'] += 1
        # Compare the selected label with the current choice, or, if the current
        # choice was selected, with the runner-up. Noise-level differences are skipped.
        other = greedy if top != greedy else max((k for k in range(len(unique)) if k != top), key=lambda k: chosen[k])
        difference, error = paired(test[top], test[other])
        significant = difference > max(critical(z, len(test[top])) * error, margin)
        report['significant_changes'] += int(significant and top != greedy)
        if significant and top != greedy and holdout[0]:
            gain = mean(holdout[top]) - mean(holdout[greedy])
            h = report['holdout']
            h['changes'] += 1; h['gain_sum'] += gain; h['positive'] += int(gain > 0)
            k = h['by_kind'].setdefault(f'{kind}:{unique[greedy]}->{unique[top]}', dict(n=0, gain_sum=0.))
            k['n'] += 1; k['gain_sum'] += gain
        # Improved policy: the honestly selected label where significant,
        # otherwise the current choice. Noisy means never move the target.
        chosen_label = top if significant else greedy
        label_probabilities = [float(k == chosen_label) for k in range(len(unique))]
        if significant:
            report['informative'] += 1
            shares = {label: node['labels'].count(label) for label in unique}
            probabilities = [label_probabilities[unique.index(label)] / shares[label] for label in node['labels']]
            examples.append(dict(observation=node['observation'], probabilities=probabilities,
                group=hero, kind=f'{kind}:d{node["depth"]}', round=round_number,
                labels=node['labels'], q=means, source=picks[i].get('source')))
        # Per-seed value of the improved policy at this node (training and holdout seeds).
        return list(full[chosen_label])

    for i in sorted({i for i, path in nodes if path == ()}):
        value(i, ())
    for entry in report['labels'].values():
        entry['q_mean'] = entry['q_sum'] / entry['available']
        entry['target_mean'] = entry['target_sum'] / entry['available']
    report['greedy_optimal_rate'] = report['greedy_optimal'] / max(1, report['nodes'])
    report['greedy_regret_mean'] = report['greedy_regret_sum'] / max(1, report['nodes'])
    h = report['holdout']
    h['gain_mean'] = h['gain_sum'] / h['changes'] if h['changes'] else None
    h['positive_rate'] = h['positive'] / h['changes'] if h['changes'] else None
    for k in h['by_kind'].values():
        k['gain_mean'] = k['gain_sum'] / k['n']
    h['by_kind'] = dict(sorted(h['by_kind'].items(), key=lambda item: -item[1]['n']))
    report['labels'] = dict(sorted(report['labels'].items()))
    return examples, report


class BranchBuffer:
    """Recent counterfactual targets; old rounds expire to follow the policy."""
    def __init__(self, window):
        self.window = window
        self.examples = []

    def add(self, examples, round_number):
        self.examples = [e for e in self.examples if e['round'] > round_number - self.window] + examples

    def rehearsal(self, vocabulary, seed):
        if not self.examples:
            return None
        rows = [dict(observation=e['observation'], probabilities=e['probabilities'], group=e['group'])
                for e in self.examples]
        rehearsal = PolicyRehearsal(rows, vocabulary)
        rehearsal.random = random.Random(seed)
        return rehearsal

    def state(self):
        return [dict(e) for e in self.examples]
