---
name: email
description: >
  Manage Microsoft Outlook email via msgcli. Use when the user asks to check email,
  read messages, list inbox, reply to an email, send email, or anything related to
  Outlook mail. Trigger phrases: "check my email", "read this message", "reply to",
  "send email", "list inbox", "unread emails", "what emails do I have".
  Do NOT trigger for calendar events (use office:calendar for that).
---

# office:email

This skill manages Outlook mail through `msgcli`, an agent-first CLI. All commands
use `--no-input` to prevent interactive prompts. Capture stdout for data; watch
stderr for errors.

## Authentication

Before any mail command, if you see exit code 2 or an auth error message, stop and
tell the user:

> Authentication required. Run `msgcli auth add` and follow the prompts to connect
> your Microsoft account.

## Commands

### List inbox

Run:
```bash
msgcli mail list --no-input
```

Output is JSON. Format as a Markdown table:
| # | From | Subject | Date | Unread |
|---|------|---------|------|--------|

Show the 20 most recent messages by default. Mention unread count at the top.

### Read a message

Run:
```bash
msgcli mail get <id> --no-input
```

Display the full message body. Show: From, To, CC (if present), Date, Subject,
then the body. Render HTML-stripped plain text.

### Reply to a message

Run:
```bash
msgcli mail reply <id> --body "<reply_text>" --no-input
```

Always confirm with the user before sending: show them the To address, subject,
and body text, then ask "Send this reply? (yes/no)".

### Send a new email

Run:
```bash
msgcli mail send --to "<address>" --subject "<subject>" --body "<body>" --no-input
```

Always confirm before sending: show recipient, subject, and body, then ask
"Send this email? (yes/no)".

## Error handling

- Exit code 2: authentication failure → instruct `msgcli auth add`
- `msgcli: command not found`: tell user to install msgcli first
- Any other non-zero exit: show the stderr output and ask user how to proceed

## Output style

Present results as clean Markdown. Use tables for lists, blockquotes for message
bodies. Keep it scannable — don't dump raw JSON at the user.
