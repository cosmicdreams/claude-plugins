import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('health', Path(__file__).parents[1] / 'scripts' / 'health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class HealthTests(unittest.TestCase):
    def test_allowance_requires_fresh_data_and_twenty_percent(self):
        class Result:
            stdout = json.dumps([
                {'pool': 'codex', 'windows': [{'remaining_pct': 20, 'age_minutes': 1}]},
                {'pool': 'low', 'windows': [{'remaining_pct': 19, 'age_minutes': 1}]},
                {'pool': 'stale', 'windows': [{'remaining_pct': 90, 'age_minutes': 361}]},
                {'pool': 'unknown', 'windows': []},
            ])
        with patch.object(health.subprocess, 'run', return_value=Result()):
            result, error = health.allowance('/fake', 360)
        self.assertIsNone(error)
        self.assertTrue(result['codex']['available'])
        for name in ('low', 'stale', 'unknown'):
            self.assertFalse(result[name]['available'])

    def test_failure_never_authorizes_work(self):
        with tempfile.TemporaryDirectory() as temp:
            result = health.snapshot(Path(temp), Path(temp) / 'missing')
        self.assertEqual(result['allowance'], {})
        self.assertTrue(result['allowance_error'])


if __name__ == '__main__':
    unittest.main()
