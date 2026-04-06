---
name: diagram
description: >
  Generate Excalidraw diagrams from natural language descriptions. Produces .excalidraw
  JSON files that open natively in PhpStorm, VS Code, and excalidraw.com. Layout argues
  through visual structure -- the arrangement communicates meaning, not just labels.
  Use when you need to produce a spatial/structural diagram: system architecture,
  component relationships, data flow, sequence of actor interactions, dependency graphs,
  decision trees, or workflow pipelines. Triggered by "diagram this", "draw a diagram",
  "create a flowchart", "draw the flow", "show the architecture", "show how X connects
  to Y", "map the dependencies", or "now diagram that" (when chaining from brainstorm or
  research). Can chain after ideate:brainstorm or ideate:research. NOT for: bar/line/pie
  charts or data visualizations, written explanations, textual lists or outlines, or any
  output where spatial arrangement adds no meaning.
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

# Skill: diagram

Generate `.excalidraw` JSON files from natural language descriptions. Diagrams
argue through visual structure — the layout and arrangement communicate meaning,
not just the labels.

Output files open natively in PhpStorm (Excalidraw plugin), VS Code (Excalidraw
extension), and excalidraw.com.

## Resources in this skill

- `references/json-reference.md` — element type table, JSON property templates for rectangles/text/arrows, color palette; read before generating any JSON
- `assets/excalidraw-render.py` — renders an `.excalidraw` file to HTML for screenshotting; use in Phase 5

---

## Phase 0 — Chain Detection

Check for context from a prior ideate session to use as diagram subject:

```bash
# Check for research session
test -f .research.json && python3 -c "
import json
with open('.research.json') as f:
    d = json.load(f)
if d.get('status') == 'synthesized':
    print('research')
    print(d.get('topic', ''))
    print(d.get('summary', '')[:500])
"

# Check for brainstorm session
ls .brainstorm-sessions/*.json 2>/dev/null | sort -r | head -1
```

- If a synthesized research or brainstorm session exists and the user didn't
  provide an explicit subject → use that session's topic and summary as context
- If the user provided an explicit description → use that

Extract:
- `topic`: The diagram subject (5-10 words, used for filename)
- `description`: What to diagram (from user input or session context)

---

## Phase 1 — Depth Assessment

**If the user's request is ambiguous** (no explicit subject, scope, or level of detail):
ask one clarifying question before proceeding — e.g., "High-level overview or detailed
breakdown? What's the main thing you want someone to understand from this diagram?"
Do not ask multiple questions; pick the one that unblocks design.

Determine diagram type before generating any JSON:

**Conceptual diagram** — abstract shapes for mental models, workflows, relationships.
Use when: explaining how something works, showing a process flow, mapping a system.

**Technical diagram** — concrete examples, real code snippets, actual API/data formats.
Use when: documenting an architecture, showing data flow with real payloads, teaching
a specific implementation pattern.

For technical diagrams: look up actual specifications before generating. Generic
placeholders are not acceptable.

---

## Phase 2 — Design

**The isomorphism test (apply before generating JSON):**
Mentally remove all text from the planned diagram. Does the structure alone
communicate the concept? If not, redesign the layout until it does.

**Visual pattern selection — pick the pattern that matches the concept:**

| Concept type | Visual pattern |
|---|---|
| Hierarchy / tree | Top-down fan-out |
| Pipeline / sequence | Left-to-right flow |
| Convergence | Multiple inputs → single output |
| Feedback loop | Circular or spiral |
| Comparison | Side-by-side columns |
| System boundary | Nested containers |
| Decision tree | Diamond branching |

**Layout principles:**
- Each major concept uses a different visual pattern — avoid a grid of identical boxes
- Use free-floating text by default; add shapes only when they serve meaning
- Multi-zoom: design a summary flow at the top, detail sections below
- Spacing: 60-80px between elements at the same level, 120-160px between sections

---

## Phase 3 — JSON Generation

Read `references/json-reference.md` before generating any JSON — it contains the
file header, all element type templates, and the semantic color palette.

Key rules from that reference:
- Always `roughness: 0`, `opacity: 100`
- Always `fontFamily: 3` (monospace) for text elements
- Use semantic color roles, not arbitrary colors

---

## Phase 4 — Write the File

Generate the filename:

```bash
DATE=$(date +%Y-%m-%d)
SLUG=$(echo "TOPIC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | cut -c1-40)
FILENAME="${DATE}-${SLUG}.excalidraw"
echo $FILENAME
```

Write the complete JSON, then validate:

```bash
python3 -c "import json; json.load(open('$FILENAME')); print('Valid JSON ✓')"
```

---

## Phase 5 — Render & Validate

**This phase is mandatory.** You cannot judge a diagram from JSON alone.

Use `assets/excalidraw-render.py` to generate the HTML wrapper, then screenshot it:

```bash
RENDER_HTML=$(mktemp /tmp/excalidraw-render-XXXXX.html)
python3 "${CLAUDE_SKILL_DIR}/assets/excalidraw-render.py" "$FILENAME" "$RENDER_HTML"

PREVIEW="${FILENAME%.excalidraw}-preview.png"
playwright-cli screenshot "file://$RENDER_HTML" "$PREVIEW" --wait-for-timeout 4000
rm -f "$RENDER_HTML"
```

Then use the **Read tool** on `$PREVIEW` to view the rendered result.

> If `playwright-cli` is not installed: `npm i -g playwright-cli` or open the
> `.excalidraw` file directly in PhpStorm / drag to excalidraw.com to inspect.

### The loop

Run until the diagram passes all checks:

1. **Render & view** — run the script above, then Read the PNG
2. **Check for defects:** clipped text, unintentional overlaps, arrows missing targets,
   floating labels, uneven spacing, lopsided composition
3. **Fix** — edit JSON: widen containers, adjust `x`/`y`, add waypoints to arrow
   `points` arrays, resize for visual balance
4. **Re-render** — repeat from step 1

**Stop when:** no text is clipped, arrows connect correctly, spacing is balanced,
and you'd show this to someone without caveats. Usually 2–3 iterations.

---

## Phase 6 — Chain Offer

After delivering the file, offer:

> "Diagram written to `FILENAME`. Open it in PhpStorm or drag it to excalidraw.com
> to view and edit. Want to iterate on the layout, or generate a different view
> of the same topic?"

If chained from `ideate:brainstorm`, also offer:
> "This idea cleared brainstorm and now has a diagram. Ready to run
> `ideate:reality-check` on it?"

---

## Known Limitations

- Large diagrams (50+ elements): build section by section, then combine
- Arrow routing is manual — calculate coordinates explicitly; Excalidraw does not
  route around shapes automatically
- CDN dependency: the render step loads Excalidraw from unpkg.com and requires
  an internet connection

---

## Storage

The diagram is already written locally (Phase 4). This phase archives it to the Obsidian
vault if one is present.

Choose the vault subfolder based on diagram type:
- `Architecture/<topic>/` — system/component/data-flow diagrams
- `Architecture/ADRs/<topic>/` — decision trees, option comparisons
- `Research/<topic>/` — dependency maps, audit diagrams

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
SUBFOLDER="Architecture/<topic>"   # adjust per type above

if [ -d "$VAULT_ROOT" ]; then
  mkdir -p "$VAULT_ROOT/$SUBFOLDER"
  cp "$FILENAME" "$VAULT_ROOT/$SUBFOLDER/$FILENAME"
  echo "Saved to vault: $SUBFOLDER/$FILENAME"
else
  echo "Saved locally: $FILENAME"
  echo "Tip: to route diagrams to your Obsidian vault automatically, run /update-config and set OBSIDIAN_VAULT_NAME."
fi
```
