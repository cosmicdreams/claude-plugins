---
name: personal-email
description: >
  Manage personal Gmail via the Google Workspace CLI (gws). Trigger on: "check my email",
  "read this message", "reply to", "send email", "list inbox", "unread emails",
  "what emails do I have", "do I have any new emails", "any emails from X",
  "show me my inbox", "draft an email", "email someone".
  Do NOT trigger for calendar events — use office:personal-calendar for those.
---

# office:personal-email

## Authentication

Check authentication first. If any command fails with "Access blocked", an auth
error, or a non-zero exit, stop and tell the user:

> Authentication required. Run:
> ```bash
> gws auth setup   # first time — creates Cloud project and enables APIs
> gws auth login   # subsequent logins
> ```
> Then retry.

If `gws: command not found`, tell the user to install it first:
```bash
npm install -g @googleworkspace/cli
```

## List inbox (unread summary)

Use the built-in triage helper — it shows unread messages with sender, subject, and date:

```bash
gws +triage
```

Output is JSON. Present as a Markdown table, leading with unread count:

| # | From | Subject | Date |
|---|------|---------|------|

If the user wants more messages or a full inbox view:

```bash
gws gmail users messages list --params '{"userId": "me", "maxResults": 20}'
```

This returns message IDs only. Fetch details for each with the get command below.

## Read a message

```bash
gws gmail users messages get --params '{"userId": "me", "id": "<message_id>"}'
```

Display: From, To, CC (if present), Date, Subject — then the body.
Render HTML-stripped plain text. Strip quoted reply chains unless the user asks for them.

## Send a new email

Use the built-in send helper when possible:

```bash
gws +send
```

For scripted sends, construct a raw RFC 2822 message, base64url-encode it, then:

```bash
gws gmail users messages send --params '{"userId": "me"}' --json '{"raw": "<base64url_encoded_message>"}'
```

Always confirm before sending — there is no undo.
Show the user: recipient, subject, and body, then ask "Send this email? (yes/no)".

## Reply to a message

Fetch the original message first to get headers (Message-ID, References, thread ID).
Construct a reply with proper In-Reply-To and References headers, base64url-encode it,
then send using the same `users messages send` command with `threadId` in the JSON body.

Always confirm before sending. Show: To address, subject line (Re: ...), body.

## Error handling

- `gws: command not found` → install with `npm install -g @googleworkspace/cli`
- "Access blocked" or auth error → run `gws auth setup` / `gws auth login`
- "accessNotConfigured" → the Gmail API is not enabled; gws prints a link to enable it
- Any other non-zero exit: show stderr output and ask the user how to proceed

Present all results as clean Markdown. Use tables for message lists, blockquotes
for message bodies. Never dump raw JSON at the user.
