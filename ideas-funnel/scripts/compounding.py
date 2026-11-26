#!/usr/bin/env python3
"""Deterministic compounding & Refinery trigger analysis for an ideas-funnel vault."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from runtime import canonical

WIKILINK = re.compile(r'\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]')
FENCE_OPEN = re.compile(r'^[ ]{0,3}(`{3,}|~{3,})(.*)$')
FM_ORIGIN = re.compile(r'^(?:origin|url|source):[ \t]*(.*)$', re.M)
FM_DOMAIN = re.compile(r'^domain:[ \t]*(.*)$', re.M)
FM_PROMOTE = re.compile(r'^(?:promote|promotion):[ \t]*(.*)$', re.M)
HOST_IN_TEXT = re.compile(r'\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b', re.I)
UNKNOWN_ORIGIN = '__unknown__'


def _strip_inline_code_paragraph(para):
    out = []
    i, n = 0, len(para)
    while i < n:
        if para[i] == '`':
            j = i
            while j < n and para[j] == '`':
                j += 1
            run_len = j - i
            # Search for a closing run of exact length run_len
            k = j
            closed = -1
            while k < n:
                if para[k] == '`':
                    m = k
                    while m < n and para[m] == '`':
                        m += 1
                    if m - k == run_len:
                        closed = m
                        break
                    k = m
                else:
                    k += 1
            if closed != -1:
                i = closed
            else:
                out.append(para[i:j])
                i = j
        else:
            out.append(para[i])
            i += 1
    return ''.join(out)


def strip_code(text):
    # 1. Strip CommonMark fenced code blocks (matching char and >= opening length on closing line)
    kept_lines = []
    fence_char = None
    fence_len = 0
    for line in text.splitlines(keepends=True):
        if fence_char is None:
            m = FENCE_OPEN.match(line)
            if m:
                marker, info = m.group(1), m.group(2)
                # Backtick fence info strings cannot contain backticks
                if marker[0] == '~' or '`' not in info:
                    fence_char = marker[0]
                    fence_len = len(marker)
                    kept_lines.append('\n\n')
                    continue
            kept_lines.append(line)
        else:
            if re.match(rf'^[ ]{{0,3}}{re.escape(fence_char)}{{{fence_len},}}[ \t]*\r?\n?$', line):
                fence_char = None
                fence_len = 0
    un_fenced = ''.join(kept_lines)
    # 2. Strip exact-length inline backtick spans without crossing blank lines
    parts = re.split(r'(\r?\n[ \t]*\r?\n)', un_fenced)
    return ''.join(_strip_inline_code_paragraph(p) if idx % 2 == 0 else p for idx, p in enumerate(parts))


def split_frontmatter(text):
    if text.startswith('---\n'):
        end = text.find('\n---', 4)
        if end != -1:
            return text[4:end], text[end + 4:]
    return '', text


def extract_domains(fm):
    m = FM_DOMAIN.search(fm)
    if not m:
        return []
    raw = m.group(1).strip()
    if raw.startswith('[') and raw.endswith(']'):
        parts = [p.strip().strip('"\'') for p in raw[1:-1].split(',')]
        return [p for p in parts if p]
    if raw:
        return [raw.strip('"\'')]
    lines = fm[m.end():].splitlines()
    result = []
    for line in lines:
        if not line.strip():
            continue
        if re.match(r'^[ \t]*-[ \t]+', line):
            val = re.sub(r'^[ \t]*-[ \t]+', '', line).strip().strip('"\'')
            if val:
                result.append(val)
        else:
            break
    return result


def normalize_host(host):
    host = host.lower().strip('.')
    if host.startswith('www.'):
        host = host[4:]
    return host


def extract_origin_host(fm):
    m = FM_ORIGIN.search(fm)
    if not m:
        return UNKNOWN_ORIGIN
    raw = m.group(1).strip().strip('"\'')
    if not raw or raw.lower() in ('null', 'none', 'unknown', 'n/a'):
        return UNKNOWN_ORIGIN
    if raw.startswith(('http://', 'https://')):
        try:
            c = canonical(raw)
            host = urlsplit(c).hostname
            return normalize_host(host) if host else UNKNOWN_ORIGIN
        except ValueError:
            pass
    host_match = HOST_IN_TEXT.search(raw)
    if host_match:
        return normalize_host(host_match.group(0))
    return raw.lower()


def is_promotion_opted_out(page_path):
    if not page_path.is_file():
        return False
    fm, _ = split_frontmatter(page_path.read_text(errors='ignore'))
    m = FM_PROMOTE.search(fm)
    if not m:
        return False
    val = m.group(1).strip().strip('"\'').lower()
    return val in ('false', 'no', 'domain-only', 'never')


def extract_wikilinks(text):
    return [m.group(1).strip().removesuffix('.md') for m in WIKILINK.finditer(strip_code(text))]


def build_refinery_plan(promotions, bridges, sync_backlog, batch_size=5):
    """Allocate a mixed quota so promotions never starve bridges or shared sync."""
    if batch_size <= 0:
        return []
    plan = []
    queues = [
        ('promotion', list(promotions), 2),
        ('bridge', list(bridges), 2),
        ('shared_sync', list(sync_backlog), 2),
    ]
    # First pass: take up to per-category quota
    for kind, items, quota in queues:
        take = min(quota, len(items), batch_size - len(plan))
        for item in items[:take]:
            plan.append({'action': kind, 'target': item})
        del items[:take]
    # Second pass: backfill remaining slots (bridges -> shared_sync -> promotions)
    backfill_order = [queues[1], queues[2], queues[0]]
    while len(plan) < batch_size:
        added = False
        for kind, items, _ in backfill_order:
            if items and len(plan) < batch_size:
                plan.append({'action': kind, 'target': items.pop(0)})
                added = True
        if not added:
            break
    return plan


def analyze(vault, min_sync_sources=1, min_promotion_sources=3, min_bridge_score=0.3,
            top_n=15, max_sources_per_target=15, batch_size=5):
    vault = Path(vault)
    sources_dir = vault / 'Sources'
    concepts_dir = vault / 'Concepts'
    entities_dir = vault / 'Entities'
    bridges_dir = vault / 'Bridges'
    conflicts_dir = vault / 'Conflicts'
    domains_dir = vault / 'Domains'

    shared_pages = {}
    shared_concept_by_lower = {}
    existing_bridges_by_lower = {}
    for folder, kind in ((concepts_dir, 'concept'), (entities_dir, 'entity'), (bridges_dir, 'bridge')):
        if not folder.is_dir():
            continue
        for p in sorted(folder.glob('*.md')):
            if p.name.lower() == 'readme.md':
                continue
            rel = str(p.relative_to(vault)).removesuffix('.md')
            text = p.read_text(errors='ignore')
            linked_sources = {
                t for t in extract_wikilinks(text)
                if t.startswith('Sources/')
            }
            linked_source_stems = {t.split('/')[-1] for t in linked_sources}
            for t in extract_wikilinks(text):
                if '/' not in t and re.match(r'^\d{4}-\d{2}-\d{2}-', t):
                    linked_source_stems.add(t)
            shared_pages[rel] = {
                'path': str(p.relative_to(vault)),
                'kind': kind,
                'stem': p.stem,
                'linked_sources': linked_sources,
                'linked_source_stems': linked_source_stems,
            }
            if kind == 'concept':
                shared_concept_by_lower[p.stem.lower()] = rel
            elif kind == 'bridge':
                existing_bridges_by_lower[p.stem.lower()] = rel

    shared_by_stem = defaultdict(list)
    for rel, info in shared_pages.items():
        if info['kind'] in ('concept', 'entity'):
            shared_by_stem[info['stem']].append(rel)

    existing_bridges = set(existing_bridges_by_lower.keys())

    source_files = []
    if sources_dir.is_dir():
        source_files = sorted(
            p for p in sources_dir.glob('*.md')
            if p.name.lower() != 'readme.md' and not p.name.endswith('.timeline.md')
        )

    shared_incoming = defaultdict(set)
    concept_sources = defaultdict(dict)
    concept_domains = defaultdict(lambda: defaultdict(int))
    concept_domain_sources = defaultdict(set)
    concept_paths = defaultdict(set)

    for src in source_files:
        src_rel = str(src.relative_to(vault)).removesuffix('.md')
        src_stem = src.stem
        text = src.read_text(errors='ignore')
        fm, body = split_frontmatter(text)
        origin_host = extract_origin_host(fm)
        doms = extract_domains(fm)
        links = set(extract_wikilinks(body))

        for target in links:
            matched_shared = None
            if target in shared_pages:
                matched_shared = target
            elif '/' not in target and len(shared_by_stem.get(target, [])) == 1:
                matched_shared = shared_by_stem[target][0]

            if matched_shared:
                info = shared_pages[matched_shared]
                if src_rel not in info['linked_sources'] and src_stem not in info['linked_source_stems']:
                    shared_incoming[matched_shared].add(src_rel + '.md')
                if info['kind'] == 'concept':
                    stem = info['stem']
                    concept_paths[stem].add(matched_shared)
                    concept_domain_sources[stem].add(src_rel + '.md')
                    bridge_rel = existing_bridges_by_lower.get(stem.lower())
                    if bridge_rel:
                        b_info = shared_pages[bridge_rel]
                        if src_rel not in b_info['linked_sources'] and src_stem not in b_info['linked_source_stems']:
                            shared_incoming[bridge_rel].add(src_rel + '.md')
                    for d in doms:
                        concept_domains[stem][d] += 1
            elif target.startswith('Domains/') and '/Entities/' not in target and not target.endswith('/_landing'):
                stem = target.split('/')[-1]
                concept_sources[stem][src_rel + '.md'] = origin_host
                concept_paths[stem].add(target)
                concept_domain_sources[stem].add(src_rel + '.md')
                # If already promoted to Concepts/<stem>.md or bridged, keep unsynced Sources in shared sync queue
                for synced_rel in (shared_concept_by_lower.get(stem.lower()), existing_bridges_by_lower.get(stem.lower())):
                    if synced_rel:
                        info = shared_pages[synced_rel]
                        if src_rel not in info['linked_sources'] and src_stem not in info['linked_source_stems']:
                            shared_incoming[synced_rel].add(src_rel + '.md')
                parts = target.split('/')
                inferred = parts[1].lower() if len(parts) >= 3 else None
                for d in (doms or ([inferred] if inferred else [])):
                    concept_domains[stem][d] += 1

    # 1. Shared Concepts/Entities missing backlinks to citing Sources
    shared_sync_backlog = []
    for rel, missing in shared_incoming.items():
        info = shared_pages[rel]
        ordered = sorted(missing)
        batch = ordered if max_sources_per_target <= 0 else ordered[:max_sources_per_target]
        shared_sync_backlog.append({
            'page': info['path'],
            'kind': info['kind'],
            'unsynced_count': len(ordered),
            'unsynced_sources_batch': batch,
            'remaining_after_batch': max(0, len(ordered) - len(batch)),
        })
    shared_sync_backlog.sort(key=lambda x: (-x['unsynced_count'], x['page']))

    # 2. Promotion candidates: domain concepts with >= min_promotion_sources distinct origins not in Concepts/
    promotion_candidates = []
    for stem, src_map in concept_sources.items():
        if stem.lower() in shared_concept_by_lower:
            continue
        dom_pages = sorted(concept_paths[stem])
        if any(is_promotion_opted_out(vault / (dp + '.md')) for dp in dom_pages):
            continue
        distinct_origins = {host for host in src_map.values() if host}
        if len(src_map) >= min_promotion_sources and len(distinct_origins) >= min_promotion_sources:
            ordered = sorted(src_map.keys())
            batch = ordered if max_sources_per_target <= 0 else ordered[:max_sources_per_target]
            promotion_candidates.append({
                'concept': stem,
                'source_count': len(ordered),
                'unrelated_origin_count': len(distinct_origins),
                'domain_pages': dom_pages,
                'sources_batch': batch,
                'remaining_after_batch': max(0, len(ordered) - len(batch)),
            })
    promotion_candidates.sort(key=lambda x: (-x['unrelated_origin_count'], -x['source_count'], x['concept']))

    # 3. Bridge candidates: >= 2 backlinks from each of >= 2 distinct domains and bridge_score >= min_bridge_score
    bridge_candidates = []
    for stem, dom_counts in concept_domains.items():
        if stem.lower() in existing_bridges:
            continue
        qualifying = {d: c for d, c in dom_counts.items() if c >= 2}
        if len(qualifying) < 2:
            continue
        counts = list(qualifying.values())
        score = round(min(counts) / max(counts), 3)
        if score >= min_bridge_score:
            ordered = sorted(concept_domain_sources[stem])
            batch = ordered if max_sources_per_target <= 0 else ordered[:max_sources_per_target]
            bridge_candidates.append({
                'concept': stem,
                'bridge_score': score,
                'domains': dict(sorted(qualifying.items())),
                'moc_elevated': score >= 0.7,
                'source_count': len(ordered),
                'sources_batch': batch,
                'remaining_after_batch': max(0, len(ordered) - len(batch)),
            })
    bridge_candidates.sort(key=lambda x: (-x['bridge_score'], -sum(x['domains'].values()), x['concept']))

    domain_counts = {}
    if domains_dir.is_dir():
        for d in sorted(p for p in domains_dir.iterdir() if p.is_dir()):
            domain_counts[d.name] = sum(1 for p in d.rglob('*.md') if p.name.lower() != 'readme.md')

    conflicts_total = (
        sum(1 for p in conflicts_dir.glob('*.md') if p.name.lower() != 'readme.md')
        if conflicts_dir.is_dir() else 0
    )

    actionable_sync = [x for x in shared_sync_backlog if x['unsynced_count'] >= min_sync_sources]
    refinery_needed = bool(actionable_sync or promotion_candidates or bridge_candidates)
    refinery_plan = build_refinery_plan(promotion_candidates, bridge_candidates, actionable_sync, batch_size=batch_size)

    return {
        'summary': {
            'sources_total': len(source_files),
            'concepts_total': sum(1 for v in shared_pages.values() if v['kind'] == 'concept'),
            'entities_total': sum(1 for v in shared_pages.values() if v['kind'] == 'entity'),
            'bridges_total': len(existing_bridges),
            'conflicts_total': conflicts_total,
            'domain_pages': domain_counts,
            'shared_sync_backlog_count': len(actionable_sync),
            'promotion_candidate_count': len(promotion_candidates),
            'bridge_candidate_count': len(bridge_candidates),
            'refinery_needed': refinery_needed,
        },
        'refinery_plan': refinery_plan,
        'shared_sync_backlog': actionable_sync[:top_n],
        'promotion_candidates': promotion_candidates[:top_n],
        'bridge_candidates': bridge_candidates[:top_n],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault', type=Path, required=True)
    parser.add_argument('--min-sync-sources', type=int, default=1)
    parser.add_argument('--min-promotion-sources', type=int, default=3)
    parser.add_argument('--min-bridge-score', type=float, default=0.3)
    parser.add_argument('--top', type=int, default=15)
    parser.add_argument('--max-sources-per-target', type=int, default=15)
    parser.add_argument('--batch-size', type=int, default=5)
    args = parser.parse_args()
    if not args.vault.is_dir():
        parser.error('vault must exist')
    print(json.dumps(analyze(
        args.vault,
        min_sync_sources=args.min_sync_sources,
        min_promotion_sources=args.min_promotion_sources,
        min_bridge_score=args.min_bridge_score,
        top_n=args.top,
        max_sources_per_target=args.max_sources_per_target,
        batch_size=args.batch_size,
    ), indent=2))


if __name__ == '__main__':
    main()
