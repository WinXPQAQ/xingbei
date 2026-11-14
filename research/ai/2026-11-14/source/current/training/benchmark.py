"""Measure simulator + real JSON IPC, without claiming neural inference throughput."""
import argparse
import asyncio
import json
import pathlib
import time

WORKER = pathlib.Path(__file__).with_name('worker.mjs')


async def worker(queue):
    process = await asyncio.create_subprocess_exec(
        'node', str(WORKER), stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        limit=16 * 1024 * 1024)
    results, byte_count = [], 0

    async def send(value):
        process.stdin.write((json.dumps(value) + '\n').encode())
        await process.stdin.drain()

    try:
        while not queue.empty():
            seed = queue.get_nowait()
            state = seed
            await send({'type': 'start', 'config': {'seed': seed, 'start': seed % 6}})
            while True:
                line = await process.stdout.readline()
                if not line:
                    raise RuntimeError((await process.stderr.read()).decode())
                byte_count += len(line)
                message = json.loads(line)
                if message['type'] == 'error':
                    raise RuntimeError(message['error'])
                if message['type'] == 'result':
                    results.append(message['result'])
                    break
                assert message['type'] == 'decision'
                state = (1664525 * state + 1013904223) & 0xffffffff
                index = state * len(message['observation']['candidates']) // 2**32
                await send({'type': 'select', 'id': message['id'], 'index': index})
    finally:
        if process.returncode is None:
            process.terminate()
        await process.wait()
    return results, byte_count


async def main(args):
    report, reference = [], None
    for count in args.workers:
        queue = asyncio.Queue()
        for seed in range(210000040, 210000040 + args.games):
            queue.put_nowait(seed)
        started = time.perf_counter()
        outputs = await asyncio.gather(*(worker(queue) for _ in range(count)))
        elapsed = time.perf_counter() - started
        results = sorted([result for batch, _ in outputs for result in batch], key=lambda result: result['seed'])
        if reference is None:
            reference = results
        assert reference == results, 'Concurrency changed deterministic game results'
        decisions = sum(result['decisions'] for result in results)
        report.append({'workers': count, 'games': len(results), 'seconds': elapsed,
                       'decisions': decisions, 'decisionsPerSecond': decisions / elapsed,
                       'gamesPerSecond': len(results) / elapsed,
                       'receivedBytes': sum(size for _, size in outputs),
                       'truncated': sum(result['truncated'] for result in results),
                       'maxCandidates': max(result['maxCandidates'] for result in results)})
    print(json.dumps({'scope': 'uniform policy + detached observation + JSON IPC, no neural inference',
                      'resultsInvariantAcrossWorkerCounts': True, 'measurements': report}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--games', type=int, default=24)
    parser.add_argument('--workers', type=int, nargs='+', default=[1, 2, 4, 8])
    asyncio.run(main(parser.parse_args()))
