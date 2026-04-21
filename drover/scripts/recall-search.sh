#!/usr/bin/env bash
# recall-search.sh — ranked search over drover tickets with verified solutions.
#
# Usage:
#   recall-search.sh [--include-projected] [--top N] "<keyword query>"
#   recall-search.sh --fingerprint <fp>
#
# Walks each project registered in projects.json, reads its drover board
# (.beads/drover.db in the project path, or a per-project fixtures dir
# when DROVER_RECALL_FIXTURES is set — used by tests), and scans ticket
# bodies for Actual solution blocks matching the query.
#
# Ranking (highest → lowest):
#   1. Exact fingerprint match (when --fingerprint is used)
#   2. Verified Actual with query hit in root_cause / fix_summary / fingerprint line
#   3. (only with --include-projected) Projected block hit, marked "unverified"
#
# Output (one hit per block):
#   {rank_label}  {ticket_id}  [{project}]  fp:{fp}
#     root_cause: {first 120 chars}
#     fix_summary: {first 120 chars}
#
# Environment overrides (tests):
#   DROVER_PROJECTS_FILE    path to projects.json
#   DROVER_RECALL_FIXTURES  when set, read ticket bodies from
#                           $DROVER_RECALL_FIXTURES/<project>/<ticket>.md
#                           instead of shelling out to `bd`. Used by bats.

set -uo pipefail

usage() {
  cat >&2 <<'EOF'
usage: recall-search.sh [--include-projected] [--top N] "<query>"
       recall-search.sh --fingerprint <fp>
EOF
  exit 2
}

INCLUDE_PROJECTED=0
TOP=5
MODE=keyword
QUERY=""
FINGERPRINT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --include-projected) INCLUDE_PROJECTED=1; shift ;;
    --top) TOP="$2"; shift 2 ;;
    --fingerprint) MODE=fingerprint; FINGERPRINT="$2"; shift 2 ;;
    -h|--help) usage ;;
    --) shift; break ;;
    -*) echo "unknown flag: $1" >&2; usage ;;
    *) QUERY="$1"; shift ;;
  esac
done

if [ "$MODE" = "keyword" ] && [ -z "$QUERY" ]; then
  usage
fi

PROJECTS_FILE="${DROVER_PROJECTS_FILE:-${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugins/data/drover-fallback}/projects.json}"
FIXTURES="${DROVER_RECALL_FIXTURES:-}"

if [ ! -f "$PROJECTS_FILE" ]; then
  echo "no results (no projects registered)"
  exit 0
fi

# Extract the list of project names we'll scan.
PROJECTS=$(python3 -c "
import json, sys
try:
    data = json.load(open('$PROJECTS_FILE'))
    for p in data:
        n = p.get('name') or p.get('ddev_project')
        if n: print(n)
except Exception:
    pass
")

if [ -z "$PROJECTS" ]; then
  echo "no results (no projects registered)"
  exit 0
fi

# Collect ticket bodies as "{project}\t{ticket_id}\t{body}" rows (body
# escaped to a single line via \x01 replacement for newlines, since we
# reconstruct in the ranker below).
TMP_ROWS="$(mktemp -t drover-recall-rows.XXXXXX)"
ROWS="$TMP_ROWS"
trap 'rm -f "$TMP_ROWS"' EXIT
: > "$ROWS"

while IFS= read -r project; do
  [ -z "$project" ] && continue

  if [ -n "$FIXTURES" ] && [ -d "$FIXTURES/$project" ]; then
    # Test mode: read each ticket body from a fixture file.
    for f in "$FIXTURES/$project"/drover-*.md; do
      [ -f "$f" ] || continue
      ticket="$(basename "$f" .md)"
      body="$(cat "$f" | tr '\n' $'\x01')"
      printf '%s\t%s\t%s\n' "$project" "$ticket" "$body" >> "$ROWS"
    done
  else
    # Production mode: use bd to list closed drover tickets with bodies.
    # (Deferred — would shell out to `bd list --status closed --format json`
    # against the project's .beads/drover.db. Stubbed for the demo.)
    :
  fi
done <<< "$PROJECTS"

# Rank and filter.
python3 - "$MODE" "$QUERY" "$FINGERPRINT" "$INCLUDE_PROJECTED" "$TOP" "$ROWS" <<'PY'
import re, sys

mode, query, fingerprint, include_projected, top, rows_file = sys.argv[1:7]
include_projected = int(include_projected)
top = int(top)
query_lower = query.lower()

FP_RE = re.compile(r"fingerprint\s*[:=]\s*([0-9a-f]{6,16})", re.I)
ACTUAL_RE = re.compile(r"###\s*Actual\b", re.I)
PROJECTED_RE = re.compile(r"###\s*Projected\b", re.I)
ROOT_RE = re.compile(r"\*\*root_cause:\*\*\s*(.+)", re.I)
FIX_RE = re.compile(r"\*\*fix_summary:\*\*\s*(.+)", re.I)
HYP_RE = re.compile(r"\*\*hypothesis:\*\*\s*(.+)", re.I)
PROPOSED_RE = re.compile(r"\*\*proposed_fix:\*\*\s*(.+)", re.I)

def extract_block(body, start_re, end_re=None):
    m = start_re.search(body)
    if not m:
        return ""
    rest = body[m.end():]
    if end_re:
        e = end_re.search(rest)
        if e:
            rest = rest[:e.start()]
    return rest

def score(body, fp):
    # Returns (rank_tier, score, kind_label)
    # rank_tier: 0 = exact fingerprint (best); 1 = verified actual; 2 = projected
    if mode == "fingerprint" and fingerprint and fp == fingerprint.lower():
        return (0, 100, "fp-exact")
    actual = extract_block(body, ACTUAL_RE)
    projected = extract_block(body, PROJECTED_RE, end_re=ACTUAL_RE)
    if actual and query_lower:
        hay = actual.lower()
        hits = hay.count(query_lower)
        if hits > 0:
            return (1, 10 + hits, "verified")
    if include_projected and projected and query_lower:
        hay = projected.lower()
        hits = hay.count(query_lower)
        if hits > 0:
            return (2, 1 + hits, "unverified")
    # Fingerprint-mode secondary: even without keyword, surface exact fp.
    if mode == "fingerprint" and fingerprint and fp == fingerprint.lower():
        return (0, 100, "fp-exact")
    return None

results = []
try:
    with open(rows_file) as fh:
        for line in fh:
            project, ticket, body = line.rstrip("\n").split("\t", 2)
            body = body.replace("\x01", "\n")
            fp_match = FP_RE.search(body)
            fp = fp_match.group(1).lower() if fp_match else ""
            scored = score(body, fp)
            if not scored:
                continue
            tier, s, label = scored
            root = ""
            fix = ""
            if label in ("verified", "fp-exact"):
                actual = extract_block(body, ACTUAL_RE)
                rm = ROOT_RE.search(actual)
                fm = FIX_RE.search(actual)
                root = (rm.group(1) if rm else "").strip()
                fix = (fm.group(1) if fm else "").strip()
            else:
                projected = extract_block(body, PROJECTED_RE, end_re=ACTUAL_RE)
                hm = HYP_RE.search(projected)
                pm = PROPOSED_RE.search(projected)
                root = (hm.group(1) if hm else "").strip()
                fix = (pm.group(1) if pm else "").strip()
            results.append((tier, -s, project, ticket, fp, label, root[:120], fix[:120]))
except FileNotFoundError:
    pass

results.sort()
results = results[:top]

if not results:
    print("no results")
    sys.exit(0)

for (_, _, project, ticket, fp, label, root, fix) in results:
    tag = "[verified]" if label in ("verified", "fp-exact") else "[unverified]"
    print(f"{tag}  {ticket}  [{project}]  fp:{fp}")
    if root:
        print(f"  root_cause: {root}")
    if fix:
        print(f"  fix_summary: {fix}")
PY
