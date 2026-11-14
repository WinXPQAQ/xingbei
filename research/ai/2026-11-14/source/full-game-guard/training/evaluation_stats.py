"""Seed-cluster uncertainty, preserving unresolved truncations as unknown."""
import random
from collections import defaultdict


def interval(values, repetitions=4000):
    if len(values) < 2:
        return None
    rng = random.Random(871238)
    estimates = sorted(sum(rng.choices(values, k=len(values))) / len(values) for _ in range(repetitions))
    return [estimates[int(repetitions * 0.025)], estimates[int(repetitions * 0.975)]]


def summarize(games):
    clusters = defaultdict(list)
    for game in games:
        clusters[game['seed']].append(game)
    wins = sum(game['winner'] == game['team'] for game in games)
    truncated = sum(game['truncated'] for game in games)
    losses = len(games) - wins - truncated
    lower = [sum(g['winner'] == g['team'] for g in group) / len(group) for group in clusters.values()]
    upper = [sum(g['winner'] == g['team'] or g['truncated'] for g in group) / len(group) for group in clusters.values()]
    return {'games': len(games), 'seedClusters': len(clusters), 'wins': wins, 'losses': losses,
            'truncated': truncated, 'resolvedWinRate': wins / (wins + losses) if wins + losses else None,
            'allGameWinRateBounds': [wins / len(games), (wins + truncated) / len(games)] if games else None,
            'seedCluster95': [interval(lower)[0], interval(upper)[1]] if len(clusters) >= 2 else None,
            'interpretation': 'Truncations are unresolved, never draws; bounds assign them loss/win respectively.'}


def paired_mixed(games):
    pairs = defaultdict(dict)
    for game in games:
        if game['mode'] == 'mixed':
            key = (game['seed'], game['lineup'], game['team'], game['start'])
            if game['arm'] in pairs[key]:
                raise ValueError('Duplicate paired evaluation arm')
            pairs[key][game['arm']] = game
    differences = defaultdict(list)
    unresolved = 0
    for key, pair in pairs.items():
        if set(pair) != {'model', 'control'}:
            raise ValueError('Missing paired evaluation arm')
        if any(game['truncated'] for game in pair.values()):
            unresolved += 1
            continue
        differences[key[0]].append(int(pair['model']['winner'] == key[2]) - int(pair['control']['winner'] == key[2]))
    values = [sum(group) / len(group) for group in differences.values()]
    return {'pairs': len(pairs), 'unresolvedPairs': unresolved,
            'resolvedMeanWinRateDifference': sum(values) / len(values) if values else None,
            'resolvedSeedCluster95': interval(values),
            'confirmatory': unresolved == 0 and len(values) >= 2}
