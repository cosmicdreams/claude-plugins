# Penpot Gotchas — Wrong vs. Right

Each gotcha matches a Critical Rule in SKILL.md. The error messages here are the exact strings Penpot returns.

## 1. Path `content` as command objects

**Error:** `Value not valid: [object Object],[object Object]. Code: :content`

```js
// WRONG — passes command objects
path.content = [
  { command: "move-to", params: { x: 0, y: 0 } },
  { command: "curve-to", params: { x: 200, y: 0, c1x: 50, c1y: 100, c2x: 150, c2y: 100 } }
];

// RIGHT — SVG `d` string
path.content = "M 0 0 C 50 100 150 100 200 0";
```

`commands` (the array form) is read-only. To compose programmatically, build a string:

```js
const d = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
path.content = d;
```

## 2. Mutating fills in place

**Error:** silent — assignment appears to succeed but does not persist.

```js
// WRONG
shape.fills[0].fillColor = "#FF0000";

// RIGHT
shape.fills = [{ fillColor: "#FF0000", fillOpacity: 1 }];

// Copying from another shape
target.fills = source.fills;  // creates new objects, safe to modify on target
```

## 3. Setting `width` / `height` directly

**Error:** silent no-op or `Cannot set property width of #<Object>`.

```js
// WRONG
shape.width = 300;
shape.height = 200;

// RIGHT
shape.resize(300, 200);
```

For `Text`, `resize()` also sets `growType` to `"fixed"` — overflow becomes possible. If you want auto-sizing back:

```js
text.resize(300, 100);
text.growType = "auto-height";
```

## 4. Lowercase hex colors

**Error:** typically rejected as invalid color value.

```js
// WRONG
shape.fills = [{ fillColor: "#ff5533", fillOpacity: 1 }];

// RIGHT
shape.fills = [{ fillColor: "#FF5533", fillOpacity: 1 }];
```

## 5. Setting `parentX` / `parentY`

**Error:** silent — read-only.

```js
// WRONG
child.parentX = 20;
child.parentY = 40;

// RIGHT
penpotUtils.setParentXY(child, 20, 40);
```

## 6. Returning data also logged via `console.log`

**Symptom:** duplicate payload in tool output, context bloat.

```js
// WRONG
const result = { ids: [...] };
console.log(result);
return result;

// RIGHT
return { ids: [...] };
```

Use `console.log` ONLY for diagnostics that are not part of the return value.

## 7. Skipping `high_level_overview`

**Error:** none — but the agent flies blind on API surface and structure, leading to invalid calls.

Always read the overview once per session before the first `execute_code`. After that, do not call it again.

## 8. Re-running a failed creation script

**Symptom:** duplicate shapes on the canvas.

```js
// FIRST CALL — throws on shape #4, shapes #1-3 remain as orphans
// SECOND CALL (same script) — creates shapes #1'-#4', leaving #1-3 + #1'-#4'
```

See `cleanup-patterns.md`. Always clean up orphans before retrying.

## 9. Assuming `figma.currentPage`-style page context

Penpot uses `penpot.root` for the **currently active page**. To work on a different page:

```js
const page = penpotUtils.getPageByName("My Page");
// All subsequent operations should use `page.root` or `page`-scoped lookups.
// Note: there is no required "switch" call; operate on the page reference directly.
```

## 10. `remove()` on a component descendant

`shape.remove()` permanently deletes most shapes — but if the shape is a descendant of a board that is a component (asset), `remove()` instead makes it **invisible**. The shape still exists. Use `hidden = true` if invisibility is what you want, and accept that "removing" inside a component asset is not deletion.
