---
name: penpot
description: >
  Create, edit, delete, export, or inspect Penpot designs — shapes, boards, components,
  tokens, libraries — through the Penpot MCP server. Not for Figma; use figma-use.
allowed-tools: mcp__penpot__high_level_overview, mcp__penpot__execute_code, mcp__penpot__penpot_api_info, mcp__penpot__export_shape, Read
---

# lib:penpot — Penpot Plugin API Skill

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Drive the Penpot MCP server to inspect or modify Penpot design files via the Plugin API. Use whenever creating, editing, deleting, exporting, or programmatically inspecting Penpot shapes, boards, components, tokens, or libraries through mcp__penpot__* tools. Trigger phrases include "create in penpot", "edit penpot design", "add to penpot", "build penpot component", "penpot tokens", "penpot board", "draw in penpot", "modify penpot file", "screenshot penpot shape", "penpot library". Do NOT use for Figma work (use figma-use), Penpot account/server setup, or for reading static Penpot exports already on disk.

Drive the Penpot MCP server (`mcp__penpot__*`) to inspect and modify a connected Penpot design file. The user's Penpot instance must be running with the MCP plugin connected — this skill assumes the connection exists.

## 1. Critical Rules

1. **Call `high_level_overview` exactly once per session, before the first `execute_code`.** It returns the API contract you must work against. Do NOT call it again after the first read.
2. **`execute_code` is NOT atomic.** If a script throws mid-way, shapes already created BEFORE the throw remain on the canvas as orphans. Always (a) collect created shape IDs into `storage` as you go, and (b) on failure, re-list `penpot.root.children` and remove orphans before retrying. See [cleanup-patterns.md](references/cleanup-patterns.md).
3. **Fills, strokes, shadows arrays are read-only contents.** You cannot mutate `shape.fills[0].fillColor`. Reassign the whole array: `shape.fills = [{ fillColor: "#FF5533", fillOpacity: 1 }]`.
4. **`width` and `height` are read-only.** Use `shape.resize(w, h)` to change dimensions. Setting `x`/`y` directly is fine — those are writable.
5. **Hex colors must be uppercase**: `"#FF5533"`, not `"#ff5533"`.
6. **`parentX` / `parentY` are read-only.** To position relative to parent, use `penpotUtils.setParentXY(shape, px, py)`.
7. **Path shapes use SVG `d` strings, not command objects.** Set `path.content = "M 0 0 Q 50 100 100 0"`. Setting `path.content` to an array of `{command, params}` objects throws `Value not valid`.
8. **Inspect before creating.** Run a read-only `execute_code` first to list pages, boards, and existing shapes (`penpot.root.children`, `penpotUtils.shapeStructure(page.root, 3)`). Match existing naming conventions.
9. **Return IDs from every mutating call.** `return { groupId, shapeIds: [...] }`. These are your cleanup handles and the inputs for follow-up scripts.
10. **Never `console.log` data you are also returning** — Penpot returns logs separately, so you'll receive the payload twice and burn context.
11. **Use `storage` for cross-call state.** It's the only object that persists between `execute_code` invocations. Store shape references, utility functions, and intermediate results there.
12. **Prefer `penpotUtils` helpers** over hand-rolled traversal: `findShapeById`, `findShape(predicate)`, `findShapes(predicate)`, `shapeStructure`, `analyzeDescendants`, `setParentXY`, `getPageByName`, `tokenOverview`, `findTokenByName`.

## 2. Workflow

Work in small, validated steps. Bugs compound when you try to build a screen in one script.

```
Step 1: high_level_overview       (once per session)
Step 2: inspect                   (read-only execute_code — pages, boards, existing shapes)
Step 3: create/edit               (one logical unit per call; return IDs)
Step 4: export_shape              (visually verify each major milestone)
Step 5: cleanup if needed         (remove orphans from any failed call)
```

After each mutating call:
- Confirm IDs returned match what you expected
- For visual work, call `export_shape` on the affected board/group with `format: "png"`
- For structural work, re-run `penpotUtils.shapeStructure` on the parent to verify hierarchy

## 3. Recovering From a Failed `execute_code`

Penpot does not roll back partial scripts. When a call throws:

1. **STOP.** Do not blindly retry the same script — you will create duplicates.
2. **List the page**: `return penpot.root.children.map(c => ({id, name, type}))`.
3. **Identify orphans** — shapes from the failed run that weren't grouped/parented as intended.
4. **Remove them**: `penpotUtils.findShapeById(id).remove()` for each orphan.
5. **Fix the script** based on the error message.
6. **Retry** the corrected version.

Full pattern and example: [cleanup-patterns.md](references/cleanup-patterns.md).

## 4. Looking Up API Details

The high-level overview covers ~80% of common shape/board/layout/token work. For anything specific:

- `penpot_api_info(type: "Path")` — full interface of a type
- `penpot_api_info(type: "Text", member: "applyTypography")` — single member detail

Always check `penpot_api_info` before guessing a method signature.

## 5. Pre-Flight Checklist

Before submitting a mutating `execute_code` call, verify:

- [ ] `high_level_overview` already called this session
- [ ] Inspected current page state at least once
- [ ] Colors are uppercase hex
- [ ] No mutation of `shape.fills[i]` — entire array reassigned
- [ ] `width`/`height` set via `resize()`, not direct assignment
- [ ] Position relative to parent uses `penpotUtils.setParentXY`, not `parentX`/`parentY` assignment
- [ ] Path `content` is an SVG `d` string
- [ ] All created/mutated IDs are collected and `return`ed
- [ ] No `console.log` of returned data
- [ ] If a previous call failed, orphans cleaned up first

## Resources in this skill

- `references/cleanup-patterns.md` — non-atomic failure recovery; read whenever `execute_code` throws or when a multi-shape build needs orphan-safe construction
- `references/gotchas.md` — wrong/right snippets for each Critical Rule; read when an `execute_code` error message matches one of the listed patterns
