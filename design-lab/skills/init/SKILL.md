---
name: init
description: >
  Set design-lab up for the person and this machine, once: where runs live, their name for
  reports, the shared Playwright and its browser, the Python packages, the Figma runner, and
  the Claude Code settings that would otherwise make runs ask for approval. Run it the first
  time design-lab is used, and again whenever a run or preflight says setup is missing. Not
  for anything about one site (design-lab:run's preflight handles that).
---

# Set up design-lab

Everything here is about the person and this machine, and is settled once. Anything about one site or one run (its address, its fonts, its Figma file, its DDEV project) belongs to preflight in `design-lab:run`, never here.

The answers go into the person's design-lab settings (`~/.claude/design-lab.json`, or `DESIGN_LAB_CONFIG`), which are personal and never committed. Run folders are personal too, and never live inside a repository.

## Two rules

1. **Nothing is installed or changed without the person's approval.** Before any install or change, say what design-lab needs, why, what will be installed or changed and where, and ask. A refusal is respected: record nothing, say what will not work, and move on.
2. **A change to Claude Code's settings needs a new session.** After one, end with the exact steps to restart and the prompt to continue (below).

## Steps

Run every command with absolute paths, one command at a time; never `cd`, shell variables, loops or inline scripts. If Claude Code's read-blocking setting is on, it will ask the person to approve these commands until the Claude Code check below is settled; say so up front, so the first approvals are expected.

1. See where things stand. It changes nothing:

   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/lab_setup.py check --json
   ```

   Each check is `ok`, `missing` (design-lab cannot run until fixed) or `advice` (it works, with a cost the person should know). Each says how it is fixed and, in `needsApproval`, what fixing it installs or changes.

2. Work through every check that is not `ok`, in this order, asking with the question tool where there is a choice:

   - **Where runs live** (`runs`). Ask which convention:
     - **Next to each project** (`project`): runs go in `PROJECT/design/<date>`, where PROJECT is the folder above `worktrees/` for code checked out as `PROJECT/worktrees/<name>`, or else the nearest folder above the repository that holds `plans/`, `analysis-reports/` or `design/`. Recommend it when the current folder is laid out that way.
     - **One folder for everything** (`home`): `~/.design/<project>/<date>`. The simple choice for anyone else.

     Then `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/lab_setup.py set runs project` (or `home`).
   - **This project's runs folder** (`project`), when the session is in a project. If the folder the check names does not exist yet, create it now, so every later run, and the pane, finds it without being told: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/lab_setup.py runs-folder --create`. It is never inside a repository, so nothing in it can be committed, and every run lands in its own dated folder there.
   - **Node.js** (`node`). If missing, say capture runs Playwright through node, and ask before installing it (for example `brew install node`). Without it, capture cannot run.
   - **Playwright and its Chromium** (`playwright`). Say that capture measures and photographs each component in a real browser through Playwright, that design-lab keeps one shared copy for every site so no site needs its own, and what `needsApproval` says it downloads and where. Ask; on approval run `lab_setup.py install playwright`, which records the folder as capture's default.
   - **Python packages** (`python`). Say which are missing and what they are for (`cairosvg` turns a site's SVG images into pictures Figma accepts; Pillow reads and writes images), and what `needsApproval` says. Ask; on approval run `lab_setup.py install python`.
   - **The Figma runner** (`runner`). Run `lab_setup.py runner`: it copies the runner into design-lab's own folder and makes sure the person's runner token exists, without ever showing it. Then give the person the one-time import, which only they can do: in Figma **desktop** (the browser app cannot load development plugins), open any design file, then Plugins, Development, Import plugin from manifest, and choose the `manifest` path the check reported. When the runner first asks for a token, they copy it in their own terminal with `pbcopy < ~/.design-lab/runner-token`; never read, print, copy or paste the token yourself. Ask whether the import is done; when it is, run `lab_setup.py runner --imported`.
   - **Claude Code runs design-lab without asking** (`claude-settings`). If Claude Code's read-blocking setting is on, explain: with it, Claude Code makes the person approve every command that names a folder outside the session's own, even with permission checks bypassed, and design-lab's scripts and run folders are both outside it. Runs cannot go unattended until that is settled. Claude Code offers the setting once, in a one-time prompt, which is how it usually gets turned on. Offer two fixes and ask which:
     - **Allow design-lab's folders** (recommended: the protection stays for everything else). For the `project` convention, ask which folders the person keeps projects in (for example `~/Sites`), then run `lab_setup.py claude-settings --allow-folders <folder> [<folder> ...]`; for `home`, run it with no folders. It adds design-lab's installed folder and the runs folders to `permissions.additionalDirectories`.
     - **Turn the setting off**: `lab_setup.py claude-settings --allow-reads`.

     Either way, finish with the restart steps below.
   - **The pane** (`pane`) and **DDEV** (`ddev`) are advice only: say what they mean (the pane that shows a run's progress beside the conversation needs a newer Claude Code; without DDEV a database-backed site builds without usage tiers) and move on.
   - **Scoreboard and corpus** (`evaluation`) are optional. Mention them only if the person wants runs kept in a ledger across sites; if so, ask for the three paths and run `lab_setup.py set evaluation <corpus> <ledger> <dashboard>`.

3. Run the check again and show the result as a short list: each item, ok or what is still to do.

## Restart, when Claude Code's settings changed

Settings are read when a session starts, so the change applies only to new sessions. End with exactly:

1. End this session (`/exit`).
2. Start a new one in the project's folder, for example `cd <project folder> && claude`.
3. To continue an unfinished run there, send: `Continue the design-lab run from where it stopped.` To start a new one, send the opening prompt from `references/benchmark.md`.
4. The design-lab pane opens beside the conversation by itself when `design-lab:run` or `design-lab:figma-build` starts. `/design-lab:watch` opens it again after it is closed.
