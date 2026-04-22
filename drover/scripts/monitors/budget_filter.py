#!/usr/bin/env python3
"""drover umbrella notification budget filter (sprint-89h).

Sits at the tail of umbrella-watch.sh's stdout pipeline to prevent a deploy
burst of N unique errors from producing N per-event harness/Slack
notifications in under a minute. NEW events are rate-limited over a
sliding time window; everything else (THRESH, TRAFFIC, ddev-status lines,
non-event noise) passes through untouched.

When NEW events exceed the window budget, they are dropped from stdout and
a summary line ("[drover] 12 NEW events suppressed over last 5m") is
emitted periodically so the user knows suppression is happening.
"""
from __future__ import annotations
import argparse
import os
import re
import sys
import time
from collections import deque

# "[watcher-key] NEW <fp> <severity> <source> <env> <msg>"
_NEW_PATTERN = re.compile(r"^\[[^\]]+\]\s+NEW\s+")
# Capture fp and env from the same shape for cross-env dedup.
_NEW_PARSE = re.compile(r"^\[[^\]]+\]\s+NEW\s+(\S+)\s+\S+\s+\S+\s+(\S+)\s+")


class CrossEnvDedup:
    """Sliding-window dedup for the same fingerprint across different envs.

    sprint-ie4: the same fingerprint hitting local + staging + prod within a
    short window previously produced 3 separate NEW notifications. This filter
    lets the FIRST environment through, suppresses subsequent
    different-env sightings within `window_seconds`, and accumulates a
    multi-env summary line that the caller emits periodically
    ("[drover] multi-env fp abc123: local,stg,prod"). Same-env repeats are
    NOT suppressed here — that's the job of BudgetFilter / per-fp THRESH.
    """

    def __init__(self, window_seconds=60, now_fn=None):
        self.window = float(window_seconds)
        self._now = now_fn or time.monotonic
        # fp -> {"ts": float, "first_env": str, "envs": list[str]}
        self._state = {}

    def _prune(self, now):
        cutoff = now - self.window
        dead = [fp for fp, s in self._state.items() if s["ts"] < cutoff]
        for fp in dead:
            del self._state[fp]

    def handle(self, line):
        m = _NEW_PARSE.match(line or "")
        if not m:
            return line
        fp, env = m.group(1), m.group(2)
        now = self._now()
        self._prune(now)
        s = self._state.get(fp)
        if s is None:
            self._state[fp] = {"ts": now, "first_env": env, "envs": [env], "summary_emitted": False}
            return line
        # Refresh TTL so a steadily-flapping fp stays deduped.
        s["ts"] = now
        if env == s["first_env"]:
            # Same env — let BudgetFilter / THRESH handle it.
            return line
        if env not in s["envs"]:
            s["envs"].append(env)
        return None  # suppressed

    def flush_multi_env_summaries(self):
        out = []
        for fp, s in self._state.items():
            if len(s["envs"]) > 1 and not s.get("summary_emitted"):
                envs = ",".join(s["envs"])
                out.append(f"[drover] multi-env fp {fp}: {envs}")
                s["summary_emitted"] = True
        return out


class BudgetFilter:
    """Rolling-window NEW-event budget.

    handle(line) returns the line to emit, or None to drop it.
    suppressed_since_summary() reports drops since the last summary.
    flush_summary() returns a summary line when suppression has occurred
    and enough drops have accumulated (every `summary_every`), else None.
    """

    def __init__(self, max_events=10, window_seconds=300, summary_every=5, now_fn=None):
        self.max = int(max_events)
        self.window = float(window_seconds)
        self.summary_every = int(summary_every)
        self._now = now_fn or time.monotonic
        self._events = deque()  # timestamps of admitted NEW events
        self._suppressed = 0

    def _prune(self, now):
        cutoff = now - self.window
        while self._events and self._events[0] < cutoff:
            self._events.popleft()

    def handle(self, line):
        if not _NEW_PATTERN.match(line or ""):
            return line
        now = self._now()
        self._prune(now)
        if len(self._events) < self.max:
            self._events.append(now)
            return line
        self._suppressed += 1
        return None

    def suppressed_since_summary(self):
        return self._suppressed

    def flush_summary(self):
        if self._suppressed == 0:
            return None
        if self._suppressed < self.summary_every:
            return None
        count = self._suppressed
        self._suppressed = 0
        return f"[drover] {count} NEW events suppressed (budget {self.max}/{int(self.window)}s)"


def _env_int(name, default):
    val = os.environ.get(name)
    try:
        return int(val) if val else default
    except ValueError:
        return default


def main():
    parser = argparse.ArgumentParser(description="drover umbrella NEW-event budget + cross-env dedup filter")
    parser.add_argument("--max", type=int, default=_env_int("DROVER_NOTIFY_MAX", 10))
    parser.add_argument("--window", type=int, default=_env_int("DROVER_NOTIFY_WINDOW", 300))
    parser.add_argument("--summary-every", type=int, default=_env_int("DROVER_NOTIFY_SUMMARY_EVERY", 5))
    parser.add_argument("--dedup-window", type=int, default=_env_int("DROVER_DEDUP_WINDOW", 60))
    args = parser.parse_args()

    budget = BudgetFilter(max_events=args.max, window_seconds=args.window, summary_every=args.summary_every)
    dedup = CrossEnvDedup(window_seconds=args.dedup_window) if args.dedup_window > 0 else None

    try:
        for line in sys.stdin:
            line = line.rstrip("\n")
            # Dedup runs first so a fp hitting local+stg+prod only costs one
            # budget slot — the follow-ups get collapsed into a summary line.
            if dedup is not None:
                line = dedup.handle(line)
                if line is None:
                    # Still want to emit any pending multi-env summaries.
                    for s in dedup.flush_multi_env_summaries():
                        print(s, flush=True)
                    continue
            out = budget.handle(line)
            if out is not None:
                print(out, flush=True)
            if dedup is not None:
                for s in dedup.flush_multi_env_summaries():
                    print(s, flush=True)
            bsum = budget.flush_summary()
            if bsum:
                print(bsum, flush=True)
    except (KeyboardInterrupt, BrokenPipeError):
        pass


if __name__ == "__main__":
    main()
