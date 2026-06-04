---
name: personal-calendar
description: >
  Manage personal Google Calendar via the Google Workspace CLI (gws). Use when the user
  asks about calendar events, upcoming meetings, their schedule, availability, free/busy
  time, or wants to create a meeting. Trigger phrases: "what's on my calendar",
  "upcoming meetings", "check availability", "am I free", "create meeting",
  "schedule event", "what do I have today", "block time", "do I have any conflicts",
  "when is my next meeting", "what meetings do I have this week".
  Do NOT trigger for email tasks — use workshop:personal-email for that.
---

# workshop:personal-calendar

Manage personal Google Calendar via `gws`.

## Integration preflight (circuit-breaker)

Before any `gws` call, run:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/check-integration.sh" gws
```

If exit code is non-zero, stop and output the message from stderr verbatim.
Example: "integration gws unavailable: gws auth failed: token expired — run: gws auth login"
Do not proceed with any calendar operations.

For auth setup and error handling, read `references/auth.md` (also at
`workshop/references/gws-auth.md`).

## List upcoming events

```bash
gws +agenda
```

For a specific time range, replace `TIME_MIN` with current datetime in ISO 8601:

```bash
gws calendar events list --params '{"calendarId": "primary", "maxResults": 20, "orderBy": "startTime", "singleEvents": true, "timeMin": "TIME_MIN"}'
```

Format output as a time-sorted list grouped by day. Bold event titles. Show duration.

```
## Today — Monday, Mar 9
- 09:00–10:00 · **Standup**

## Tomorrow — Tuesday, Mar 10
- 11:00–12:00 · **Project Review**
```

## Check free/busy

```bash
gws calendar freebusy query --json '{"timeMin": "START_ISO", "timeMax": "END_ISO", "items": [{"id": "primary"}]}'
```

Invert busy blocks to show free windows.

## Create an event

Confirm with the user before creating: title, date, start/end time, attendees.
Convert natural language times to ISO 8601. If timezone is ambiguous, ask first.

```bash
gws +insert
```

Or scripted:

```bash
gws calendar events insert --params '{"calendarId": "primary"}' \
  --json '{"summary": "TITLE", "start": {"dateTime": "START_ISO", "timeZone": "America/Los_Angeles"}, "end": {"dateTime": "END_ISO", "timeZone": "America/Los_Angeles"}}'
```
