"""Audit a complete declared schedule and report exploratory deployment strata."""
import argparse
import hashlib
import json
from pathlib import Path
from evaluation_stats import summarize, paired_mixed
from schedule import evaluation_configs, LINEUPS, DEFAULT


def key(game):
    return tuple(game[field] for field in ('seed', 'lineup', 'team', 'start', 'mode', 'arm'))


def audit_schedule(games, manifest, sampling_seed):
    expected = evaluation_configs(manifest['firstSeed'], manifest['seeds'], sampling_seed,
                                  manifest.get('balancedMixedSchedule', False))
    if len(expected) != manifest['games'] or len(games) != len(expected):
        raise ValueError('Incomplete declared evaluation schedule')
    actual = {key(game): game for game in games}
    if len(actual) != len(games) or set(actual) != {key(game) for game in expected}:
        raise ValueError('Duplicate, missing or unexpected evaluation scenario')
    for config in expected:
        game = actual[key(config)]
        for field in ('heroIds', 'seatPolicies', 'samplingSeed'):
            if game[field] != config[field]:
                raise ValueError('Scenario metadata differs: ' + field)
        if not isinstance(game['truncated'], bool) or not isinstance(game['terminated'], bool):
            raise ValueError('Invalid termination flags')
        if game['terminated'] == game['truncated'] or (game['winner'] in ('red', 'blue')) != game['terminated']:
            raise ValueError('Inconsistent terminal outcome')
        if game['truncated'] and game['winner'] is not None:
            raise ValueError('Truncated game cannot have winner')
    return True


def breakdown(games):
    model = [game for game in games if game['arm'] == 'model']
    team = [game for game in model if game['mode'] == 'team']
    mixed = [game for game in model if game['mode'] == 'mixed']
    def group(rows):
        return {'overall': summarize(rows),
                'byLineup': {name: summarize([g for g in rows if g['lineup'] == name]) for name in LINEUPS},
                'byColor': {color: summarize([g for g in rows if g['team'] == color]) for color in ('red', 'blue')},
                'byStartingSeat': {str(seat): summarize([g for g in rows if g['start'] == seat]) for seat in (0, 1)}}
    heroes = {}
    for hero in DEFAULT:
        subset = [g for g in mixed if g['heroIds'][g['seatPolicies'].index('model')] == hero]
        pair_keys = {key(g)[:-1] for g in subset}
        heroes[hero] = {'teamOutcomeWithThisSoleModelHero': summarize(subset),
                        'pairedDifferenceFromSameV15Seat': paired_mixed([g for g in games if key(g)[:-1] in pair_keys])}
    total = sum(g.get('baselineDecisions', 0) for g in model)
    changed = sum(g.get('baselineDecisions', 0) - g.get('baselineMatches', 0) for g in model)
    return {'team': group(team), 'mixed': group(mixed), 'mixedPaired': paired_mixed(games),
            'bySoleModelHero': heroes, 'baselineDecisions': total, 'departuresFromBaseline': changed,
            'scope': 'Hero outcomes measure a team with one model-controlled hero, not individual hero strength. Strata are exploratory, not multiplicity-adjusted acceptance gates. Raw win rates weight games; existing interval and paired-difference statistics weight seed clusters equally, which can differ in uneven hero strata. Starting seats are only 0 and 1; do not claim all six starts.'}


def run(args):
    manifest = json.loads((args.evaluation / 'manifest.json').read_text())
    games = [json.loads(line) for line in (args.evaluation / 'games.jsonl').read_text().splitlines()]
    checkpoint = Path(manifest['checkpoint'])
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != manifest['checkpointSha256']:
        raise ValueError('Evaluation checkpoint has changed')
    sampling_seed = manifest.get('samplingSeed', args.sampling_seed)
    if sampling_seed is None:
        raise ValueError('Older manifest requires explicit --sampling-seed')
    audit_schedule(games, manifest, sampling_seed)
    report = {'manifest': manifest, 'scheduleAudit': 'passed', **breakdown(games)}
    with args.output.open('x') as stream:
        json.dump(report, stream, indent=2)
    print(json.dumps({'games': len(games), 'audit': 'passed', 'output': str(args.output)}))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--evaluation', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--sampling-seed', type=int)
    run(p.parse_args())
