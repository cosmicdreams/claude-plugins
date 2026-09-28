"""Thin public-page input shared by deterministic published-site extractors."""

import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from find_rendered_components import ALIASES_SQL, fetch_page, public_paths
from extract_canvas_usage import sqlq_rows


def site_config(project):
    manifest = json.loads((Path(project) / "project.json").read_text(encoding="utf-8"))
    root = Path(manifest["repository"]["root"]).resolve()
    config = next(iter(sorted(root.glob("config/*/system.site.yml"))), None)
    name, front = root.name, "/"
    if config:
        content = config.read_text(encoding="utf-8")
        match = re.search(r"^name:\s*(.+?)\s*$", content, re.M)
        if match:
            name = match.group(1).strip().strip("'\"").replace("''", "'")
        match = re.search(r"^\s*front:\s*(.+?)\s*$", content, re.M)
        if match:
            front = match.group(1).strip().strip("'\"")
    return root, name, front


def addresses(root, front="/", limit=400):
    """Include the homepage and reuse the scanner's bounded, sorted alias selection."""
    rows = sorted(sqlq_rows(Path(root), ALIASES_SQL, 2))
    if limit < 1:
        raise ValueError("page limit must be positive")
    aliases = {}
    for source, alias in rows:
        aliases.setdefault(source, alias)
    priority = ["/"]
    if front in aliases and aliases[front] not in priority:
        priority.append(aliases[front])
    selected = priority[:limit]
    for path in public_paths(rows, limit):
        if path not in selected and len(selected) < limit:
            selected.append(path)
    return sorted(selected)


def fetch_pages(base_url, paths):
    """Fetch every address once, then drop aliases: two addresses serving the same page
    (the front page at `/` and at `/home`) count once, under the shortest address."""
    with ThreadPoolExecutor(max_workers=8) as executor:
        fetched = list(executor.map(lambda path: fetch_page(base_url, path), sorted(set(paths))))
    seen, unique = set(), []
    for path, status, html in sorted(fetched, key=lambda r: (len(r[0]), r[0])):
        key = hashlib.sha256(_main(html).encode()).hexdigest() if status == 200 and html else None
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        unique.append((path, status, html))
    return sorted(unique, key=lambda r: r[0])


def _main(html):
    """The page body without the parts that differ per address (canonical links, active menu
    classes, form tokens), for recognising the same page under two addresses."""
    m = re.search(r"<main\b.*?</main>", html, re.S | re.I)
    body = m.group(0) if m else html
    return re.sub(r'\s(class|id|value|data-[\w-]+)="[^"]*"', "", body)
