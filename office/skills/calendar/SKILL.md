---
name: calendar
description: >
  Manage Microsoft Outlook calendar events via msgcli. Use when the user asks about
  calendar events, upcoming meetings, their schedule, availability, free/busy time,
  or wants to create a meeting. Trigger phrases: "what's on my calendar",
  "upcoming meetings", "check availability", "am I free", "create meeting",
  "schedule event", "what do I have today", "block time", "do I have any conflicts",
  "when is my next meeting", "what meetings do I have this week".
  Do NOT trigger for email tasks (use office:email for that).
---

# office:calendar

All commands use `--no-input`. If authentication fails (exit code 2), stop and tell the user:

> Authentication required. Run `msgcli auth add` and follow the prompts to connect
> your Microsoft account.

## List upcoming events

Run:
```bash
msgcli calendar list --no-input
```

Output is JSON. Format as a time-sorted Markdown list grouped by day, for the next 7 days:

```
## Today — Monday, Jan 6
- 09:00–10:00 · **Standup** (Teams link: ...)
- 14:00–15:00 · **1:1 with Sarah**

## Tomorrow — Tuesday, Jan 7
- 11:00–12:00 · **Sprint Planning**
```

Bold event titles. Show duration clearly. If no events, say "No events scheduled."

## Check availability

Run:
```bash
msgcli calendar availability --no-input
```

Show free/busy blocks for today and tomorrow:
- Free blocks: "Free 10:00–11:30"
- Busy blocks: list scheduled events by time

If no free time exists, say "No free blocks found for today/tomorrow."

## Create an event

Before running, confirm with the user: title, date, start time, end time.

Convert natural language times to ISO 8601 before passing to the command — msgcli requires ISO 8601 format (e.g., "tomorrow at 2pm" → `2026-03-08T14:00:00`).

If the user's timezone is ambiguous (no timezone mentioned and they have not set a preference), ask them to confirm before creating. Otherwise default to local system timezone.

Run:
```bash
msgcli calendar create --title "TITLE" --start "ISO_DATETIME" --end "ISO_DATETIME" --no-input
```

After creation, show the created event details in the same grouped-day format used for listing.

## Error handling

- Exit code 2: authentication failure — instruct `msgcli auth add`
- `msgcli: command not found` — tell the user to install msgcli
- Any other non-zero exit: show stderr and ask the user how to proceed
