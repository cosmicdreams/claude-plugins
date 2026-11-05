# ideas-funnel

Version 3.0.0 moves collection and dispatch to T3 Code. Deterministic scripts collect feeds and maintain a canonical URL index; bounded read-only workers propose knowledge changes and one locked coordinator writes them in place in the live vault. Version 3.1.0 drops the vault worktree and merge step and refuses vaults inside a `main` reference checkout or a linked worktree. Ingest, Refinery and decay knowledge rules stay intact. Claude-host Workflow remains an explicitly manual fallback.

## Start safely

Install Python 3.10+ and the configuration parser with `python3 -m pip install -r requirements.txt` in your chosen virtual environment. Network collection uses the standard library. Both Claude and Codex manifests expose the same skills; resolve scripts relative to the installed skill, with no Codex dependency on `CLAUDE_PLUGIN_ROOT`.

Read [ONBOARDING](ONBOARDING.md) before migration or registration. `ideas-funnel:schedule` reconciles exact `[FUNNEL]` titles with T3, creating new tasks disabled only after authorization. Production creation, activation, manual production runs, service installation, plugin reinstallation, local skill retirement and notifications require separate explicit approval. No cron is registered by this release.

## Runtime

- `scripts/pull.py`: configured RSS/Atom and Hacker News Algolia endpoints, keyword filtering, bounded responses, two timed attempts, per-feed errors. RSS search feeds work; arbitrary web-search providers/authentication are unsupported and reported.
- `scripts/runtime.py`: conservative URL normalization, atomic JSON replacement and one nonblocking operating-system lock.
- `scripts/pipeline.py`: durable run owner with one-shot commands, file-keyed collected → processing → ingested/failed transitions, preserved legacy manifest, explicit interrupted-run recovery without automatic ownership expiry.
- `scripts/health.py`: read-only backlog, stale items, URL conflicts/run failures and allowance freshness. Every model stage rechecks actual allowance; unknown/stale readings or any window below 20% skip work.
- `ideas-funnel:dispatch`: two domains × at most 12 items, one read-only delegate at a time, sole coordinator writes, conditional Refinery, weekly lint/decay/rescue and a five-line desk report. Shaping remains gated on a separate design.
- Optional Jev ranking remains an ingest aid with its existing fallback and external cost; pulls never call it.

Migration retains `Raw/.manifest.json` unchanged and indexes inbox, archived raw and Sources. Known tracking keys/fragments are removed; meaningful query parameters remain. No redirect aliases or semantic equivalence are guessed. Ambiguous Source matches are flagged. All scheduled and manual writers must hold durable ownership, with short locks serializing state transitions; this is advisory, not protection against unrelated tools ignoring the contract. Partial page writes are reconciled by canonical origin before retry, not transactionally rolled back.

## Verification

Run `<configured-venv-python> -m unittest discover -s ideas-funnel/tests -v` from the repository root. Fixtures include 118 real Simon Willison raw-record identities from the vault regression case; tests do not fetch live feeds or modify the vault.

The immediate T3 probe confirmed inherited Codex gpt-6-luna medium, search, delegation completion and idle launch. Mark-unread failed in one observed condition; notification tooling was absent. Use a clear decision marker in the desk and leave notifications off. Window-closed/app-quit operation and seven daily runs remain unverified release-validation work, not implementation claims. Do not ask the user to quit the app to complete implementation.
