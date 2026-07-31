---
name: diagram
description: >
  Generate Excalidraw .excalidraw diagrams where the layout itself carries the argument —
  architecture, component relationships, data flow, sequences, dependency graphs, decision
  trees, pipelines. Can chain after ideate:brainstorm. Not for bar/line/pie charts or
  prose.
triggers:
  - "create a diagram"
  - "diagram this"
  - "draw a diagram"
  - "make a diagram"
  - "excalidraw"
  - "sketch this out"
  - "map this out"
  - "draw a flowchart"
  - "create a flowchart"
  - "show the architecture"
  - "draw the flow"
  - "show how"
  - "map the dependencies"
  - "now diagram that"
  - "chart this out"
allowed-tools: Bash, Read, Write
---

# diagram

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Generate Excalidraw diagrams from natural language descriptions. Produces .excalidraw JSON files that open natively in PhpStorm, VS Code, and excalidraw.com. Layout argues through visual structure -- the arrangement communicates meaning, not just labels. Use for spatial/structural diagrams: system architecture, component relationships, data flow, sequence of actor interactions, dependency graphs, decision trees, workflow pipelines. Triggered by "diagram this", "draw a diagram", "create a flowchart", "show the architecture", "show how X connects to Y", "map the dependencies", or "now diagram that". Can chain after ideate:brainstorm. NOT for bar/line/pie charts, written explanations, or any output where spatial arrangement adds no meaning.

Generate `.excalidraw` JSON files. Layout communicates meaning — arrangement is the argument.

## Resources

- `references/json-reference.md` — element types, JSON templates, color palette; read before generating any JSON
- `assets/excalidraw-render.py` — renders `.excalidraw` to HTML for screenshotting

---

## Phase 0 — Chain Detection

If a synthesized brainstorm session exists (`.brainstorm-sessions/*.json`) and the user didn't provide an explicit subject, use that session's topic and summary as context.

Extract `topic` (5-10 words, used for filename) and `description`.

---

## Phase 1 — Clarify if ambiguous

If scope or level of detail is unclear, ask one question — e.g., "High-level overview or detailed breakdown?"

Determine diagram type:
- **Conceptual** — abstract shapes for mental models, workflows, relationships
- **Technical** — concrete examples, real code/API/data formats (look up actual specs; no generic placeholders)

---

## Phase 2 — Design

**The isomorphism test:** Mentally remove all text from the planned diagram. Does the structure alone communicate the concept? If not, redesign until it does.

**Visual pattern selection:**

| Concept type | Visual pattern |
|---|---|
| Hierarchy / tree | Top-down fan-out |
| Pipeline / sequence | Left-to-right flow |
| Convergence | Multiple inputs → single output |
| Feedback loop | Circular or spiral |
| Comparison | Side-by-side columns |
| System boundary | Nested containers |
| Decision tree | Diamond branching |

Layout principles: each major concept uses a different visual pattern; free-floating text by default; multi-zoom (summary flow at top, detail below); 60-80px between same-level elements, 120-160px between sections.

---

## Phase 3 — JSON Generation

Read `references/json-reference.md` before generating. Key rules: `roughness: 0`, `opacity: 100`, `fontFamily: 3` (monospace), semantic color roles.

---

## Phase 4 — Write the File

```bash
DATE=$(date +%Y-%m-%d)
SLUG=$(echo "TOPIC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | cut -c1-40)
FILENAME="${DATE}-${SLUG}.excalidraw"
```

Validate: `python3 -c "import json; json.load(open('$FILENAME')); print('Valid JSON')"`

---

## Phase 5 — Render and Validate

Use `assets/excalidraw-render.py` to generate HTML, then screenshot:

```bash
RENDER_HTML=$(mktemp /tmp/excalidraw-render-XXXXX.html)
python3 "${CLAUDE_SKILL_DIR}/assets/excalidraw-render.py" "$FILENAME" "$RENDER_HTML"
PREVIEW="${FILENAME%.excalidraw}-preview.png"
playwright-cli screenshot "file://$RENDER_HTML" "$PREVIEW" --wait-for-timeout 4000
rm -f "$RENDER_HTML"
```

Read the PNG. Check for: clipped text, unintentional overlaps, arrows missing targets, uneven spacing. Fix and re-render until clean (typically 2-3 iterations).

If `playwright-cli` is not installed: open the `.excalidraw` file in PhpStorm or drag to excalidraw.com.

---

## Phase 6 — Chain offer

> "Diagram written to `FILENAME`. Want to iterate on the layout, or generate a different view?"

If chained from `ideate:brainstorm`:
> "This idea has a diagram. Ready to run `ideate:reality-check` on it?"

---

## Storage

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
# Architecture/<topic>/ for system/component/data-flow diagrams
# Architecture/ADRs/<topic>/ for decision trees
# Research/<topic>/ for dependency maps
if [ -d "$VAULT_ROOT" ]; then
  mkdir -p "$VAULT_ROOT/$SUBFOLDER"
  cp "$FILENAME" "$VAULT_ROOT/$SUBFOLDER/$FILENAME"
fi
```

## Known limitations

- Large diagrams (50+ elements): build section by section, then combine
- Arrow routing is manual — calculate coordinates explicitly
- Render step requires internet (loads Excalidraw from CDN)
