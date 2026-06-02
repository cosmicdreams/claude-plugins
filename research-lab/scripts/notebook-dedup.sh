#!/usr/bin/env bash
# De-duplicate NotebookLM sources.
#
# WHY DUPLICATES HAPPEN (root cause — observed every engagement):
#   1. Seed URLs you add up front are RE-DISCOVERED by the deep-research pass and
#      imported a second time, because `--import-all` does not check whether a URL
#      is already in the notebook.
#   2. The research pass returns the SAME page under several result URLs — trailing
#      slash, "#fragment", "?query" variants — which arrive as distinct sources.
# So dedup is not optional cleanup; it is a required step after every import.
#
# This collapses by normalized URL (scheme+host+path, minus fragment/query and
# trailing slash) and falls back to title for sources with no URL, keeping the
# first occurrence of each.
#
# Usage: notebook-dedup.sh NOTEBOOK_ID [--apply]   (default: dry-run, prints plan)
set -uo pipefail
NB="${1:?Usage: notebook-dedup.sh NOTEBOOK_ID [--apply]}"
MODE="${2:-}"

NB="$NB" APPLY="$([ "$MODE" = "--apply" ] && echo 1 || echo 0)" python3 - <<'PY'
import json, os, re, subprocess
NB=os.environ["NB"]; APPLY=os.environ["APPLY"]=="1"

def sh(*a): return subprocess.run(a, capture_output=True, text=True)

raw=sh("notebooklm","source","list","-n",NB,"--json").stdout
try:
    d=json.loads(raw); s=d if isinstance(d,list) else d.get("sources",d)
except Exception as e:
    print(f"could not read sources: {e}"); raise SystemExit(1)

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

if APPLY and dels:
    for sid,_,_ in dels:
        r=sh("notebooklm","source","delete",sid,"-n",NB,"--yes")
        print(("  removed " if r.returncode==0 else "  FAILED  ")+sid)
    print(f"-> {len(s)-len(dels)} sources remain")
elif not APPLY and dels:
    print("(dry-run — re-run with --apply to remove)")
PY
