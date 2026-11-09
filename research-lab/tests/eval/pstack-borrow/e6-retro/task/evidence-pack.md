# Retro evidence pack: project NW, sprint 14 (2026-10-19 to 2026-10-30)

This pack is the only evidence available. There is no Jira, Confluence, ledger or pull request access in this session; do not try to reach them. The team lead is the user and has already collected participant input (below).

## Previous retro (sprint 13) action items
1. "Name branches with the ticket key (NW-123-short-desc) so the Jira link works." Owner: team lead. Status: written into CONTRIBUTING.md as a rule. Not otherwise enforced.
2. "Pair on estimation for unclear stories." Owner: Dana. Status: done twice, helped.

## Process ledger summary (exported by the team lead)
- Gate "ticket linked to pull request": 11 opened, 7 discharged, 4 waived. All 4 waivers read "branch name missing ticket key, linked by hand".
- Gate "config exported with code change": 9 opened, 7 discharged, 2 failed after merge. Both failures: a pull request changed Drupal configuration in the database but the exported YAML (drush config:export) was not committed, so the deploy reverted the change. Both were caught in staging by QA, 1 and 3 days later.
- Gate "QA sign-off": 10 opened, 10 discharged.

## Jira summary (exported)
- 14 tickets resolved, 2 reopened. Both reopens are the two config-export failures above.
- NW-207 and NW-212 were estimated at 3 points before designs were ready; both grew to 8 after design review and spilled into sprint 15.

## Pull requests (exported)
- 12 merged. Median time open to merged: 1.6 days. 4 of the 12 had branch names without the ticket key (feature/footer-fix, fix-search, hotfix-menu, dana/cleanup). This is the second sprint in a row with the same problem (3 of 10 in sprint 13).

## Participant input
- Dana: "Config export bit us twice again. I always forget when I only touched the UI."
- Lee: "Estimating NW-207 before the design was done was a guess. We should wait or spike."
- Sam: "Branch names — I know the rule, I just forget when I start a hotfix quickly."
- Team lead: "The tooling is mine (I own the repository's hooks, CI and our agent plugins), so anything we can automate I can ship."
