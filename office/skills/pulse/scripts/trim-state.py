#!/usr/bin/env python3
"""Trim office-pulse state file to the last 7 days of entries."""
import json
import os
from datetime import datetime, timedelta

cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()[:10]
path = os.path.expanduser("~/.claude/office-pulse.state.jsonl")

if not os.path.exists(path):
    raise SystemExit(0)

lines = open(path).readlines()
kept = [l for l in lines if json.loads(l).get("ts", "") >= cutoff]
open(path, "w").writelines(kept)
