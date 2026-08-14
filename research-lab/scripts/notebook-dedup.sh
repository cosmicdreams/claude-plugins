#!/usr/bin/env bash
# De-duplicate NotebookLM sources.
#
# WHY DUPLICATES HAPPEN (root cause — observed every engagement):
#   1. Seed URLs you add up front are RE-DISCOVERED by the deep-research pass and
#      imported a second time, because the research import does not check whether
#      a URL is already in the notebook.
#   2. The research pass returns the SAME page under several result URLs — trailing
#      slash, "#fragment", "?query" variants — which arrive as distinct sources.
# So dedup is not optional cleanup; it is a required step after every import.
#
# This collapses by normalized URL (scheme+host+path, minus fragment/query and
# trailing slash) and falls back to title for sources with no URL, keeping the
# first occurrence of each.
#
# ALSO REPORTS FAILED SOURCES. A URL that NotebookLM cannot fetch still leaves a
# stub source behind — `nlm source add` exits 1 with {"status":"error"} but the
# notebook keeps a record whose title is the raw URL. Observed with nps.gov.
# Those stubs carry no text, so they silently dilute later synthesis queries.
# They are REPORTED, never auto-removed: the status codes are read off observed
# behaviour (2 = ready, 3 = failed), not documented, so deleting on that
# inference would be the kind of guess that eats a good source. Pass
# --prune-failed to act on the report.
#
# Usage: notebook-dedup.sh NOTEBOOK_ID [--apply] [--prune-failed]
#        (default: dry-run, prints plan)
set -uo pipefail
NB="${1:?Usage: notebook-dedup.sh NOTEBOOK_ID [--apply] [--prune-failed]}"
shift
MODE=""
PRUNE_FAILED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply)        MODE="--apply"; shift ;;
    --prune-failed) PRUNE_FAILED=1; shift ;;
    *) >&2 echo "Unknown arg: $1"; exit 1 ;;
  esac
done

NB="$NB" APPLY="$([ "$MODE" = "--apply" ] && echo 1 || echo 0)" PRUNE="$PRUNE_FAILED" python3 - <<'PY'
import json, os, re, subprocess
NB=os.environ["NB"]; APPLY=os.environ["APPLY"]=="1"; PRUNE=os.environ["PRUNE"]=="1"

def sh(*a): return subprocess.run(a, capture_output=True, text=True)

# `nlm` is noun-first and takes the notebook id POSITIONALLY (the retired
# `notebooklm` CLI used `-n <id>`).
raw=sh("nlm","source","list",NB,"--json").stdout
try:
    d=json.loads(raw)
except Exception as e:
    print(f"could not read sources: {e}"); raise SystemExit(1)

# Locate the source list. Never fall back to the dict itself — iterating a dict
# yields its string keys and `x.get(...)` below would raise AttributeError.
if isinstance(d, list):
    s=d
elif isinstance(d, dict):
    s=d.get("sources") or d.get("data") or d.get("notebook",{}).get("sources")
else:
    s=None
if not isinstance(s, list):
    keys = list(d)[:8] if isinstance(d, dict) else type(d).__name__
    print(f"could not read sources: unexpected JSON shape ({keys})"); raise SystemExit(1)

def norm(u):
    if not u: return ""
    u=u.strip().lower(); u=re.split(r"[#?]",u)[0]
    return u.rstrip("/")

seen={}; dels=[]
for x in s:
    sid=x.get("id"); url=x.get("url") or ""; title=(x.get("title") or "").strip()
    key=norm(url) if url else "t::"+title.lower()
    if key in seen: dels.append((sid, title[:60], url[:60]))
    else: seen[key]=sid

print(f"total={len(s)} unique={len(seen)} duplicates={len(dels)}")
for sid,t,u in dels:
    print(f"  DUP {sid}  {t}  ::  {u}")

dup_ids={sid for sid,_,_ in dels}
# status 3 == ingestion failed (observed, not documented). Skip anything already
# queued for removal as a duplicate so nothing is deleted twice.
failed=[(x.get("id"), (x.get("title") or "")[:60])
        for x in s
        if x.get("status")==3 and x.get("id") not in dup_ids]

if failed:
    print(f"failed-ingest sources={len(failed)} (empty stubs — no text to synthesize from)")
    for sid,t in failed:
        print(f"  FAILED {sid}  {t}")
    if not PRUNE:
        print("  (re-run with --prune-failed --apply to remove these)")

removals = list(dels) + ([(sid, t, "") for sid, t in failed] if PRUNE else [])

if APPLY and removals:
    # Deletion is now `--confirm` (was `--yes`) and no longer needs the notebook id.
    for sid,_,_ in removals:
        r=sh("nlm","source","delete",sid,"--confirm")
        print(("  removed " if r.returncode==0 else "  FAILED  ")+sid)
    print(f"-> {len(s)-len(removals)} sources remain")
elif not APPLY and removals:
    print("(dry-run — re-run with --apply to remove)")
PY
