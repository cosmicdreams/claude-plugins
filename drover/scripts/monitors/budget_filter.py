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
    parser = argparse.ArgumentParser(description="drover umbrella NEW-event budget filter")
    parser.add_argument("--max", type=int, default=_env_int("DROVER_NOTIFY_MAX", 10))
    parser.add_argument("--window", type=int, default=_env_int("DROVER_NOTIFY_WINDOW", 300))
    parser.add_argument("--summary-every", type=int, default=_env_int("DROVER_NOTIFY_SUMMARY_EVERY", 5))
    args = parser.parse_args()

    f = BudgetFilter(max_events=args.max, window_seconds=args.window, summary_every=args.summary_every)
    try:
        for line in sys.stdin:
            line = line.rstrip("\n")
            out = f.handle(line)
            if out is not None:
                print(out, flush=True)
            # Opportunistically emit a summary after a drop batch.
            summary = f.flush_summary()
            if summary:
                print(summary, flush=True)
    except (KeyboardInterrupt, BrokenPipeError):
        pass


if __name__ == "__main__":
    main()
