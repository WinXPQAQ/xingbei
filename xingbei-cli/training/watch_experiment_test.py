"""Monitor lifecycle without real services, training or desktop notifications."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import watch_experiment as monitor


class MonitorTest(unittest.TestCase):
    def test_completion_requires_training_and_evaluation(self):
        self.assertEqual(monitor.classify(True, False, 'inactive', 'active'), 'running')
        self.assertEqual(monitor.classify(False, True, 'active', 'inactive'), 'running')
        self.assertEqual(monitor.classify(True, True, 'inactive', 'inactive'), 'complete')
        self.assertEqual(monitor.classify(False, False, 'failed', 'active'), 'failed')
        self.assertEqual(monitor.classify(True, False, 'inactive', 'failed'), 'failed')

    def test_transient_error_retries_and_terminal_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            protocol = root / 'protocol.json'
            protocol.write_text(json.dumps({'name': 'test', 'arms': []}))
            output = root / 'monitors/test'
            with patch('sys.argv', ['watch', '--root', str(root), '--protocol', str(protocol)]), \
                    patch.object(monitor, 'tick') as tick, \
                    patch.object(monitor.shutil, 'which', return_value=None):
                tick.side_effect = OSError('temporary read error')
                monitor.main()
                self.assertEqual(monitor.read(output / 'status.json')['state'], 'retrying')
                self.assertFalse((output / 'summary.md').exists())
                tick.side_effect = None
                tick.return_value = {'state': 'complete', 'arms': []}
                monitor.main()
                self.assertTrue((output / 'summary.md').exists())
                monitor.main()
                self.assertEqual(tick.call_count, 2)

    def test_completed_arm_audits_actual_checkpoint_and_schedule(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = root / 'runs/control'
            evaluation = root / 'evaluations/control-1-greedy'
            for path in [run, evaluation, root / 'evidence']:
                path.mkdir(parents=True)
            (run / 'checkpoint-1.pt').write_bytes(b'model')
            (run / 'metrics.jsonl').write_text(json.dumps({
                'iteration': 0, 'games': [{'seed': 10}], 'truncatedExcluded': 0}) + '\n' + '{')
            (root / 'evidence/control-series.json').write_text(json.dumps({'results': [{'completed': 1}]}))
            manifest = {'checkpointSha256': monitor.hashlib.sha256(b'model').hexdigest(),
                        'games': 12, 'firstSeed': 20, 'seeds': 1, 'checkpointUpdates': 1,
                        'selection': 'greedy policy', 'balancedMixedSchedule': True}
            (evaluation / 'manifest.json').write_text(json.dumps(manifest))
            protocol = {'shared': {'updates': 1, 'firstSeed': 10, 'lastSeed': 10, 'seed': 211},
                        'development': {'checkpoints': [1], 'recordsPerEvaluation': 12,
                                        'firstSeed': 20, 'seeds': 1}}
            with patch.object(monitor, 'unit_state', return_value='inactive'), \
                    patch.object(monitor.subprocess, 'run') as audit:
                result = monitor.inspect_arm(root, protocol, 'control')
                self.assertEqual(result['state'], 'complete')
                self.assertEqual(audit.call_count, 1)
                (run / 'checkpoint-1.pt').write_bytes(b'wrong model')
                with self.assertRaisesRegex(ValueError, 'mismatch'):
                    monitor.inspect_arm(root, protocol, 'control')

    def test_repeated_monitor_error_is_not_training_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            protocol = root / 'protocol.json'
            protocol.write_text(json.dumps({'name': 'test', 'arms': []}))
            with patch('sys.argv', ['watch', '--root', str(root), '--protocol', str(protocol)]), \
                    patch.object(monitor, 'tick', side_effect=OSError('unreadable')), \
                    patch.object(monitor.shutil, 'which', return_value=None):
                for _ in range(3):
                    monitor.main()
            self.assertEqual(monitor.read(root / 'monitors/test/status.json')['state'], 'monitor-error')


if __name__ == '__main__':
    unittest.main()
