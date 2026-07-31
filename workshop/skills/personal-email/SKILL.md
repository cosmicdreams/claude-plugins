---
name: personal-email
description: >
  Personal Gmail via the gws CLI — read the inbox and messages, search, draft, reply,
  send. Not for calendar events (workshop:personal-calendar).
---

# workshop:personal-email

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Manage personal Gmail via the Google Workspace CLI (gws). Trigger on: "check my email", "read this message", "reply to", "send email", "list inbox", "unread emails", "what emails do I have", "do I have any new emails", "any emails from X", "show me my inbox", "draft an email", "email someone". Do NOT trigger for calendar events — use workshop:personal-calendar for those.

Manage personal Gmail via `gws`.

## Integration preflight (circuit-breaker)

Before any `gws` call, run:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/check-integration.sh" gws
```

If exit code is non-zero, stop and output the message from stderr verbatim.
Example: "integration gws unavailable: gws auth failed: token expired — run: gws auth login"
Do not proceed with any Gmail operations.

For auth setup and error handling, read `references/auth.md` (also at
`workshop/references/gws-auth.md`).

## List inbox (unread summary)

```bash
gws +triage
```

For more messages:

```bash
gws gmail users messages list --params '{"userId": "me", "maxResults": 20}'
```

Returns message IDs — fetch details with the read command below.
Present as a Markdown table leading with unread count.

## Read a message

```bash
gws gmail users messages get --params '{"userId": "me", "id": "<message_id>"}'
```

Display: From, To, CC (if present), Date, Subject, then body.
Strip quoted reply chains unless the user asks for them.

## Send a new email

Always confirm before sending — there is no undo.
Show the user: recipient, subject, body. Ask "Send this email? (yes/no)".

```bash
gws +send
```

Or scripted (construct RFC 2822 message, base64url-encode it):

```bash
gws gmail users messages send --params '{"userId": "me"}' --json '{"raw": "<base64url_encoded_message>"}'
```

## Reply to a message

Fetch the original to get headers (Message-ID, References, thread ID).
Construct reply with proper In-Reply-To and References headers, then send with `threadId`.
Always confirm before sending.

Present all results as clean Markdown. Use tables for message lists, blockquotes for bodies.
Never dump raw JSON.
