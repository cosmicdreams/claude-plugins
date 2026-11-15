"""Exercise scaffold output and the Drupal starter without launching DDEV."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCAFFOLD = ROOT / 'admin/skills/scaffold/scaffold.sh'
STARTER = ROOT / 'drupal-lab/skills/module-dev-starter/module-dev-starter.sh'


class ScaffoldTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.target = Path(self.temp.name) / 'example-project'
        self.target.mkdir()

    def run_scaffold(self):
        return subprocess.run(['zsh', str(SCAFFOLD), str(self.target), 'example'],
                              check=True, capture_output=True, text=True)

    def test_fresh_project_uses_agents(self):
        self.run_scaffold()
        self.assertIn('# AGENTS.md', (self.target / 'AGENTS.md').read_text().splitlines())
        self.assertFalse((self.target / 'CLAUDE.md').exists())
        for name in ('plans', 'analysis-reports', 'scripts', 'worktrees'):
            self.assertTrue((self.target / name).is_dir())

    def test_repeat_preserves_existing_instructions_and_settings(self):
        (self.target / 'AGENTS.md').write_text('Project instructions\n')
        (self.target / '.claude').mkdir()
        settings = self.target / '.claude/settings.json'
        settings.write_text(json.dumps({'custom': 1, 'agentSquad': {'scaffoldDetect': False}}))
        self.run_scaffold()
        self.run_scaffold()
        self.assertEqual((self.target / 'AGENTS.md').read_text(), 'Project instructions\n')
        self.assertEqual(json.loads(settings.read_text()), {
            'custom': 1, 'agentSquad': {'scaffoldDetect': False, 'scaffoldComplete': True}})
        self.assertFalse((self.target / 'CLAUDE.md').exists())

    def test_legacy_file_is_preserved(self):
        legacy = self.target / 'CLAUDE.md'
        legacy.write_text('Existing legacy guidance\n')
        self.run_scaffold()
        self.assertEqual(legacy.read_text(), 'Existing legacy guidance\n')
        self.assertTrue((self.target / 'AGENTS.md').exists())

    def test_drupal_starter_appends_only_to_agents_once(self):
        self.run_scaffold()
        for _ in range(2):
            result = subprocess.run(['zsh', str(STARTER), str(self.target)],
                                    check=True, capture_output=True, text=True)
            self.assertIn('MODULE_STARTER_DDEV=skipped:no-worktree', result.stdout)
        text = (self.target / 'AGENTS.md').read_text()
        self.assertEqual(text.count('## Drupal Contrib Module'), 1)
        self.assertFalse((self.target / 'CLAUDE.md').exists())


if __name__ == '__main__':
    unittest.main()
