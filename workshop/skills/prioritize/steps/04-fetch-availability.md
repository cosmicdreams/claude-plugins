# Step 4 — Fetch Availability

**Skip this step entirely in ambient (`--loop`) mode** — capacity doesn't change minute to minute.

## Goal

Know how much usable time you actually have today, so ranking is against real capacity rather than
an infinite day. "3 things need you, but you have one 90-minute gap before back-to-back meetings"
changes what `NEXT:` should be.

## Which calendars

Read `integrations.calendar` from `workshop.json`. There may be more than one provider:

- **`provider: google`** (connected via the `gws` CLI) — fetch it.
- **`provider: microsoft`** (work Outlook / Exchange) — **currently an unconnected slot** (Graph
  auth unsolved). Do not attempt a fetch; record `work_calendar: not_connected` so step 5 can surface
  the gap.

If no calendar integration is configured at all, set `availability: unknown` and continue — the
skill still works, it just can't weight by capacity.

## Fetch (Google / gws)

Circuit-breaker first (same pattern as the other integrations):

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/check-integration.sh" gws || { echo "calendar unavailable"; }
```

Only if preflight succeeds, pull today's events and free/busy; otherwise record unknown
availability and the error, and skip both commands. Substitute START_ISO = now and END_ISO =
end of today, each with an explicit local UTC offset (never a bare timestamp).

```bash
gws calendar events list --params '{"calendarId":"primary","timeMin":"START_ISO","timeMax":"END_ISO","singleEvents":true,"orderBy":"startTime","fields":"items(summary,start,end,transparency),nextPageToken"}' --format json
gws calendar freebusy query --json '{"timeMin":"START_ISO","timeMax":"END_ISO","items":[{"id":"primary"}]}' --format json
```

Follow event pagination using `nextPageToken`. Freebusy uses a request body (`--json`),
not query params. Use the returned busy intervals as authoritative; transparent all-day
events do not consume working time. Check per-calendar freebusy errors as well as command
exit status; failed retrieval means unknown capacity, not a fully free day.
Invert the busy blocks to get free
windows. Compute:

- `free_hours_today` — total free time remaining today
- `next_meeting` — title + start of the next event (or none)
- `next_free_block` — the next contiguous open window (start, minutes)

## Output of this step

Pass forward to step 5:
```
availability: { free_hours_today, next_meeting, next_free_block, work_calendar: connected|not_connected }
```
If the fetch failed or no calendar is configured, pass `availability: unknown`.

Proceed to `steps/05-rank-output.md`.
