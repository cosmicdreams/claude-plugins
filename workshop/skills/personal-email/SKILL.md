---
name: personal-email
description: >
  Gmail through the host's Gmail connector — read the inbox and messages, search, draft,
  reply, send. Not for calendar events (workshop:personal-calendar).
---

# workshop:personal-email

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Manage Gmail through the host's Gmail connector. Trigger on: "check my email", "read this message", "reply to", "send email", "list inbox", "unread emails", "what emails do I have", "do I have any new emails", "any emails from X", "show me my inbox", "draft an email", "email someone". Do NOT trigger for calendar events — use workshop:personal-calendar for those.

## Connector

Use the host's Gmail connector tools: `search_threads`, `get_thread`, `create_draft`, `send_message` and `reply`. Tool names carry a host prefix and may be deferred; find them with tool search first.

If the session has no Gmail connector, say so and that it is set up in the host's connector settings, then stop. Do not fall back to a command-line tool. The connector reads the mailbox of the account signed in to the host; see `${CLAUDE_PLUGIN_ROOT}/references/connectors.md`.

## List inbox (unread summary)

`search_threads` with `query: "in:inbox is:unread"`. Drop `is:unread` for the whole inbox, and add Gmail operators (`from:`, `newer_than:2d`, `subject:`) to search. Follow `pageToken` for more.

Present as a Markdown table leading with the unread count.

## Read a message

`get_thread` with the thread ID from the search.

Display: From, To, CC (if present), Date, Subject, then body. Strip quoted reply chains unless the user asks for them.

## Send a new email

Always confirm before sending — there is no undo. Show the user: recipient, subject, body. Ask "Send this email? (yes/no)".

When the user wants to look it over in Gmail first, `create_draft` and give them its `viewUrl`. Otherwise, after the yes, `send_message`. The plain-text `body` takes no Markdown; use `htmlBody` for formatting.

## Reply to a message

Read the thread with `get_thread` to get the ID of the message being answered, then `reply` to that message (or `create_draft` with `replyToMessageId` for a draft). The connector keeps the reply in the thread. Always confirm before sending.

Present all results as clean Markdown. Use tables for message lists, blockquotes for bodies. Never dump raw JSON.
