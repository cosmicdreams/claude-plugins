# Cross-Pollination Protocol

How researchers share findings with each other during a workshop swarm. Proven pattern from the PNCB cache optimization experiment.

---

## When to Share

Share via SendMessage when you discover:
- A finding that directly relates to another researcher's facet
- A contradiction between your sources and expected behavior
- A named pattern or concept that other researchers should look for
- Evidence that changes the priority of a hypothesis

**Do NOT share:** routine findings, every query result, or status updates. Only share signal, not noise.

---

## Message Format

```
To: researcher-<N>
Subject: Cross-pollination: <one-line summary>

Finding: <what you found>
Source: <which notebook source(s) support this>
Relevance to your facet: <why this matters for their investigation>
Suggested follow-up: <a specific question they might want to ask the notebook>
```

---

## Receiving Cross-Pollination

When you receive a message from another researcher:
1. Read it and note the finding
2. If relevant, ask a follow-up question to the notebook about the intersection
3. Record the connection in your "Connections to Other Facets" section
4. If it changes your understanding, update your findings accordingly

---

## Broadcast Pattern

For findings that are relevant to ALL researchers:

```
To: all-researchers
Subject: Broadcast: <one-line summary>

<same format as above, but explain relevance broadly>
```

The PI or lead researcher coordinates broadcasts. Individual researchers send to specific peers.

---

## Anti-Patterns

- **Information flooding** — sharing every query result dilutes signal
- **Waiting for others** — don't block your investigation waiting for cross-pollination
- **Ignoring messages** — always read and acknowledge, even if not directly relevant
- **Duplicating work** — if another researcher already covered something, reference their finding instead of re-querying
