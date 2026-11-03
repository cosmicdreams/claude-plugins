# Simon Willison regression identities

`simon-118.json` contains identity fields from 118 real raw records in the Neurons vault, captured read-only on 2026-11-02. Public source URLs and raw-relative paths only; bodies and operator notes are excluded. The 2026-10-23 rescue entry in `log.md` reported 118 stale Simon Willison stubs. These are extant records selected from the current inbox then archive, not a claim that every file is the exact historical 118 (that historical membership was not recorded).

The regression rebuilds raw fixtures, migrates them, then pulls feed-style variants (host case, default HTTPS port, tracking query and `#atom-everything` fragment) twice with zero new files. It tests canonical URL repeat collection, not semantic duplicate detection or live network delivery.
