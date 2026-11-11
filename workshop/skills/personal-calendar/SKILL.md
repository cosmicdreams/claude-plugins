---
name: personal-calendar
description: >
  Google Calendar through the host's Google Calendar connector — schedule, upcoming
  meetings, availability and free time, conflicts, creating events. Not for email
  (workshop:personal-email).
---

# workshop:personal-calendar

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Manage Google Calendar through the host's Google Calendar connector. Use when the user asks about calendar events, upcoming meetings, their schedule, availability, free/busy time, or wants to create a meeting. Trigger phrases: "what's on my calendar", "upcoming meetings", "check availability", "am I free", "create meeting", "schedule event", "what do I have today", "block time", "do I have any conflicts", "when is my next meeting", "what meetings do I have this week". Do NOT trigger for email tasks — use workshop:personal-email for that.

## Connector

Use the host's Google Calendar connector tools: `list_calendars`, `list_events`, `suggest_time` and `create_event`. Tool names carry a host prefix and may be deferred; find them with tool search first.

If the session has no Google Calendar connector, say so and that it is set up in the host's connector settings, then stop. Do not fall back to a command-line tool. The connector reads the calendar of the account signed in to the host; see `${CLAUDE_PLUGIN_ROOT}/references/connectors.md`.

## List upcoming events

`list_events` with `orderBy: "startTime"`. For a specific range pass `startTime` and `endTime` as local ISO 8601 times with no UTC offset and no trailing `Z` (the connector resolves the user's time zone). Follow `nextPageToken` until the range is covered.

Format output as a time-sorted list grouped by day. Bold event titles. Show duration.

```
## Today — Monday, Mar 9
- 09:00–10:00 · **Standup**

## Tomorrow — Tuesday, Mar 10
- 11:00–12:00 · **Project Review**
```

## Check free time

List the events in the window with `list_events` and invert the busy blocks to show free windows. An event the user declined, or one marked free, does not consume time. To find a slot of a given length, `suggest_time` with the user's own address in `attendeeEmails`, the window, and `durationMinutes`.

A failed call means unknown availability, not a free day.

## Create an event

Confirm with the user before creating: title, date, start and end time, attendees. Convert natural language times to ISO 8601. If the time zone is ambiguous, ask first. Then `create_event`.
