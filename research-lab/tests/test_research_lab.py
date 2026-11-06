"""research_lab.py: the vault folder for engagements and experiment runs."""
import contextlib
import io
import json
import os
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import research_lab as rl  # noqa: E402


class ResearchLabTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = pathlib.Path(tmp.name).resolve()
        self.vault = self.tmp / 'vault'
        self.vault.mkdir()
        self.config = self.tmp / 'research-lab.json'
        self.configure(vault=str(self.vault))
        os.environ['RESEARCH_LAB_CONFIG'] = str(self.config)
        self.addCleanup(os.environ.pop, 'RESEARCH_LAB_CONFIG', None)

    def configure(self, **values):
        self.config.write_text(json.dumps(values))

    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = rl.main(list(argv))
        return code, json.loads(out.getvalue())

    def files_written(self):
        return {p for p in self.tmp.rglob('*') if p.is_file()} - {self.config}

    def experiment(self, **state):
        e = self.tmp / 'worktree' / 'analysis' / 'cache-climb'
        e.mkdir(parents=True)
        methodology = self.tmp / 'worktree' / 'methodology.md'
        methodology.write_text('# Methodology\n')
        (e / 'report.md').write_text('## Ending and goal\n')
        (e / 'results.jsonl').write_text('{}\n')
        (e / 'state.json').write_text(json.dumps({
            'strategy': 'climb', 'scorer': 'scripted', 'status': 'stopped',
            'ending': {'kind': 'met', 'detail': 'target reached'}, 'ratchet': 41.0,
            'baseline': 80.0, 'trials_used': 6, 'branch': 'feature/x',
            'worktree': str(self.tmp / 'worktree'), 'methodology': str(methodology), **state}))
        return e

    def test_unconfigured_refuses_and_writes_nothing(self):
        self.config.unlink()
        code, out = self.run_cli('new', 'engagement', 'edge caching')
        self.assertEqual((code, out['status']), (1, 'refused'))
        self.assertIn('unconfigured', out['reason'])
        self.assertEqual(self.files_written(), set())

    def test_folder_and_index_names_come_from_configuration(self):
        self.configure(vault=str(self.vault), folder='Lab', index='Catalog.md')
        code, out = self.run_cli('index')
        self.assertEqual(code, 0)
        self.assertEqual(pathlib.Path(out['index']), self.vault / 'Lab' / 'Catalog.md')

    def test_names_that_are_paths_are_refused(self):
        for key, value in (('folder', '../Elsewhere'), ('index', '../index.md'), ('folder', '..')):
            with self.subTest(key=key, value=value):
                self.configure(vault=str(self.vault), **{key: value})
                code, out = self.run_cli('index')
                self.assertEqual(code, 1)
        self.assertEqual(self.files_written(), set())

    def test_folder_that_resolves_to_the_vault_is_refused(self):
        self.configure(vault=str(self.vault), folder='..')
        self.assertEqual(self.run_cli('index')[0], 1)
        (self.vault / 'Research-Lab').symlink_to(self.vault)
        self.configure(vault=str(self.vault), index='index.md')
        code, out = self.run_cli('index')
        self.assertEqual(code, 1)
        self.assertFalse((self.vault / 'index.md').exists())

    def test_new_names_are_dated_slugs_and_never_collide(self):
        paths = [self.run_cli('new', 'run', 'Edge Caching!', '--date', '2026-11-05')[1]['path']
                 for _ in range(3)]
        self.assertEqual([pathlib.Path(p).name for p in paths],
                         ['2026-11-05-edge-caching', '2026-11-05-edge-caching-2',
                          '2026-11-05-edge-caching-3'])

    def test_slug_cannot_escape_the_folder(self):
        code, out = self.run_cli('new', 'engagement', '../../../etc', '--date', '2026-11-05')
        self.assertEqual(code, 0)
        root = self.vault / 'Research-Lab'
        self.assertEqual(pathlib.Path(out['path']).parent, root / 'Engagements')

    def test_register_run_copies_report_and_methodology_but_not_raw_results(self):
        e = self.experiment()
        code, out = self.run_cli('register-run', '--engagement', str(e), '--slug', 'cache climb',
                                 '--question', 'Can TTFB drop below 50 ms?', '--used-by', '2026-11-05-edge')
        self.assertEqual(code, 0)
        folder = pathlib.Path(out['path'])
        self.assertEqual(sorted(p.name for p in folder.iterdir()),
                         ['methodology.md', 'report.md', 'run.md'])
        note = rl.frontmatter((folder / 'run.md').read_text())
        self.assertEqual((note['type'], note['strategy'], note['outcome'], note['best'], note['trials']),
                         ('experiment-run', 'climb', 'met', 41.0, 6))
        self.assertEqual(note['raw_results'], str(e))
        self.assertEqual(note['used_by'], ['2026-11-05-edge'])
        index = pathlib.Path(out['index']).read_text()
        self.assertIn(folder.name, index)
        self.assertIn('Can TTFB drop below 50 ms?', index)

    def test_judged_run_registers_from_explicit_arguments(self):
        e = self.tmp / 'judged-run'
        e.mkdir()
        (e / 'report.md').write_text('report\n')
        protocol = self.tmp / 'protocol.md'
        protocol.write_text('# Judging protocol\n')
        code, out = self.run_cli('register-run', '--engagement', str(e), '--methodology', str(protocol),
                                 '--scorer', 'council', '--outcome', 'target')
        self.assertEqual(code, 0)
        folder = pathlib.Path(out['path'])
        self.assertEqual(sorted(p.name for p in folder.iterdir()),
                         ['methodology.md', 'report.md', 'run.md'])
        note = rl.frontmatter((folder / 'run.md').read_text())
        self.assertEqual((note['scorer'], note['outcome']), ('council', 'target'))

    def test_index_lists_engagement_records(self):
        folder = pathlib.Path(self.run_cli('new', 'engagement', 'edge caching')[1]['path'])
        (folder / 'record.md').write_text(rl.render({
            'type': 'research-engagement', 'status': 'active', 'question': 'Which edge cache?',
            'corpora': ['notebook: Drupal caching', 'vault: Research-Lab/Topics/caching']}) + '# Record\n')
        index = pathlib.Path(self.run_cli('index')[1]['index']).read_text()
        self.assertIn(f'[[{folder.name}/record\\|{folder.name}]] | active | Which edge cache?', index)
        self.assertIn('notebook: Drupal caching', index)

    def test_index_lists_topics_with_their_newest_dated_note(self):
        topics = self.vault / 'Research-Lab' / 'Topics'
        (topics / 'Security').mkdir(parents=True)
        (topics / 'Security' / '2026-03-10-imperva.md').write_text('a\n')
        (topics / 'Security' / '2026-10-21-log-hunt.md').write_text('b\n')
        (topics / 'Security' / 'notes.md').write_text('c\n')
        (topics / 'Empty').mkdir()
        (topics / 'compendium.md').write_text('d\n')
        before = self.files_written()
        index = pathlib.Path(self.run_cli('index')[1]['index']).read_text()
        self.assertIn('| `Topics/Security/` | 3 | [[Topics/Security/2026-10-21-log-hunt\\|2026-10-21-log-hunt]] |',
                      index)
        self.assertIn('| [[Topics/compendium\\|compendium]] | 1 | |', index)
        self.assertNotIn('Empty', index)
        self.assertEqual({p.name for p in self.files_written() - before}, {'Index.md'})

    def test_every_write_stays_inside_the_configured_folder(self):
        """The funnel lock rule: nothing here may touch index.md, log.md or Sources/."""
        e = self.experiment()
        before = self.files_written()
        self.run_cli('new', 'engagement', 'one')
        self.run_cli('register-run', '--engagement', str(e))
        self.run_cli('index')
        root = self.vault / 'Research-Lab'
        for path in self.files_written() - before:
            with self.subTest(path=path):
                self.assertIn(root, path.parents)


if __name__ == '__main__':
    unittest.main()
