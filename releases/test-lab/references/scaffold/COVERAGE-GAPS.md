# Coverage gaps

What is deliberately not covered, and what would have to change to cover it.

A gap with a named unlock signal is a plan. A gap with no note is
indistinguishable from an oversight, and the person reading this suite six
months from now cannot tell which one they are looking at — which is the whole
reason this file is mandatory rather than nice to have.

Update it in the same commit that creates the gap. A gaps file written at the
end of a campaign is a reconstruction, and reconstructions omit the awkward
ones.

## Format

| Area | What is uncovered | Why | Unlock signal |
|---|---|---|---|

## Current gaps

| Area | What is uncovered | Why | Unlock signal |
|---|---|---|---|
| Search results | result counts and facet behaviour | the search index is a cloud service with no local equivalent, so these assert against data the local environment does not have | a local index, or a seeded fixture corpus the assertions can rely on |
| Contact forms | submission and the resulting email | the side effect leaves the system under test; asserting it needs a mail catcher | a mail catcher wired into the local environment |
| Editorial judgement | "the layout looks correct", brand and design conformance | not automatable; a person decides this | none — record it as a manual case and leave it manual |
| Authenticated authoring | anything beyond the one example spec | the session harness exists but the factories cover two content types | a factory per content type under test |

## Counting

State the boundary in numbers wherever the corpus is known: how many cases
exist, how many are automatable, how many are covered, and what the remainder is
blocked on. A corpus of several hundred will not become several hundred specs,
and saying so at the start is worth more than discovering it at review.
