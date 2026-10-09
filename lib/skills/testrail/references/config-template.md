# lib:testrail Configuration Template

Create `~/.claude/office-testrail.local.md`. This user-level file contains references and settings, never passwords or API keys.

```markdown
---
host: yourinstance.testrail.com
op_item: op://Employee/<26-character-item-id>
default_project_id: 1
---
```

## Two accounts

Use item IDs because duplicate item titles are ambiguous. Both username and password come from the selected item:

```markdown
---
host: yourinstance.testrail.com
op_item_default: op://Employee/<own-login-item-id>
op_item_shared: op://Employee/<shared-login-item-id>
---
```

`op_item_default` takes precedence over the single-account alias `op_item`. `--account shared` selects `op_item_shared`; any other account suffix uses `op_item_<suffix>`. A named account never falls back to another account.

| Field | Required | Description |
|---|---|---|
| `host` | for 1Password/Keychain | Instance hostname or HTTPS instance URL; `TESTRAIL_URL` can supply the 1Password host if omitted |
| `op_item` / `op_item_default` | for default 1Password account | `op://<vault>/<item-id>` without a field suffix |
| `op_item_shared` | for shared account | Separate vault/item ID reference |
| `username` | for Keychain only | Login email, not a short username |
| `default_project_id` | no | Default ID for the caller's project-scoped operations |

## Credential sources

1Password is first when an item reference is configured. Use an existing Login item with `username` (email) and `password` (password or API key) fields. Copy its item ID from 1Password; do not use its title. Unlock/sign in interactively before invoking the helper. Each read times out after 15 seconds; errors stop instead of switching accounts.

Without a configured item, the helper uses QA-AI's environment variables together: `TESTRAIL_URL`, `TESTRAIL_USERNAME` (email), and `TESTRAIL_API_KEY`. `TESTRAIL_URL` accepts the HTTPS instance URL or full `.../index.php?/api/v2/` base. Inject secrets through your existing secure environment setup; do not paste real values into a transcript or tracked file. A partial tuple is an error.

Without either source, Keychain uses config `host` and email `username`, service `testrail`, account equal to the email. Manage that entry in Keychain Access without putting the key in a command line.

## Verification

Resolve `TR` to the helper beside the installed skill, then run:

```bash
python3 "$TR" whoami
python3 "$TR" whoami --account shared --project 93
python3 "$TR" get_projects --account shared
```

Stdout contains JSON with identity and project IDs for `whoami`, or API data for reads. Stderr reports the selected account, source, email and project count. No secret is printed. A missing project after successful authentication identifies the login that cannot see it.

Generate API keys under TestRail **My Settings → API Keys** and store them in the selected 1Password item's password field, Keychain, or the secure environment source. Never store a key in this config.
