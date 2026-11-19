"""Compare simulator concurrency using fixed V3 policy rollouts, without updates."""
import argparse
import json
import os
from pathlib import Path
import statistics


def cpu_counters():
    try:
        values = dict(line.split() for line in Path('/sys/fs/cgroup/cpu.stat').read_text().splitlines())
    except FileNotFoundError:
        return {}
    return {key: int(values[key]) for key in ('usage_usec', 'nr_throttled', 'throttled_usec') if key in values}


def save_report(path, report):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(report, indent=2) + '\n')
    temporary.replace(path)


def recommended_workers(runs, cycles):
    candidates = {}
    for row in runs:
        candidates.setdefault(row['workers'], []).append(row)
    speeds = {}
    for workers, rows in candidates.items():
        if len(rows) != cycles or any(
            row['runtime_errors'] or row['incomplete_games'] or row['inability_forfeits']
            for row in rows
        ):
            continue
        measured = rows[1:] if cycles > 1 else rows
        speeds[workers] = statistics.median(row['games_per_second'] for row in measured)
    return max(speeds, key=lambda workers: (speeds[workers], -workers)) if speeds else None


def benchmark(args):
    import torch
    from model import EntityPolicy
    from pool import GameRuntime
    from specialists import configurations

    if not torch.cuda.is_available():
        raise RuntimeError('V3 GPU benchmark requires CUDA')
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    torch.backends.cuda.matmul.allow_tf32 = True
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def restore(path):
        return EntityPolicy.restore(torch.load(path, map_location='cpu', weights_only=False))

    model, vocabulary = restore(args.checkpoint)
    if model.v3_phase is None:
        model.enable_v3()
    model.set_v3_phase(args.phase)
    opponents = {
        'frozenCurrent': restore(args.opponents / 'frozen-current.pt'),
        'anchor417': restore(args.opponents / 'frozen-417.pt'),
    }
    for network in (model, *(network for network, _ in opponents.values())):
        network.to('cuda').eval()
    configs = configurations(
        'sage', args.games, args.offset, 'v3-worker-benchmark',
        team=args.phase == 'shared', decision_mode='hierarchical-v3',
    )
    report = dict(
        phase=args.phase, games=args.games, cycles=args.cycles, workers=args.workers,
        checkpoint=str(args.checkpoint), opponents=str(args.opponents), offset=args.offset,
        seed=args.seed, threads=args.threads, gpu=torch.cuda.get_device_name(),
        runs=[], recommended_workers=None,
    )
    observed_workers = set()
    for requested in args.workers:
        with GameRuntime() as runtime:
            workers = min(args.games, runtime.worker_limit(requested))
            if workers in observed_workers:
                continue
            observed_workers.add(workers)
            for cycle in range(1, args.cycles + 1):
                torch.manual_seed(args.seed)
                torch.cuda.reset_peak_memory_stats()
                start_cpu = cpu_counters()
                row = dict(workers=workers, requested_workers=requested, cycle=cycle, runtime_errors=0)
                try:
                    outcome = runtime.run(
                        model, vocabulary, configs, workers=workers, device='cuda',
                        models=opponents, binary=True, trajectory=True,
                    )
                except RuntimeError as error:
                    row.update(runtime_errors=1, error=str(error)[:350])
                else:
                    games = outcome['results']
                    stats = outcome['stats']
                    incomplete = sum(result['truncated'] or not result['terminated'] for result in games)
                    row.update(
                        completed_games=len(games) - incomplete, incomplete_games=incomplete,
                        inability_forfeits=sum(bool(result.get('inabilityForfeits')) for result in games),
                        games_per_second=(len(games) - incomplete) / stats['seconds'],
                        decisions_per_second=stats['decisions_per_second'], mean_batch=stats['mean_batch'],
                        seconds=stats['seconds'], rollout=stats,
                    )
                    del outcome, games
                end_cpu = cpu_counters()
                row['cgroup_cpu_delta'] = {key: end_cpu[key] - value for key, value in start_cpu.items() if key in end_cpu}
                row['gpu_peak_allocated_mib'] = round(torch.cuda.max_memory_allocated() / 2**20, 1)
                row['gpu_peak_reserved_mib'] = round(torch.cuda.max_memory_reserved() / 2**20, 1)
                report['runs'].append(row)
                save_report(args.output, report)
                print(json.dumps({key: value for key, value in row.items() if key != 'rollout'}), flush=True)
                if row['runtime_errors']:
                    break
    report['recommended_workers'] = recommended_workers(report['runs'], args.cycles)
    save_report(args.output, report)
    print(json.dumps(dict(recommended_workers=report['recommended_workers'], output=str(args.output))), flush=True)
    return 0 if report['recommended_workers'] is not None else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('opponents', type=Path, help='Directory containing frozen-current.pt and frozen-417.pt')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--phase', choices=['shared', 'sage'], default='shared')
    parser.add_argument('--workers', type=int, nargs='+', default=[12, 16, 18, 20])
    parser.add_argument('--games', type=int, default=72)
    parser.add_argument('--cycles', type=int, default=2, help='Repeat each worker count with a fresh then reused Node pool')
    parser.add_argument('--offset', type=int, default=700000)
    parser.add_argument('--seed', type=int, default=20261119)
    parser.add_argument('--threads', type=int, default=int(os.environ.get('XINGBEI_TORCH_THREADS', '2')))
    args = parser.parse_args()
    if args.games < 6 or args.games % 6 or min(args.cycles, args.threads, *args.workers) < 1:
        parser.error('Positive workers, cycles, and threads required; games must be a positive multiple of six')
    return benchmark(args)


if __name__ == '__main__':
    raise SystemExit(main())
