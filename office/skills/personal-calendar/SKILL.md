---
name: personal-calendar
description: >
  Manage personal Google Calendar via the Google Workspace CLI (gws). Use when the user
  asks about calendar events, upcoming meetings, their schedule, availability, free/busy
  time, or wants to create a meeting. Trigger phrases: "what's on my calendar",
  "upcoming meetings", "check availability", "am I free", "create meeting",
  "schedule event", "what do I have today", "block time", "do I have any conflicts",
  "when is my next meeting", "what meetings do I have this week".
  Do NOT trigger for email tasks — use office:personal-email for that.
---

# office:personal-calendar

## Authentication

If any command fails with an auth error or non-zero exit, stop and tell the user:

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

## List upcoming events

Use the built-in agenda helper — it shows upcoming events across all calendars:

```bash
gws +agenda
```

For a specific time range (e.g., next 7 days), use the events API directly.
Replace `TIME_MIN` with the current datetime in ISO 8601 format:

```bash
gws calendar events list --params '{"calendarId": "primary", "maxResults": 20, "orderBy": "startTime", "singleEvents": true, "timeMin": "TIME_MIN"}'
```

Output is JSON. Format as a time-sorted Markdown list grouped by day:

```
## Today — Monday, Mar 9
- 09:00–10:00 · **Standup**
- 14:00–15:00 · **1:1 with Alex**

## Tomorrow — Tuesday, Mar 10
- 11:00–12:00 · **Project Review**
```

Bold event titles. Show duration clearly. If no events, say "No events scheduled."

## Check availability / free-busy

Use the freebusy query to get busy blocks for a time range:

```bash
gws calendar freebusy query --json '{"timeMin": "START_ISO", "timeMax": "END_ISO", "items": [{"id": "primary"}]}'
```

Invert the busy blocks to show free windows. Format output as:
- Free blocks: "Free 10:00–11:30"
- Busy blocks: list event times

If no free time exists, say "No free blocks found for the requested period."

## Create an event

Before running, confirm with the user: title, date, start time, end time, and any
attendees. Convert natural language times to ISO 8601 (e.g., "tomorrow at 2pm" →
`2026-03-08T14:00:00`). If timezone is ambiguous, ask before creating.

Use the built-in insert helper when possible:

```bash
gws +insert
```

For scripted creation:

```bash
gws calendar events insert --params '{"calendarId": "primary"}' --json '{"summary": "TITLE", "start": {"dateTime": "START_ISO", "timeZone": "America/Los_Angeles"}, "end": {"dateTime": "END_ISO", "timeZone": "America/Los_Angeles"}}'
```

After creation, show the created event in the grouped-day format used for listing.

## Error handling

- `gws: command not found` → install with `npm install -g @googleworkspace/cli`
- "Access blocked" or auth error → run `gws auth setup` / `gws auth login`
- "accessNotConfigured" → the Calendar API is not enabled; gws prints a link to enable it
- Any other non-zero exit: show stderr and ask the user how to proceed
