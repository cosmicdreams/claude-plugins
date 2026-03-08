# Changelog

## 2.1.0
- All four skills (brainstorm, diagram, compare, research) now archive output to the Neurons Obsidian vault after completing
- Vault paths: `shared/Decisions/`, `shared/Architecture/`, `shared/Analysis/`, `shared/Research/` respectively
- Storage is non-blocking — if Obsidian is not running, vault step is skipped cleanly

## 2.0.0
- Add `ideate:changelog` skill — displays ideate CHANGELOG with `--latest` and `--since X.Y.Z` filtering
- Add trigger evals and improved description for `ideate:compare`

## 1.1.0
- Add `ideate:diagram` skill — generate Excalidraw diagrams from natural language; produces `.excalidraw` JSON files
- Add `ideate:reality-check` skill — adversarial scrutiny of brainstormed ideas via a hard-gate KILL funnel
- Add `ideate:research` skill — research a topic using NotebookLM before brainstorming; chains into `ideate:brainstorm`

## 1.0.0
- Initial release — renamed from `brainstorm` plugin; ideate is now the pre-work ideation bounded context
- Skills: brainstorm (visual decision canvas: generate → annotate → synthesize)
- Updated cache path references from brainstorm/ to ideate/
