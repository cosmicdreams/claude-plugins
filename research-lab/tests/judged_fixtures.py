"""Offline fixtures shared by the frozen judged scorer packets.

All repositories, commands, captures and judge returns are local. Production setup
commands assert success before dependent files are read: a stub fails a behavior
assertion, not a KeyError. seed_* methods deliberately bypass transitions and are
reserved for persisted log/state preconditions, not scoring decisions.
"""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'skills/experiment/scripts/judged.py'
DISCARD = ROOT / 'skills/experiment/scripts/discard-trial.py'
LOG = ROOT / 'scripts/log-iteration.sh'


def default_protocol():
    """Return a fresh valid two-role, three-category protocol (no shared mutations)."""
    return dict(artifact_command='capture.sh',
                judges=[dict(role='primary', tier=5),
                        dict(role='second', tier=5, distinct_family=True)],
                categories=dict(clarity='Is the text clear?', accuracy='Is it accurate?',
                                usefulness='Is it useful?'),
                relative_to='absolute', references=['refs/ref-1.md'], target=8.73,
                margin_floor=0.25, max_batch=3, budget_calls=60,
                guardrails=['guard.sh'], iterations=20, futility=5)


def panel():
    """Return inert, distinct-family judge identities; never dispatch a model."""
    return dict(primary=dict(provider='fixture-codex', model='fixture-a', options={'effort': 'high'}),
                second=dict(provider='fixture-claude', model='fixture-b', options={'effort': 'medium'}))


def write_panel(path, value):
    """Write a panel dictionary as UTF-8 JSON and return its absolute Path."""
    path = Path(path).resolve()
    path.write_text(json.dumps(value), encoding='utf-8')
    return path


def write_return(eval_dir, role, k, scores_by_mapping_value, critiques=None, invocation=None):
    """Write one return by meaning, not A/B position, plus invocation provenance.

    Scores are scalar (all categories) or {category: score}; critiques may be a
    string or {meaning: {category: text}}. invocation overrides the recorded role.
    Reference meanings are exactly the mapping's ref:<name> strings.
    """
    eval_dir = Path(eval_dir)
    meta = json.loads((eval_dir / 'eval.json').read_text())
    request = eval_dir / f'{role}-{k}'
    mapping = json.loads((request / 'mapping.json').read_text())
    # Rubrics belong to the fixture protocol; callers supply explicit category maps.
    items = {}
    for label, meaning in mapping.items():
        scores = scores_by_mapping_value[meaning]
        if not isinstance(scores, dict):
            scores = dict.fromkeys(default_protocol()['categories'], scores)
        items[label] = {}
        for category, score in scores.items():
            critique = (critiques if isinstance(critiques, str) else
                        (critiques or {}).get(meaning, {}).get(category, f'{meaning}:{category}'))
            items[label][category] = dict(score=score, critique=critique)
    (request / 'return.json').write_text(json.dumps(dict(items=items)), encoding='utf-8')
    (request / 'invocation.json').write_text(json.dumps(
        meta['panel'][role] if invocation is None else invocation), encoding='utf-8')


class Fixture:
    """Own a primary main repo, linked experiment worktree and external run inputs.

    Use as a context manager or register close with unittest.addCleanup. Public
    paths: root, primary, work, engagement, methodology_dir, methodology, panel_path.
    env contains no inherited Git overrides, user hooks, credentials or config.
    """
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix='judged-fixture-')
        self.root = Path(self.temp.name).resolve()
        home = self.root / 'home'
        home.mkdir()
        self.env = dict(PATH=os.environ['PATH'], HOME=str(home), XDG_CONFIG_HOME=str(home),
                        GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
                        GIT_TERMINAL_PROMPT='0', GIT_EDITOR='true', GIT_SEQUENCE_EDITOR='true',
                        GIT_DEFAULT_HASH='sha1', PYTHONDONTWRITEBYTECODE='1',
                        LC_ALL='C', TZ='UTC')
        self.primary, self.work = self.root / 'primary', self.root / 'work'
        self.engagement, self.methodology_dir = self.root / 'engagement', self.root / 'methodology'
        self.engagement.mkdir()
        self.methodology_dir.mkdir()
        self.methodology = self.methodology_dir / 'methodology.md'
        self.panel_path = write_panel(self.root / 'panel.json', panel())
        self.git('init', '-b', 'main', str(self.primary), cwd=self.root)
        # Configure only the disposable repository; avoid six extra Git startups.
        with (self.primary / '.git/config').open('a') as config:
            config.write('\n[user]\n name = Fixture\n email = fixture@example.invalid\n'
                         '[commit]\n gpgSign = false\n[tag]\n gpgSign = false\n'
                         f'[core]\n hooksPath = {self.root / "no-hooks"}\n')
        (self.primary / 'doc.md').write_text('BASE TEXT café\n', encoding='utf-8')
        self.git('add', '.', cwd=self.primary)
        self.git('commit', '-m', 'base', cwd=self.primary)
        self.git('worktree', 'add', '-b', 'experiment', str(self.work), cwd=self.primary)
        self.base = self.head()
        (self.methodology_dir / 'refs').mkdir()
        (self.methodology_dir / 'refs/ref-1.md').write_text('REFERENCE TEXT\n', encoding='utf-8')
        guard = self.methodology_dir / 'guard.sh'
        guard.write_text('#!/bin/sh\nexit 0\n')
        guard.chmod(0o755)
        capture = self.methodology_dir / 'capture.sh'
        capture.write_text('''#!/usr/bin/env python3
import hashlib, json, pathlib, subprocess, sys
work, out = map(pathlib.Path, sys.argv[-2:])
modefile = pathlib.Path(__file__).parent / 'capture-mode'
mode = modefile.read_text().strip() if modefile.exists() else ''
if mode == 'nonzero': sys.exit(9)
out.mkdir(parents=True, exist_ok=True)
data = (work / 'doc.md').read_bytes()
tagfile = pathlib.Path(__file__).parent / 'capture-tag'
if tagfile.exists(): data += tagfile.read_bytes()
if mode == 'nonutf8': data = b'\\xff'
(out / 'doc.md').write_bytes(data)
if mode == 'no-manifest': sys.exit(0)
if mode == 'malformed':
    (out / 'manifest.json').write_text('{')
    sys.exit(0)
tree = subprocess.check_output(['git', '-C', str(work), 'rev-parse', 'HEAD^{tree}'], text=True).strip()
manifest = {'tree': '0' * 40 if mode == 'wrong-tree' else tree,
            'files': [{'path': 'doc.md', 'sha256': '0' * 64 if mode == 'hash-mismatch' else hashlib.sha256(data).hexdigest()}]}
(out / 'manifest.json').write_text(json.dumps(manifest))
if mode == 'missing-file': (out / 'doc.md').unlink()
''', encoding='utf-8')
        capture.chmod(0o755)
        self.write_methodology(default_protocol())

    def close(self):
        """Remove only this fixture's temporary directory."""
        self.temp.cleanup()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def git(self, *args, cwd=None, check=True):
        """Run real Git with the isolated environment, returning CompletedProcess."""
        return subprocess.run(['git', '-C', str(cwd or self.work), *map(str, args)],
                              env=self.env, text=True, capture_output=True, check=check, timeout=60)

    def write_methodology(self, protocol, metric_type='judged', direction='higher', correctness='Run guard.sh.'):
        """Write all nine numbered sections; protocol=None omits section nine."""
        self.protocol = copy.deepcopy(protocol)
        titles = ['Objective', 'Scope', 'Hypothesis', 'Measurement', 'Budget',
                  'Correctness Checks', 'Iteration Protocol', 'Results']
        bodies = [f'metric_type: {metric_type}\ndirection: {direction}', 'Text documents.',
                  'Improve quality.', 'Judge the text.', 'Use protocol limits.', correctness,
                  'One change at a time.', 'External engagement.']
        text = '\n\n'.join(f'## {i}. {title}\n{body}' for i, (title, body) in
                           enumerate(zip(titles, bodies), 1))
        if protocol is not None:
            text += '\n\n## 9. Judging Protocol\n```judging-protocol\n' + json.dumps(protocol) + '\n```\n'
        self.methodology.write_text(text, encoding='utf-8')
        return self.methodology

    def run(self, subcommand, *args):
        """Run judged.py with common paths; return (exit code, JSON or None, stderr)."""
        result = subprocess.run(['python3', str(SCRIPT), subcommand, '--engagement',
                                 str(self.engagement), '--protocol', str(self.methodology),
                                 *map(str, args)], env=self.env, text=True, capture_output=True, timeout=60)
        try:
            value = json.loads(result.stdout)
        except (ValueError, TypeError):
            value = None
        return result.returncode, value, result.stderr

    def ok(self, command, *args):
        """Assert a production success before reading dependent state files."""
        code, value, err = self.run(command, *args)
        assert code == 0 and isinstance(value, dict), (command, code, value, err)
        return value

    def next(self):
        """Return the raw next command tuple; contains no transition logic."""
        return self.run('next', '--worktree', self.work, '--panel', self.panel_path)

    def commit(self, text):
        """Edit and commit doc.md on the fixture worktree; return full commit hash."""
        (self.work / 'doc.md').write_text(text, encoding='utf-8')
        self.git('add', 'doc.md')
        self.git('commit', '-m', 'fixture change')
        return self.head()

    def tree(self):
        """Return HEAD's Git tree identity."""
        return self.git('rev-parse', 'HEAD^{tree}').stdout.strip()

    def head(self):
        """Return full HEAD commit identity."""
        return self.git('rev-parse', 'HEAD').stdout.strip()

    def write_return(self, eval_dir, role, k, scores_by_mapping_value, critiques=None, invocation=None):
        """Delegate to module write_return (absolute eval_dir or an evaluation id)."""
        path = Path(eval_dir)
        if not path.is_absolute():
            path = self.engagement / 'evals' / path
        categories = (self.protocol or default_protocol())['categories']
        values = {meaning: (scores if isinstance(scores, dict) else dict.fromkeys(categories, scores))
                  for meaning, scores in scores_by_mapping_value.items()}
        return write_return(path, role, k, values, critiques, invocation)

    def log(self, args):
        """Run the REAL log-iteration.sh with an action's complete argv."""
        return subprocess.run([str(LOG), *map(str, args)], env=self.env, text=True, capture_output=True, timeout=60)

    def discard(self, action):
        """Run the REAL guarded discard helper using only the action's ownership fields."""
        return subprocess.run(['python3', str(DISCARD),
                               *[v for key in ('worktree', 'branch', 'base', 'trial')
                                 for v in ('--' + key, str(action[key]))]],
                              env=self.env, text=True, capture_output=True, timeout=60)

    def seed_results(self, *records):
        """Append explicit persisted results records without invoking next or logging."""
        with (self.engagement / 'results.jsonl').open('a', encoding='utf-8') as out:
            for record in records:
                out.write(json.dumps(record) + '\n')

    def seed_trial(self, **overrides):
        """Write ownership state for otherwise unreachable unit-test preconditions."""
        record = dict(iteration=1, worktree=str(self.work), branch='experiment',
                      base=self.base, base_tree=self.git('rev-parse', self.base + '^{tree}').stdout.strip(),
                      commit=None, change='Fixture change')
        record.update(overrides)
        (self.engagement / 'trial.json').write_text(json.dumps(record))
        return record

    def seed_json(self, relative_path, value):
        """Write an explicitly named engagement state file, creating its parents."""
        path = self.engagement / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')
        return path
