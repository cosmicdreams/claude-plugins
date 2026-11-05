"""The research-lab vault folder: where engagements and experiment runs are kept.

Every write goes through `inside()`, so nothing this script does lands outside
the configured folder. Stdlib only.

Usage:
  research_lab.py root
  research_lab.py new engagement|run SLUG [--date YYYY-MM-DD]
  research_lab.py register-run --engagement E [--slug S] [--question Q] [--used-by NAME ...]
                               [--methodology M] [--scorer S] [--outcome O]
  research_lab.py index

Configuration is one JSON file, `research-lab.json` in the Claude configuration
directory (or the path in RESEARCH_LAB_CONFIG):

  {"vault": "~/Vaults/MyVault", "folder": "Research-Lab", "index": "Index.md"}

Only `vault` is required. Renaming the folder or the index means changing one
key here and moving one folder or file; skills never spell either name out.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import sys
from pathlib import Path

KINDS = {'engagement': 'Engagements', 'run': 'Experiments'}
DEFAULTS = {'folder': 'Research-Lab', 'index': 'Index.md'}


class Refused(Exception):
    pass


def config_path():
    if os.environ.get('RESEARCH_LAB_CONFIG'):
        return Path(os.environ['RESEARCH_LAB_CONFIG']).expanduser()
    base = os.environ.get('CLAUDE_CONFIG_DIR') or '~/.claude'
    return Path(base).expanduser() / 'research-lab.json'


def settings():
    path = config_path()
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError:
        raise Refused(f'unconfigured: no {path}; write {{"vault": "<path>"}} there to keep '
                      'engagements and experiment runs in a vault')
    except ValueError as error:
        raise Refused(f'{path} is not valid JSON: {error}')
    if not isinstance(raw, dict) or not raw.get('vault'):
        raise Refused(f'{path} has no "vault" key')
    s = {**DEFAULTS, **raw}
    for key in ('folder', 'index'):
        if not s[key] or '/' in s[key] or s[key] in ('.', '..'):
            raise Refused(f'"{key}" must be a plain name, not a path')
    vault = Path(s['vault']).expanduser()
    if not vault.is_dir():
        raise Refused(f'vault {vault} does not exist')
    s['root'] = (vault / s['folder']).resolve()
    if vault.resolve() not in s['root'].parents:
        raise Refused(f'{s["root"]} is not a folder inside the vault')
    return s


def inside(root, path):
    """Return path resolved, or refuse if it falls outside root."""
    resolved = Path(path).resolve()
    if resolved != root and root not in resolved.parents:
        raise Refused(f'{resolved} is outside {root}')
    return resolved


def slugify(text):
    slug = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    if not slug:
        raise Refused('slug is empty')
    return slug[:60].rstrip('-')


def new(root, kind, slug, date=None):
    """Create a uniquely named folder: <date>-<slug>, then -2, -3 on collision."""
    date = date or datetime.date.today().isoformat()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
        raise Refused('date must be YYYY-MM-DD')
    parent = inside(root, root / KINDS[kind])
    parent.mkdir(parents=True, exist_ok=True)
    base = f'{date}-{slugify(slug)}'
    for n in range(1, 1000):
        folder = inside(root, parent / (base if n == 1 else f'{base}-{n}'))
        try:
            folder.mkdir()
            return folder
        except FileExistsError:
            continue
    raise Refused(f'too many folders named {base}')


def frontmatter(text):
    """Flat `key: value` frontmatter; list values are JSON arrays."""
    match = re.match(r'---\n(.*?)\n---\n', text, re.S)
    out = {}
    for line in (match.group(1).splitlines() if match else []):
        key, sep, value = line.partition(':')
        if sep:
            value = value.strip()
            try:
                out[key.strip()] = json.loads(value)
            except ValueError:
                out[key.strip()] = value
    return out


def render(fields):
    lines = ['---']
    for key, value in fields.items():
        if value is not None and value != []:
            lines.append(f'{key}: {json.dumps(value)}')
    return '\n'.join(lines + ['---', ''])


def register_run(root, engagement, slug=None, question=None, used_by=(),
                 methodology=None, scorer=None, outcome=None):
    """Copy an experiment run's report and methodology in, with a summary note.

    Raw results (state.json, results.jsonl) stay in the run's engagement
    directory; the note records where that is. A judged run has no
    state.json, so its methodology, scorer and outcome are passed in.
    """
    e = Path(engagement).expanduser().resolve()
    if not e.is_dir():
        raise Refused(f'no engagement directory {e}')
    try:
        state = json.loads((e / 'state.json').read_text())
    except (OSError, ValueError):
        state = {}
    methodology = methodology or state.get('methodology')
    methodology = Path(methodology).expanduser() if methodology else None
    folder = new(root, 'run', slug or e.name)
    copied = []
    for source, name in ((e / 'report.md', 'report.md'), (methodology, 'methodology.md')):
        if source and source.is_file():
            shutil.copyfile(source, inside(root, folder / name))
            copied.append(name)
    ending = state.get('ending') or {}
    fields = {
        'type': 'experiment-run',
        'name': folder.name,
        'date': folder.name[:10],
        'question': question,
        'strategy': state.get('strategy'),
        'scorer': scorer or state.get('scorer'),
        'status': state.get('status'),
        'outcome': outcome or ending.get('kind'),
        'best': state.get('ratchet'),
        'baseline': state.get('baseline'),
        'trials': state.get('trials_used'),
        'branch': state.get('branch'),
        'worktree': state.get('worktree'),
        'raw_results': str(e),
        'used_by': list(used_by),
    }
    body = [f'# Experiment run: {folder.name}', '']
    if ending.get('detail'):
        body += [f"Ending: {ending['kind']}: {ending['detail']}", '']
    body += ['Files: ' + (', '.join(f'[[{folder.name}/{n}]]' for n in copied) or 'none copied'),
             '', f'Raw results stay outside the vault, in `{e}`.', '']
    (inside(root, folder / 'run.md')).write_text(render(fields) + '\n'.join(body))
    return folder


def rows(root, kind, note):
    parent = root / KINDS[kind]
    for folder in sorted(parent.iterdir() if parent.is_dir() else (), reverse=True):
        path = folder / note
        if path.is_file():
            yield folder.name, frontmatter(path.read_text())


def cell(value):
    return str('' if value is None else value).replace('|', '\\|').replace('\n', ' ')


def index(s):
    """Rebuild the index from the folders. It is derived; never edit it by hand."""
    root = s['root']
    lines = ['---', 'type: research-lab-index', '---', '',
             '# Research-lab index', '',
             'Generated by research-lab from the folders below. Edits here are overwritten.', '',
             '## Engagements', '',
             '| Engagement | Status | Question | Corpora |', '| --- | --- | --- | --- |']
    for name, f in rows(root, 'engagement', 'record.md'):
        corpora = ', '.join(c if isinstance(c, str) else c.get('name', '?')
                            for c in (f.get('corpora') or []))
        lines.append(f"| [[{name}/record\\|{name}]] | {cell(f.get('status'))} | "
                     f"{cell(f.get('question'))} | {cell(corpora)} |")
    lines += ['', '## Experiment runs', '',
              '| Run | Strategy | Outcome | Question | Used by |', '| --- | --- | --- | --- | --- |']
    for name, f in rows(root, 'run', 'run.md'):
        lines.append(f"| [[{name}/run\\|{name}]] | {cell(f.get('strategy'))} | "
                     f"{cell(f.get('outcome'))} | {cell(f.get('question'))} | "
                     f"{cell(', '.join(f.get('used_by') or []))} |")
    root.mkdir(parents=True, exist_ok=True)
    path = inside(root, root / s['index'])
    path.write_text('\n'.join(lines) + '\n')
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('root')
    n = sub.add_parser('new')
    n.add_argument('kind', choices=sorted(KINDS))
    n.add_argument('slug')
    n.add_argument('--date')
    r = sub.add_parser('register-run')
    r.add_argument('--engagement', required=True)
    r.add_argument('--slug')
    r.add_argument('--question')
    r.add_argument('--used-by', action='append', default=[])
    r.add_argument('--methodology')
    r.add_argument('--scorer')
    r.add_argument('--outcome')
    sub.add_parser('index')
    a = parser.parse_args(argv)
    try:
        s = settings()
        if a.command == 'root':
            out = {'root': str(s['root']), 'index': str(s['root'] / s['index'])}
        elif a.command == 'new':
            out = {'path': str(new(s['root'], a.kind, a.slug, a.date))}
        elif a.command == 'register-run':
            folder = register_run(s['root'], a.engagement, a.slug, a.question, a.used_by,
                                  a.methodology, a.scorer, a.outcome)
            out = {'path': str(folder), 'index': str(index(s))}
        else:
            out = {'index': str(index(s))}
    except Refused as error:
        print(json.dumps({'status': 'refused', 'reason': str(error)}))
        return 1
    print(json.dumps({'status': 'ok', **out}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
