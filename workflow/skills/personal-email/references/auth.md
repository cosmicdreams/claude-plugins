# Google Workspace CLI — Authentication

Used by `workflow:personal-calendar` and `workflow:personal-email`.

## Check and handle auth errors

If any `gws` command fails with "Access blocked", an auth error, or non-zero exit, stop and tell the user:

> Authentication required. Run:
> ```bash
> gws auth setup   # first time — creates Cloud project and enables APIs
> gws auth login   # subsequent logins
> ```
> Then retry.

If `gws: command not found`:
> Install with: `npm install -g @googleworkspace/cli`

## Common API errors

- **"accessNotConfigured"** — the required API is not enabled; gws prints a link to enable it
- **"Access blocked"** — run `gws auth setup` / `gws auth login`
- Any other non-zero exit: show stderr and ask the user how to proceed
