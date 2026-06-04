# Step 4 — Fetch Availability

**Skip this step entirely in ambient (`--loop`) mode** — capacity doesn't change minute to minute.

## Goal

Know how much usable time you actually have today, so ranking is against real capacity rather than
an infinite day. "3 things need you, but you have one 90-minute gap before back-to-back meetings"
changes what `NEXT:` should be.

## Which calendars

Read `integrations.calendar` from `workflow.json`. There may be more than one provider:

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

If OK, pull today's events and free/busy:

```bash
gws +agenda
gws calendar freebusy query --json '{"timeMin":"START_ISO","timeMax":"END_ISO","items":[{"id":"primary"}]}'
```

Where `START_ISO` = now, `END_ISO` = end of today (local). Invert the busy blocks to get free
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
