# Spec — `workflow:prioritize`

**Status:** draft for review (spec-first; no code until approved)
**Replaces:** `workflow:pulse` + `workflow:morning-brief` (both retired into this one skill)
**Name rationale:** a verb (per the plugins=nouns / skills=verbs rule); ranks work and surfaces the top thing. Carries the "what's my next task" intent `next-task` implied, without the noun.

---

## Purpose

On demand, at any time of day, answer **"what should I work on next?"** by gathering everything that defines what's on the plate — so the user doesn't poll Slack / Jira / calendar separately, and doesn't start from a blank slate. Built for the low-focus moment, **morning *and* afternoon** (this is why a "morning"-named ritual was the wrong shape).

### Design principle — lead with one action
Default output **leads with a single next action + a one-line why.** A wall of signals worsens activation paralysis; one clear "do this next" is the antidote. The full ranked table sits below, for when more context is wanted.

---

## Input contract (preflight, fail-fast)

- **Requires** `~/.claude/workflow.json`. Missing → suggest `workflow:config`, stop.
- Reuse the existing `check-integration.sh` circuit-breaker before any Slack / Jira / gws call (already in `pulse`/`morning-brief` step 01).
- Optional arg: `--since <when>` (delta view) vs full picture (default).
- Optional mode: on-demand (default) | `--loop` (ambient).

## Three data planes it merges

1. **Standing obligations** (from `morning-brief`): blocked issues you own, stale in-progress, high-priority queue — "what's outstanding."
2. **Fresh signals / delta** (from `pulse`): new Slack messages, Jira comments / status changes since last broadcast.
3. **Available time** (new, from `personal-calendar`): today's meetings / free blocks → rank work against *realistic capacity*, not an infinite day.

### Source slots — including the known gap
Sources are declared in config so coverage is explicit. **Work email + work calendar (Microsoft Outlook / Exchange) are declared-but-empty slots today** (Graph auth unsolved — see the work-Outlook blocker memory). The skill prints `(work email/calendar: not connected)` in every run so the gap is visible, and a future Microsoft Graph hookup drops in as config with no redesign.

## Modes (one engine)

- **On-demand (default):** full picture → TOP action + ranked table. Any time of day.
- **Ambient (`--loop` via `/loop 1h`):** delta-only, quiet output; surfaces only when the top item changes. Preserves `pulse`'s watchdog use.

## Steps (`steps/` progressive disclosure)

1. `01-setup.md` — load config + state + resolve user IDs + circuit-breaker preflight *(dedupe pulse's and morning-brief's near-identical setup into one)*
2. `02-fetch-signals.md` — Slack + Jira subagent fan-out *(merge the two duplicated fetch implementations into one shared engine)*
3. `03-fetch-obligations.md` — blocked / stale / high-priority queue *(from morning-brief)*
4. `04-fetch-availability.md` — calendar free/busy *(new; degrades gracefully if calendar not connected)*
5. `05-rank-output.md` — unified score across signals + obligations weighted by available time; emit TOP + table; write state
6. `06-focus-update.md` — optionally narrow today's ambient monitoring *(from morning-brief step 05)*

## Output

```
NEXT: <single action> — <one-line why> (you have ~Xh free before <next meeting>)

What's on your plate
| # | Item | Source | Age | Why it ranks |
|---|------|--------|-----|--------------|
...
(work email/calendar: not connected)
```
Ambient mode: only the new TOP + the delta since last broadcast.

## Frontmatter
- `triggers:` consolidate both skills' phrases, de-collided: "what should I work on", "what am I doing today", "plan my day", "what needs my attention", "prioritize my work", "what's on my plate", "catch me up". (`pulse` + `morning-brief` both claimed "what needs my attention" — now single-owned here.)
- `allowed-tools:` Agent, Bash, Read, Write (read-only against external services; never posts/comments/transitions).

## Migration / retirement
- Delete `pulse` and `morning-brief`; leave their trigger phrases routing here.
- State file: one `prioritize` state (last-broadcast timestamp + last-top-item), absorbing both old state files.
- Bump `workflow` plugin version; CHANGELOG note the consolidation.

## Open question (needs your input before build)
**The ranking function.** How to weight: a fresh @-mention vs a blocked-on-you issue vs an approaching deadline vs how much free time you have today? Proposal: draft a default weighting, expose the weights in `workflow.json` so you tune them. Confirm the default priorities or hand me your mental ranking.
