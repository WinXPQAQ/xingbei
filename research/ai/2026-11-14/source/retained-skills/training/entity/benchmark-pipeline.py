"""Fixed-checkpoint paired workloads for CPU/GPU pipeline experiments.

Reads snapshots only; never updates models or live service configuration.
Reports each task separately so a faster short drill cannot hide game starvation.
"""
import argparse
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import resource
import statistics
import subprocess
import sys
import time

VARIANTS = {
    'baseline': (64, 32, 2, 'legacy', 'legacy', 'legacy', '0'),
    'baseline48': (32, 16, 2, 'legacy', 'legacy', 'legacy', '0'),
    'gpu96': (64, 32, 1, 'gpu', 'packed', 'typed', '1'),
    'gpu48': (32, 16, 1, 'gpu', 'packed', 'typed', '1'),
    'gpu24': (16, 8, 1, 'gpu', 'packed', 'typed', '1'),
    'cpu48': (32, 16, 1, 'legacy', 'packed', 'typed', '1'),
    'warm96': (64, 32, 2, 'legacy', 'legacy', 'legacy', '0'),
    'warm48': (16, 32, 1, 'gpu', 'packed', 'typed', '1'),
    'warm32': (16, 16, 1, 'gpu', 'packed', 'typed', '1'),
}


def dump(path, value):
    path.write_text(json.dumps(value, indent=2))


def cpu_snapshot():
    values = list(map(int, Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))
    return sum(values), values[3] + values[4]


def run_job(args):
    import torch
    from model import EntityPolicy
    from pool import run_games, GameRuntime
    from specialists import configurations
    torch.set_num_threads(args.threads)
    torch.backends.cuda.matmul.allow_tf32 = True
    model, vocab = EntityPolicy.restore(torch.load(args.directory / (args.job + '.pt'), map_location='cpu', weights_only=False))
    models = {}
    if args.job == 'magic':
        for key, filename in [('frozenCurrent', 'frozen-current.pt'), ('anchor417', 'frozen-417.pt')]:
            models[key] = EntityPolicy.restore(torch.load(args.directory / filename, map_location='cpu', weights_only=False))
        configs = configurations('magicArcher', args.magic_games, 600000, 'pipeline-benchmark')
    else:
        spec = importlib.util.spec_from_file_location('sage_drill', Path(__file__).with_name('sage-drill.py'))
        sage = importlib.util.module_from_spec(spec); spec.loader.exec_module(sage)
        configs = sage.configurations(600000, args.sage_games, exercise=sage.POISON_EXERCISE,
                                     rehearsal_fraction=.25, sustain=True)
    for config in configs:
        config['profile'] = True
    torch.manual_seed(20261112); torch.cuda.manual_seed_all(20261112)
    start = time.perf_counter(); cycles = []
    with GameRuntime() as runtime:
        for cycle in range(args.cycles):
            if args.persistent:
                result = runtime.run(model, vocab, configs, workers=args.workers, device='cuda', models=models, binary=True)
            else:
                result = asyncio.run(run_games(model, vocab, configs, workers=args.workers, device='cuda', models=models, binary=True))
            cycles.append(result['stats'])
    children = resource.getrusage(resource.RUSAGE_CHILDREN)
    parent = resource.getrusage(resource.RUSAGE_SELF)
    pipeline = {}
    for game in result['results']:
        for key, value in game.get('pipeline', {}).items():
            pipeline[key] = pipeline.get(key, 0.) + value
    dump(args.output, dict(task=args.job, seconds=time.perf_counter()-start, stats=result['stats'], cycles=cycles, pipeline=pipeline,
                          cpu_seconds=parent.ru_utime+parent.ru_stime+children.ru_utime+children.ru_stime,
                          gpu_peak_mib=torch.cuda.max_memory_allocated()/2**20,
                          completed=sum(r.get('terminated', r.get('eligible', False)) for r in result['results']),
                          truncated=sum(bool(r.get('truncated')) for r in result['results'])))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--variants', nargs='+', choices=list(VARIANTS), default=list(VARIANTS))
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--magic-games', type=int, default=96)
    parser.add_argument('--sage-games', type=int, default=256)
    parser.add_argument('--job', choices=['magic', 'sage'])
    parser.add_argument('--workers', type=int)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--cycles', type=int, default=1)
    parser.add_argument('--persistent', action='store_true')
    parser.add_argument('--report-name', default='paired-benchmarks')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.job:
        return run_job(args)
    reports = args.directory / args.report_name; reports.mkdir(exist_ok=True)
    rows = []
    for repeat in range(args.repeats):
        # Reverse order on alternate repeats to reduce thermal/time drift.
        for variant in (args.variants if repeat % 2 == 0 else list(reversed(args.variants))):
            path = reports / f'{variant}-{repeat}.json'
            if path.exists():
                rows.append(json.loads(path.read_text())); continue
            magic, sage, threads, collate, decode, wire, cache = VARIANTS[variant]
            env = {**os.environ, 'XINGBEI_COLLATE_MODE':collate, 'XINGBEI_DECODE_MODE':decode,
                   'XINGBEI_WIRE_MODE':wire, 'XINGBEI_PREFIX_CACHE':cache, 'OMP_NUM_THREADS':str(threads)}
            jobs = []
            gpu_file = reports / f'{variant}-{repeat}-gpu.csv'
            with gpu_file.open('w') as gpu_output:
                gpu = subprocess.Popen(['nvidia-smi', '--query-gpu=utilization.gpu,memory.used',
                    '--format=csv,noheader,nounits', '-lms', '500'], stdout=gpu_output)
                started = time.perf_counter(); cpu_start = cpu_snapshot()
                try:
                    for task, workers in [('magic',magic), ('sage',sage)]:
                        result = reports / f'{variant}-{repeat}-{task}.json'
                        log = (reports / f'{variant}-{repeat}-{task}.log').open('w')
                        command = [sys.executable, __file__, str(args.directory), '--job',task,
                            '--workers',str(workers),'--threads',str(threads),'--output',str(result),
                            '--magic-games',str(args.magic_games),'--sage-games',str(args.sage_games),'--cycles',str(args.cycles)]
                        if variant.startswith('warm'):command.append('--persistent')
                        task_env={**env}
                        if variant in ('warm48','warm32') and task=='sage':task_env['XINGBEI_COLLATE_MODE']='legacy'
                        jobs.append((task, subprocess.Popen(command,env=task_env,stdout=log,stderr=log), result, log))
                    for task, process, result, log in jobs:
                        if process.wait() != 0:
                            raise RuntimeError(f'{task} benchmark failed; inspect {log.name}')
                finally:
                    for _,process,_,log in jobs:
                        if process.poll() is None:
                            process.terminate(); process.wait()
                        log.close()
                    gpu.terminate(); gpu.wait()
                elapsed = time.perf_counter()-started; cpu_end = cpu_snapshot()
            samples = [list(map(float,line.split(','))) for line in gpu_file.read_text().splitlines() if line.strip()]
            row = dict(variant=variant, repeat=repeat, seconds=elapsed, workers=[magic,sage],threads=threads,
                cpu_busy=1-(cpu_end[1]-cpu_start[1])/max(1,cpu_end[0]-cpu_start[0]),
                gpu_mean=statistics.mean(s[0] for s in samples) if samples else None,
                gpu_peak_mib=max((s[1] for s in samples),default=0),
                tasks={task:json.loads(result.read_text()) for task,_,result,_ in jobs})
            dump(path,row);rows.append(row)
            print(json.dumps({k:v for k,v in row.items() if k!='tasks'}),flush=True)
            dump(reports/'summary.json',rows)


if __name__ == '__main__':
    main()
