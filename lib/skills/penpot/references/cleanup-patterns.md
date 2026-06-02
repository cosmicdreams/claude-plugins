# Cleanup Patterns — Non-Atomic `execute_code`

`mcp__penpot__execute_code` runs your script imperatively against the live design. There is **no rollback**. If a script creates three shapes and then throws on the fourth, the three created shapes remain on the canvas as orphans (typically at the page root, not parented into the group you intended).

This is the single most surprising difference from Figma's plugin API, which IS atomic.

## Orphan-safe construction pattern

Track every created shape in `storage` immediately, so a follow-up call can clean up cleanly even if the current script throws.

```js
storage.pending = storage.pending || [];

try {
  const face = penpot.createEllipse();
  storage.pending.push(face.id);
  face.name = "Face";
  face.resize(200, 200);
  face.fills = [{ fillColor: "#FFD93D", fillOpacity: 1 }];

  const smile = penpot.createPath();
  storage.pending.push(smile.id);
  smile.content = "M 0 0 Q 100 80 200 0";
  smile.fills = [];
  smile.strokes = [{ strokeColor: "#000000", strokeOpacity: 1, strokeWidth: 6, strokeStyle: "solid", strokeAlignment: "center" }];

  const group = penpot.group([face, smile]);
  group.name = "Smiley";

  // Success — promote pending IDs out of the danger list
  storage.pending = [];
  return { groupId: group.id, faceId: face.id, smileId: smile.id };
} catch (e) {
  // Let the exception propagate; storage.pending now holds orphans for the next call to clean up.
  throw e;
}
```

## Cleanup script (run after a failure)

```js
const ids = storage.pending || [];
const removed = [];
for (const id of ids) {
  const s = penpotUtils.findShapeById(id);
  if (s) { s.remove(); removed.push(id); }
}
storage.pending = [];
return { removed, remaining: penpot.root.children.map(c => ({ id: c.id, name: c.name, type: c.type })) };
```

## When `storage.pending` is empty (e.g. fresh agent, no tracking)

If you didn't track IDs and a script left orphans, list the page and remove by name/type/position:

```js
return penpot.root.children.map(c => ({
  id: c.id, name: c.name, type: c.type,
  x: c.x, y: c.y, w: c.width, h: c.height
}));
```

Then in a follow-up call, remove the specific IDs you've identified as orphans:

```js
const orphanIds = ["...", "..."]; // from previous listing
const removed = [];
for (const id of orphanIds) {
  const s = penpotUtils.findShapeById(id);
  if (s) { s.remove(); removed.push(id); }
}
return { removed };
```

## Why grouping doesn't save you

`penpot.group([a, b, c])` is the LAST operation in a typical "build then group" pattern. If anything between `createX()` and `penpot.group([...])` throws, the children exist at the page root with no group wrapping them. The shapes are real, named, and visible — they just aren't where you wanted them.

The fix is either:
1. Track IDs in `storage` as you create (preferred — see above), or
2. Build inside a pre-created `Board` so even a partial failure leaves children visibly contained.
