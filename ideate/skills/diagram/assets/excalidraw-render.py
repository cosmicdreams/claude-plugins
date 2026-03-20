#!/usr/bin/env python3
"""
Wraps an .excalidraw file in a self-contained HTML page for screenshot rendering.

Usage:
    python3 excalidraw-render.py <input.excalidraw> <output.html>

Then screenshot with:
    playwright-cli screenshot "file://<output.html>" preview.png --wait-for-timeout 4000
"""

import json
import sys

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

print(f"Render HTML written to: {outfile}")
