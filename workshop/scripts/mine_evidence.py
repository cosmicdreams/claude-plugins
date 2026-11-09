#!/usr/bin/env python3
"""Collect a repository's mistake evidence for workshop:harden. Stdlib only.

mine_evidence.py --repo PATH [--since YYYY-MM-DD] [--ledgers DIR] [--offline]

Prints one JSON object:
  fix_commits      fix and revert commits on any branch, with the files they touched
  ci_failures      failed GitHub Actions runs (null when --offline or gh fails)
  review_comments  inline PR review comments, bots included (null likewise)
  review_findings  review-loop ledger lines for this repository
Grouping the evidence into mistake classes is the skill's job, not this script's.
"""
import argparse
import json
import re
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

FIX = re.compile(r'^(fix|revert)(\([^)]*\))?!?:', re.IGNORECASE)
LEDGERS = Path.home() / '.local/state/tstack/review-ledgers'


def git(repo, *args):
    return subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True, check=True).stdout


def github_slug(repo):
    try:
        url = git(repo, 'remote', 'get-url', 'origin').strip()
    except subprocess.CalledProcessError:
        return None
    match = re.search(r'github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$', url)
    return match[1] if match else None


def fix_commits(repo, since):
    """Fix and revert commits, one per subject: a squash merge repeats its branch commit."""
    log = git(repo, 'log', '--all', f'--since={since}', '--format=%H%x1f%ad%x1f%s', '--date=short')
    seen, commits = set(), []
    for line in log.splitlines():
        sha, day, subject = line.split('\x1f', 2)
        key = re.sub(r'\s*\(#\d+\)$', '', subject)
        if not FIX.match(subject) or key in seen:
            continue
        seen.add(key)
        files = git(repo, 'show', '--name-only', '--format=', sha).split()
        commits.append(dict(sha=sha[:10], date=day, subject=subject, files=files))
    return commits


def gh_json(*args):
    r = subprocess.run(['gh', *args], capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise RuntimeError(r.stderr.strip() or f'gh exited {r.returncode}')
    return json.loads(r.stdout or 'null')


def ci_failures(slug, since):
    runs = gh_json('run', 'list', '-R', slug, '--status', 'failure', '--limit', '200',
                   '--json', 'workflowName,headBranch,event,createdAt,url')
    return [r for r in runs if r['createdAt'][:10] >= since]


def review_comments(slug, since):
    pages = gh_json('api', '--paginate', '--slurp',
                    f'repos/{slug}/pulls/comments?since={since}T00:00:00Z&per_page=100')
    return [dict(user=c['user']['login'], path=c.get('path'), pr=c['pull_request_url'].rsplit('/', 1)[-1],
                 date=c['created_at'][:10], body=c['body'][:400])
            for page in pages for c in page]


def review_findings(slug, root):
    folder = Path(root) / slug.replace('/', '-') if slug else None
    if not folder or not folder.is_dir():
        return []
    findings = []
    for ledger in sorted(folder.glob('*.jsonl')):
        for line in ledger.read_text(encoding='utf-8').splitlines():
            if line.strip():
                entry = json.loads(line)
                if entry.get('id') is not None:
                    findings.append(entry)
    return findings


def mine(repo, since, ledgers=LEDGERS, offline=False):
    slug = github_slug(repo)
    result = dict(repo=slug, since=since, fix_commits=fix_commits(repo, since),
                  review_findings=review_findings(slug, ledgers),
                  ci_failures=None, review_comments=None, errors=[])
    if not offline and slug:
        for name, fetch in (('ci_failures', ci_failures), ('review_comments', review_comments)):
            try:
                result[name] = fetch(slug, since)
            except (RuntimeError, OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
                result['errors'].append(f'{name}: {e}')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--repo', required=True, type=Path)
    parser.add_argument('--since', default=str(date.today() - timedelta(days=180)))
    parser.add_argument('--ledgers', default=str(LEDGERS))
    parser.add_argument('--offline', action='store_true', help='skip the GitHub API')
    a = parser.parse_args(argv)
    print(json.dumps(mine(a.repo, a.since, a.ledgers, a.offline), indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
