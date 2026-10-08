---
name: figma-build
description: >
  Build an earlier design-lab run's capture and plan into a new, empty Figma file, as a new run
  with its own pane, verification and report: minutes, where a fresh capture takes hours. Use to
  rebuild a library into a fresh file, after a design-lab update or to show the build. Not for
  capturing or planning a site (design-lab:run), one component (design-lab:figma-component), or
  checking a built file (design-lab:verify).
---

# Build an earlier run into a new Figma file

A run's capture and plan are the slow part: hours in a browser. The build that turns them into a Figma library takes minutes. This skill starts a new run from an earlier run's capture and plan and builds it into a new, empty file, with the current design-lab's templates. The earlier run and its Figma file are left exactly as they were.

The new run lives beside the others, in this project's runs folder, so everything that follows a run follows this one: the design-lab pane opens beside the conversation by itself as this skill starts and shows the new run as soon as its folder exists (never tell the person to open it; `/design-lab:watch` reopens it if they closed it), and the run ends with the same verification, report and completion message as `design-lab:run`.

## Commands that never need approval

Keep to commands Claude Code can check: every script with absolute paths and `--project <run folder>`, one command at a time. Never `cd`, never assign shell variables, never write loops or `node -c` scripts.

## Before anything else

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/require-node.mjs && node ${CLAUDE_PLUGIN_ROOT}/scripts/lab_setup.ts check
```

If anything is `missing` (✗), stop and run `design-lab:init` first, then continue.

## Ask once

Two answers, in one message, using what the request already says:

- **Which run to build.** The run the person names, or else this project's newest finished run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts runs --finished` (from the project or repository folder) lists them newest first. Say which run it is (site and date) in the same message.
- **The new Figma file.** The address of a new, empty design file the person's account can edit. Never the earlier run's own file.

## Start the new run

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts figma-build --from <earlier run folder> \
  --figma-url <new file address> --repo <absolute repository path> [--model <model>]
```

It refuses an earlier run whose capture or plan is missing or was never approved, and the earlier run's own file, and says why; give the person that reason and stop. Otherwise it prints the new run folder (`<run folder>` from here on) and, under `next`, the exact commands that build it. Run them in that order, as printed:

1. **Connect the runner.** Run `workflow.ts connect` in the background and pass its instructions to the person as soon as they print: open the new file in Figma desktop and start the design-lab runner. This is the one wait for the person. If the runner asks for a token, the person copies it in their own terminal with `pbcopy < ~/.design-lab/runner-token`; never read, print, copy or paste the token yourself. With exit 0, pass on the font lines it printed and go on. With exit 1, reply with the message it printed and run it again once that is fixed.
2. **Plan the build** with the `figma_build.ts init` command as printed. It needs no local site: the images come from the earlier run's capture.
3. **Wait for the build.** Run `workflow.ts await-build` in the background and wait for it to exit, without polling; the pane shows the steps meanwhile. With exit 1 it has recorded the stop, stopped the runner server and printed what is needed first, then why: reply with that, and once it is done run `await-build` again, which starts the server afresh; the build continues from the step that stopped it.
4. **Verify and score.** Run `workflow.ts finish` as printed. Verification findings do not stop it; they are in the report.

Never edit the Figma file by hand and make no design decisions: a problem belongs in design-lab's templates or rules, and the place to fix it is a new design-lab release, not this file.

## Reply

Reply with the contents of `<run folder>/benchmark/completion.md` exactly, then one line saying this run rebuilt the earlier run's capture and plan (name it), so its accuracy is the earlier capture's.
