---
name: email
description: >
  Manage Microsoft Outlook email via msgcli. Trigger on: "check my email",
  "read this message", "reply to", "send email", "list inbox", "unread emails",
  "what emails do I have", "do I have any new emails", "any emails from X",
  "show me my inbox", "draft an email", "email someone", "forward this".
  Do NOT trigger for calendar events — use office:calendar for those.
---

# office:email

## Authentication

Check authentication first — exit code 2 or any "auth" error message means the
session is not connected. Stop immediately and tell the user:

> Authentication required. Run `msgcli auth add` and follow the prompts to
> connect your Microsoft account. Then retry.

All commands use `--no-input` to prevent interactive prompts. Capture stdout for
data; watch stderr for errors.

## List inbox

```bash
msgcli mail list --no-input
```

Output is JSON. Present as a Markdown table, 20 most recent messages by default.
Lead with unread count. Format:

| # | From | Subject | Date | Unread |
|---|------|---------|------|--------|

## Read a message

```bash
msgcli mail get <id> --no-input
```

Display: From, To, CC (if present), Date, Subject — then the body.
Render HTML-stripped plain text.

## Reply to a message

```bash
msgcli mail reply <id> --body "<reply_text>" --no-input
```

Always confirm before sending — msgcli sends immediately with no undo.
Show the user: To address, subject, and body text, then ask "Send this reply? (yes/no)".

## Send a new email

```bash
msgcli mail send --to "<address>" --subject "<subject>" --body "<body>" --no-input
```

Always confirm before sending — msgcli sends immediately with no undo.
Show the user: recipient, subject, and body, then ask "Send this email? (yes/no)".

## Error handling

- Exit code 2: authentication failure → instruct `msgcli auth add`
- `msgcli: command not found`: tell user to install msgcli first
- Any other non-zero exit: show stderr output and ask user how to proceed

Present all results as clean Markdown. Use tables for message lists, blockquotes
for message bodies. Never dump raw JSON at the user.
