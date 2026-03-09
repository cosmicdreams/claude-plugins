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

## Phase 5 — Render & Validate

**This phase is mandatory.** You cannot judge a diagram from JSON alone. After
writing the file, render it and visually inspect the result. Fix what you see,
then re-render. Repeat until it looks right.

### How to render

Generate a self-contained HTML wrapper and screenshot it with playwright-cli:

```bash
RENDER_HTML=$(mktemp /tmp/excalidraw-render-XXXXX.html)
python3 - "$FILENAME" "$RENDER_HTML" << 'PYEOF'
import json, sys
fname, outfile = sys.argv[1], sys.argv[2]
with open(fname) as f:
    scene = json.load(f)
html = """<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@excalidraw/excalidraw/dist/excalidraw.production.min.js"></script>
<style>*{margin:0;padding:0}body,html{width:100%;height:100vh;background:#fff}</style>
</head><body>
<div id="app" style="width:100%;height:100vh;"></div>
<script>
const sceneData = """ + json.dumps(scene) + """;
const { Excalidraw } = ExcalidrawLib;
const App = () => React.createElement(Excalidraw, {
  initialData: {
    elements: sceneData.elements,
    appState: { ...sceneData.appState, viewModeEnabled: true },
    scrollToContent: true
  },
  viewModeEnabled: true
});
ReactDOM.createRoot(document.getElementById("app")).render(React.createElement(App));
</script>
</body></html>"""
with open(outfile, "w") as f:
    f.write(html)
PYEOF

PREVIEW="${FILENAME%.excalidraw}-preview.png"
playwright-cli open "file://$RENDER_HTML"
playwright-cli eval "await new Promise(r => setTimeout(r, 4000))"
playwright-cli screenshot --filename="$PREVIEW"
playwright-cli close
rm -f "$RENDER_HTML"
```

Then use the **Read tool** on `$PREVIEW` to view the rendered result.

### The loop

Run this cycle until the diagram passes all checks:

1. **Render & view** — run the script above, then Read the PNG
2. **Audit against your design** — does the rendered structure match what you
   planned? Eye flow correct? Visual hierarchy clear?
3. **Check for defects:**
   - Text clipped or overflowing its container
   - Shapes or text overlapping unintentionally
   - Arrows missing targets or crossing through shapes
   - Labels floating without clear anchor
   - Uneven spacing between elements that should be uniform
   - Lopsided composition — large voids on one side, crowding on the other
4. **Fix** — edit the JSON: widen containers, adjust `x`/`y`, add waypoints to
   arrow `points` arrays, resize elements for visual balance
5. **Re-render & re-view** — repeat from step 1

**Stop when:** no text is clipped, arrows connect correctly, spacing is balanced,
and you'd show this to someone without caveats. Usually takes 2–3 iterations.

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

- Large diagrams (50+ elements): build section by section, then combine — don't
  generate the entire file in one pass
- Arrow routing is manual — calculate coordinates explicitly; Excalidraw does not
  route around shapes automatically
- CDN dependency: the render step loads Excalidraw from unpkg.com and requires
  an internet connection

---

## Obsidian Storage

After producing output, optionally archive to the Neurons vault for long-term memory.
This is non-blocking — if Obsidian isn't running, skip and continue.

1. **Health check**:
   ```bash
   obsidian help
   ```
   If this fails: note "Vault storage skipped (Obsidian not running)" and finish normally.

2. **Determine topic slug**: convert the diagram topic to kebab-case
   (e.g. "API authentication options" → `api-authentication-options`)

3. **Write to vault**:
   ```bash
   obsidian create \
     --vault=Neurons \
     --path="shared/Architecture/<topic>/<YYYY-MM-DD>-<diagram-name>.excalidraw" \
     --content="<output-content>"
   ```
   Where `<output-content>` is the raw Excalidraw JSON.

4. **Confirm**: "✅ Saved to Neurons: shared/Architecture/<topic>/<YYYY-MM-DD>-<diagram-name>.excalidraw"
