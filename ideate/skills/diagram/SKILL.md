---
name: diagram
description: >
  Generate Excalidraw diagrams from natural language descriptions. Produces .excalidraw
  JSON files that open natively in PhpStorm, VS Code, and excalidraw.com. Layout argues
  through visual structure -- the arrangement communicates meaning, not just labels.
  Use when you need to visualize architecture, workflows, system boundaries, or decision
  trees. Say "diagram this", "visualize this", "sketch this out", "map this out", or
  "create a diagram". Can chain after ideate:brainstorm or ideate:research. Not for
  simple lists or text that does not benefit from spatial arrangement.
triggers:
  - "create a diagram"
  - "diagram this"
  - "visualize this"
  - "draw a diagram"
  - "make a diagram"
  - "excalidraw"
  - "sketch this out"
  - "map this out"
allowed-tools: Bash, Read, Write
---

# Skill: diagram

Generate `.excalidraw` JSON files from natural language descriptions. Diagrams
argue through visual structure — the layout and arrangement communicate meaning,
not just the labels.

Output files open natively in PhpStorm (Excalidraw plugin), VS Code (Excalidraw
extension), and excalidraw.com.

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

### File header

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "ideate:diagram",
  "elements": [],
  "appState": {
    "gridSize": null,
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

### Element types and when to use them

| Type | Use for |
|---|---|
| `rectangle` | Processes, components, steps |
| `ellipse` | Start/end points, external systems |
| `diamond` | Decisions, conditionals |
| `arrow` | Directional relationships |
| `line` | Non-directional connections |
| `text` | Labels, annotations, evidence |
| `frame` | Section grouping |

### Standard element properties (apply to all elements)

```json
{
  "id": "unique-id",
  "type": "rectangle",
  "x": 0,
  "y": 0,
  "width": 160,
  "height": 60,
  "strokeColor": "#1e1e2e",
  "backgroundColor": "#cba6f7",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 0,
  "opacity": 100,
  "seed": 12345,
  "version": 1,
  "versionNonce": 1,
  "angle": 0
}
```

**Always use `roughness: 0` and `opacity: 100`.** Create hierarchy through color,
size, and stroke width — never through opacity.

### Text elements

```json
{
  "id": "text-id",
  "type": "text",
  "x": 10,
  "y": 15,
  "width": 140,
  "height": 30,
  "text": "Label here",
  "originalText": "Label here",
  "fontSize": 16,
  "fontFamily": 3,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": "parent-shape-id"
}
```

**`fontFamily: 3`** = monospace. Always use this.

### Arrow elements

```json
{
  "id": "arrow-id",
  "type": "arrow",
  "x": 160,
  "y": 30,
  "width": 80,
  "height": 0,
  "points": [[0, 0], [80, 0]],
  "startBinding": {
    "elementId": "source-shape-id",
    "focus": 0,
    "gap": 2
  },
  "endBinding": {
    "elementId": "target-shape-id",
    "focus": 0,
    "gap": 2
  },
  "startArrowhead": null,
  "endArrowhead": "arrow",
  "strokeColor": "#1e1e2e",
  "strokeWidth": 2,
  "roughness": 0,
  "opacity": 100,
  "seed": 99999,
  "version": 1,
  "versionNonce": 1,
  "angle": 0
}
```

### Color palette (use semantic roles, not arbitrary colors)

| Role | Color |
|---|---|
| Primary action / highlight | `#cba6f7` (mauve) |
| Secondary / supporting | `#89dceb` (sky) |
| Warning / caution | `#f9e2af` (yellow) |
| Success / positive | `#a6e3a1` (green) |
| Negative / risk | `#f38ba8` (red) |
| Neutral / background | `#eff1f5` (surface) |
| Text / stroke | `#1e1e2e` (base) |

---

## Phase 4 — Write the File

Generate the filename:

```bash
DATE=$(date +%Y-%m-%d)
SLUG=$(echo "TOPIC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | cut -c1-40)
FILENAME="${DATE}-${SLUG}.excalidraw"
echo $FILENAME
```

Write the complete JSON to the file:

```bash
cat > "$FILENAME" << 'EXCALIDRAW_EOF'
{
  "type": "excalidraw",
  "version": 2,
  ...full JSON...
}
EXCALIDRAW_EOF
```

Confirm:

```bash
python3 -c "import json; json.load(open('$FILENAME')); print('Valid JSON ✓')"
echo "Written: $FILENAME"
echo "Open in: PhpStorm, VS Code (Excalidraw extension), or excalidraw.com"
```

---

## Phase 5 — Chain Offer

After delivering the file, offer:

> "Diagram written to `FILENAME`. Open it in PhpStorm or drag it to excalidraw.com
> to view and edit. Want to iterate on the layout, or generate a different view
> of the same topic?"

If chained from `ideate:brainstorm`, also offer:
> "This idea cleared brainstorm and now has a diagram. Ready to run
> `ideate:reality-check` on it?"

---

## Known Limitations

- Large diagrams (50+ elements) may need to be generated in sections — build
  section by section, then combine
- Arrow routing is manual — calculate coordinates explicitly, don't assume
  Excalidraw will route around shapes
- Text clipping: verify `width` and `height` of text containers are large enough
  for the content before writing the file
