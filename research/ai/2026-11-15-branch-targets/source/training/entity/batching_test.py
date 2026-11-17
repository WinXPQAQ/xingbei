import array
import os
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import torch
from batching import collate_gpu
from binary_wire import decode_tensor
from model import SCHEMA, Vocabulary, collate_prepared
from pool import GameRuntime


class PipelineTests(unittest.TestCase):
    def test_shared_budget_caps_both_jobs_and_rejects_overallocation(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'budget.json'
            job=dict(workers=16,threads=1,collate='gpu',decode='packed',wire='typed',prefix_cache=1)
            budget=dict(total_workers=32,jobs={'magic':job,'sage':{**job,'collate':'legacy'}})
            path.write_text(json.dumps(budget))
            with patch.dict(os.environ,XINGBEI_RESOURCE_BUDGET=str(path),XINGBEI_RESOURCE_JOB='magic'):
                with GameRuntime() as runtime:
                    self.assertEqual(runtime.worker_limit(64),16)
                    self.assertEqual(os.environ['XINGBEI_TORCH_THREADS'],'1')
                budget['total_workers']=24;path.write_text(json.dumps(budget))
                with self.assertRaisesRegex(ValueError,'resource budget'):
                    with GameRuntime():pass

    def test_warm_workers_reset_games_and_discard_failed_batches(self):
        class FirstLegal(torch.nn.Module):
            def policy_logits(self, batch):
                mask=batch['mask'][:,batch['entities']:]
                return torch.zeros(mask.shape,device=mask.device).masked_fill(mask,-torch.inf)
        model=FirstLegal(); vocabulary=Vocabulary()
        configs=[dict(exercise='sage-self-codex-v1',seed=81+i,decisionLimit=256,
                      seatPolicies=['model']+['v1.5']*5) for i in range(2)]
        with GameRuntime() as runtime:
            first=runtime.run(model,vocabulary,configs,workers=2,binary=True)
            processes=list(runtime.pool.idle)
            second=runtime.run(model,vocabulary,configs,workers=2,binary=True)
            self.assertEqual(first['stats']['workers_started'],2)
            self.assertEqual(second['stats']['workers_reused'],2)
            strip=lambda result:{k:v for k,v in result.items() if k!='elapsedMs'}
            self.assertEqual(list(map(strip,first['results'])),list(map(strip,second['results'])))
            with self.assertRaisesRegex(RuntimeError,'Unknown exercise'):
                runtime.run(model,vocabulary,[dict(configs[0],exercise='invalid')],workers=1,binary=True)
            recovered=runtime.run(model,vocabulary,configs,workers=2,binary=True)
            self.assertEqual(recovered['stats']['workers_started'],1)
            self.assertEqual(list(map(strip,first['results'])),list(map(strip,recovered['results'])))
            processes.extend(runtime.pool.idle)
        self.assertTrue(all(process.returncode is not None for process in processes))

    def test_decode_preserves_indices_and_rejects_invalid_frames(self):
        vocabulary = Vocabulary(['<pad>', '<unknown>', 'a', 'b'])
        for width in [2, 4]:
            groups = [[0, 2], [1, 2], [2], [0], [3], [1]]
            body = b''.join(array.array('H' if width == 2 else 'I', group).tobytes() for group in groups)
            body += b'\0' * (-len(body) % 4) + array.array('f', [0.5]).tobytes()
            header = dict(wire='tensor-v1', schema=SCHEMA, vocabulary=vocabulary.digest,
                          entity_count=2, action_count=1, feature_count=2, reference_count=1,
                          weight_count=1, question=1, indexBytes=width)
            results = []
            for mode in ['legacy', 'packed']:
                with patch.dict(os.environ, XINGBEI_DECODE_MODE=mode):
                    results.append(decode_tensor(header, body, vocabulary)['tensors'])
                    for invalid in [body[:-1], bytes([255]) * width + body[width:],
                                    body[:-4] + array.array('f', [float('nan')]).tobytes()]:
                        with self.assertRaises(ValueError):
                            decode_tensor(header, invalid, vocabulary)
            for key, value in results[0].items():
                if isinstance(value, torch.Tensor):
                    self.assertTrue(torch.equal(value, results[1][key]), key)
                else:
                    self.assertEqual(value, results[1][key])

    @unittest.skipUnless(torch.cuda.is_available(), 'CUDA required for GPU batching comparison')
    def test_gpu_batch_matches_cpu_and_does_not_mutate_training_samples(self):
        torch.set_num_threads(1)
        entries = []
        for entities, actions, linked in [(3, 2, True), (1, 1, False), (4, 3, True)]:
            entries.append(dict(entities=entities, actions=actions,
                rows=torch.tensor([0, entities, entities+actions-1]), ids=torch.tensor([1, 2, 3]),
                weights=torch.tensor([1., -0.5, 0.]),
                source=torch.tensor([entities] if linked else [], dtype=torch.long),
                target=torch.tensor([0] if linked else [], dtype=torch.long),
                roles=torch.tensor([2] if linked else [], dtype=torch.long),
                question=torch.tensor([entities-1]), mask=torch.zeros((1, entities+actions),dtype=torch.bool)))
        original = [{k:v.clone() if isinstance(v,torch.Tensor) else v for k,v in e.items()} for e in entries]
        for batch in [entries[:1], entries[1:2], entries, entries*8]:
            expected = collate_prepared(batch, 'cpu')
            actual = collate_gpu(batch, 'cuda')
            for key, value in expected.items():
                if isinstance(value, torch.Tensor):
                    self.assertTrue(torch.equal(value, actual[key].cpu()), key)
                else:
                    self.assertEqual(value, actual[key])
        for before, after in zip(original, entries):
            for key, value in before.items():
                if isinstance(value, torch.Tensor):
                    self.assertTrue(torch.equal(value, after[key]), key)


if __name__ == '__main__':
    unittest.main()
