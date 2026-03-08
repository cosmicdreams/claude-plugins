---
name: calendar
description: >
  Manage Microsoft Outlook calendar events via msgcli. Use when the user asks about
  calendar events, upcoming meetings, their schedule, availability, free/busy time,
  or wants to create or update a meeting. Trigger phrases: "what's on my calendar",
  "upcoming meetings", "check availability", "am I free", "create meeting",
  "schedule event", "what do I have today", "block time".
  Do NOT trigger for email tasks (use office:email for that).
---

# office:calendar

This skill manages Outlook calendar through `msgcli`. All commands use `--no-input`.

## Authentication

If you see exit code 2 or an auth error, stop and tell the user:

> Authentication required. Run `msgcli auth add` and follow the prompts to connect
> your Microsoft account.

## Commands

### List upcoming events

Run:
```bash
msgcli calendar list --no-input
```

Output is JSON. Format as a time-sorted Markdown list:

```
## Today — Monday, Jan 6
- 09:00–10:00 · **Standup** (Teams link: ...)
- 14:00–15:00 · **1:1 with Sarah**

## Tomorrow — Tuesday, Jan 7
- 11:00–12:00 · **Sprint Planning**
```

Show events for the next 7 days by default. Group by day.

### Check availability

Run:
```bash
msgcli calendar availability --no-input
```

Show free/busy blocks for today and tomorrow. Format as:
- Free blocks (green in mind: ✓ Free 10:00–11:30)
- Busy blocks (events already scheduled)

### Create an event

Run:
```bash
msgcli calendar create --title "<title>" --start "<ISO datetime>" --end "<ISO datetime>" --no-input
```

Before running:
1. Confirm the details with the user: title, date, start time, end time, duration
2. Convert natural language times to ISO 8601 format (e.g. "tomorrow at 2pm" → 2026-03-08T14:00:00)
3. After creation, show the created event details

## Error handling

- Exit code 2: authentication failure → instruct `msgcli auth add`
- `msgcli: command not found`: tell user to install msgcli
- Any other non-zero exit: show stderr and ask user how to proceed

## Output style

Use Markdown with clear time formatting. Prioritize scannable output — group by day,
bold event titles, show duration clearly.
