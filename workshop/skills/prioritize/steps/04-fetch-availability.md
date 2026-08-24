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

If OK, pull today's events and free/busy. `START_ISO` = now, `END_ISO` = end of today, both
with a local UTC offset (e.g. `2026-08-24T12:00:00-05:00`) — a bare timestamp is read as UTC and
silently shifts the window.

```bash
# Today's events. The fields projection matters: without it gws returns ~20 columns
# per event (etag, iCalUID, reminders, htmlLink...) and floods the context.
gws calendar events list --params '{"calendarId":"primary","timeMin":"START_ISO","timeMax":"END_ISO","singleEvents":true,"orderBy":"startTime","fields":"items(summary,start,end,transparency)"}' --format json

# Busy blocks. Note --json (request body), NOT --params (query string).
gws calendar freebusy query --json '{"timeMin":"START_ISO","timeMax":"END_ISO","items":[{"id":"primary"}]}' --format json
```

Command-shape gotchas, verified against the installed `gws`:
  - There is no `gws +agenda`. gws rejects it with `Unknown service '+agenda'`. The helper
    subcommands shown in `gws --help` are not available in this build; use the REST-shaped
    `gws calendar events list` above.
  - `freebusy` is not a top-level service either — it is `gws calendar freebusy query`.
  - An all-day event with `"transparency": "transparent"` (birthdays, anniversaries, out-of-office
    markers) does NOT consume working time. Exclude those before computing busy time, or a
    personal all-day entry will read as a fully booked day.

Invert the busy blocks to get free windows. Compute:

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
