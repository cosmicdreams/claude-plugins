# Candidate gates

Offered when a project writes or revises its process page. None is imposed; a project adopts one by putting it in its table. They come from what the retired sprint plugin enforced on agent teams, restated as steps any team can own.

| Gate | Detected by | Obligations |
| --- | --- | --- |
| Cause found | declared | Root cause written on the ticket before implementation starts |
| Failing test first | tests-passed | A test that failed before the fix and passes after it is named on the ticket |
| Independent review | pull-request-opened | Someone other than the author, or `process-lab:process-auditor` for agent work, reviewed the change against the ticket |
| Repeated failure | declared | After three failed attempts at the same fix, stop and escalate with what was tried |
| Evidence behind findings | declared | Review findings cite file and line or command output |

A candidate gate earns its place with evidence: run it in `observe` mode and look at the ledger in `process-lab:retro` before anyone argues for enforcing it.
