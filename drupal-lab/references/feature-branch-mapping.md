# Mapping JIRA tickets to feature branches

The Drupal-team workflow assumes feature work lives in `features/*` branches
named after the JIRA ticket they implement. This file documents the resolution
order that `release-cut` and `branch-audit` use to find the branch for a ticket.

## Branch naming convention

Preferred form: `features/<KEY>` (e.g. `features/PROJ-1234`).

Acceptable variants the skills will still recognise:
- `features/<key-lowercase>` — `features/proj-1234`
- `features/<KEY>-<short-description>` — `features/PROJ-1234-checkout-button`
- `features/<KEY>_<description>` — `features/PROJ-1234_checkout_button`

## Resolution order (ticket → branch)

For a given ticket key `KEY`, the skills try in order:

1. **Exact match**: `features/<KEY>`
2. **Case-folded match**: `features/<lowercase(KEY)>`
3. **Prefix match (uppercase)**: `features/<KEY>-*` or `features/<KEY>_*`
   — if exactly one branch matches, use it.
4. **Token match**: any `features/*` branch where `KEY` appears as a
   `[^A-Za-z0-9]`-delimited token.

If step 3 or 4 returns multiple candidates, the skill asks the user to pick.
If no candidate matches, the ticket is recorded as "no matching feature branch".

## Recovery (branch → ticket key)

For a merged branch name (audit direction), the skills extract the first
substring matching `[A-Z][A-Z0-9]+-[0-9]+` from the branch name after the
`features/` prefix. If none is found, the branch is recorded as `(unkeyed)`.

Examples:
| Branch                              | Recovered key |
|-------------------------------------|---------------|
| `features/PROJ-1234`                | `PROJ-1234`   |
| `features/PROJ-1234-checkout`       | `PROJ-1234`   |
| `features/proj-1234`                | `(unkeyed)`*  |
| `features/hotfix-css`               | `(unkeyed)`   |

\* The strict uppercase pattern guarantees we don't false-positive on
prose-style branch names; lowercase ticket keys lose the round-trip and
should be discouraged.

## Convention enforcement

This skill set does not enforce naming on branch creation — branches are
created by developers manually or via worktree skills. The audit report
surfaces convention drift (unkeyed merges, direct commits) so PMs can
spot communication gaps early.
