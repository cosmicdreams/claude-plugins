#!/usr/bin/env python3
"""Group crawled pages by template and pick one representative page per template.

The Playwright checks are slow, so they run on one page per template rather than on every
page. The template key comes from Drupal's body classes when the crawl extracted them
(page-node-type-*, path-frontpage, path-taxonomy, path-user, page-view-*). Otherwise it
falls back to the first path segment and the path depth.

Usage: templates.py <frog_export_dir> <out pages.json> [--max N]
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import frog_inputs  # noqa: E402

DRUPAL = [
    (r"\bpath-frontpage\b", lambda m: "front"),
    (r"\bpage-node-type-([\w-]+)", lambda m: f"node:{m[1]}"),
    (r"\bnode--type-([\w-]+)", lambda m: f"node:{m[1]}"),
    (r"\bpage-view-([\w-]+)", lambda m: f"view:{m[1]}"),
    (r"\bpath-taxonomy\b", lambda m: "taxonomy"),
    (r"\bpath-user\b", lambda m: "user"),
]


def template_key(page):
    for pattern, name in DRUPAL:
        m = re.search(pattern, page.get("body_class") or "")
        if m:
            return name(m)
    path = urlsplit(page["url"]).path.strip("/")
    if not path:
        return "front"
    parts = path.split("/")
    return f"path:/{parts[0]}" + (f" (depth {len(parts)})" if len(parts) > 1 else "")


def choose(pages, limit):
    groups = defaultdict(list)
    for p in pages.values():
        groups[template_key(p)].append(p)
    ordered = sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    chosen, skipped = ordered[:limit], ordered[limit:]
    reps = []
    for key, members in chosen:
        best = min(members, key=lambda p: (p["depth"], len(p["url"]), p["url"]))
        reps.append({"path": urlsplit(best["url"]).path or "/", "url": best["url"], "template": key,
                     "count": len(members)})
    return reps, [{"template": k, "count": len(v)} for k, v in skipped]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("frog_dir")
    ap.add_argument("out")
    ap.add_argument("--max", type=int, default=25, help="most templates to sample (largest first)")
    a = ap.parse_args(argv)
    data = frog_inputs.load(a.frog_dir)
    reps, skipped = choose(data["pages"], a.max)
    origins = {f"{urlsplit(u).scheme}://{urlsplit(u).netloc}" for u in data["pages"]}
    if len(origins) != 1:
        sys.exit(f"Crawl spans more than one origin: {sorted(origins)}")
    doc = {"origin": origins.pop(), "pages": reps, "templates_not_sampled": skipped,
           "pages_crawled": len(data["pages"]),
           "pages_covered_by_sampled_templates": sum(r["count"] for r in reps)}
    Path(a.out).write_text(json.dumps(doc, indent=1))
    print(f"{len(reps)} templates sampled covering {doc['pages_covered_by_sampled_templates']} of "
          f"{doc['pages_crawled']} pages; {len(skipped)} templates not sampled -> {a.out}")


if __name__ == "__main__":
    main()
