import json
import tempfile
import unittest
from unittest.mock import patch
import pause_after_stage
from datetime import datetime, timezone
from pathlib import Path
from control import assert_training_start_allowed
from pause_after_stage import registered_units

class TrainingPauseTests(unittest.TestCase):
    def test_deadline_and_explicit_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'control.json'
            assert_training_start_allowed(path)
            control = {'state':'scheduled','cutoffUtc':'2026-10-21T16:53:00Z'}
            path.write_text(json.dumps(control))
            assert_training_start_allowed(path,datetime(2026,10,21,16,52,59,tzinfo=timezone.utc))
            for second in (0,1):
                with self.assertRaises(RuntimeError):
                    assert_training_start_allowed(path,datetime(2026,10,21,16,53,second,tzinfo=timezone.utc))
            control['state']='resumed';path.write_text(json.dumps(control))
            assert_training_start_allowed(path,datetime(2026,10,22,tzinfo=timezone.utc))

    def test_paused_or_malformed_never_starts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'control.json'
            for state in ('draining','paused'):
                path.write_text(json.dumps({'state':state,'cutoffUtc':'2099-01-01T00:00:00Z'}))
                with self.assertRaises(RuntimeError): assert_training_start_allowed(path)
            path.write_text('{bad')
            with self.assertRaises(ValueError): assert_training_start_allowed(path)

    def test_drain_waits_without_stopping_services(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); run=root/'runs/residual-test';run.mkdir(parents=True)
            (run/'launch-manifest.json').write_text('{}');(root/'evidence').mkdir()
            control={'state':'scheduled','cutoffUtc':'2000-01-01T00:00:00Z'}
            with patch.object(pause_after_stage,'ROOT',root), patch.object(pause_after_stage,'CONTROL',root/'control.json'), patch.object(pause_after_stage,'read_control',return_value=control), patch.object(pause_after_stage.time,'sleep') as sleep, patch.object(pause_after_stage.subprocess,'check_output',side_effect=['active', 'inactive', 'inactive', 'inactive']) as systemd:
                pause_after_stage.main()
            sleep.assert_called_once_with(15)
            self.assertTrue(all(call.args[0][:3]==['systemctl','--user','show'] for call in systemd.call_args_list))
            self.assertEqual(json.loads((root/'control.json').read_text())['state'],'paused')
            self.assertEqual(json.loads((root/'evidence/training-pause-handoff.json').read_text())['activeJobs'],[])

    def test_drain_only_registered_training_units(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); run=root/'runs/residual-test';run.mkdir(parents=True)
            (run/'launch-manifest.json').write_text('{}')
            (root/'preview').mkdir()
            self.assertEqual(registered_units(root), ['xingbei-ml-residual-test.service','xingbei-ml-validate-residual-test.service'])

if __name__ == '__main__': unittest.main()
