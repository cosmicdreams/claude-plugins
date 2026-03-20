# Excalidraw JSON Reference

## File header

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

## Element types

| Type | Use for |
|---|---|
| `rectangle` | Processes, components, steps |
| `ellipse` | Start/end points, external systems |
| `diamond` | Decisions, conditionals |
| `arrow` | Directional relationships |
| `line` | Non-directional connections |
| `text` | Labels, annotations, evidence |
| `frame` | Section grouping |

## Standard element properties (apply to all elements)

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

**Always use `roughness: 0` and `opacity: 100`.** Create hierarchy through color, size, and stroke width — never through opacity.

## Text elements

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

## Arrow elements

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

## Color palette (semantic roles)

| Role | Color |
|---|---|
| Primary action / highlight | `#cba6f7` (mauve) |
| Secondary / supporting | `#89dceb` (sky) |
| Warning / caution | `#f9e2af` (yellow) |
| Success / positive | `#a6e3a1` (green) |
| Negative / risk | `#f38ba8` (red) |
| Neutral / background | `#eff1f5` (surface) |
| Text / stroke | `#1e1e2e` (base) |
