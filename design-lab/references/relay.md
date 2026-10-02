# Relaying a build to Figma

## Preferred: the runner plugin (no model in the loop)

`design-lab/runner/` is a Figma development plugin that fetches each step from this machine, runs it in the open file, and posts the result back. No model retypes a payload, so a build costs no tokens and cannot be corrupted in transit.

1. Once per machine: Figma desktop → Plugins → Development → Import plugin from manifest → `~/.design-lab/runner/manifest.json` (see Installing the runner below). Preflight copies the current runner there, so later design-lab versions only refresh those files: close the runner and start it again to load the new code, with no new import. The runner sends its version with every request, and a runner older than the plugin is told to restart.
2. Preflight starts the server (`workflow.py preflight`, or `figma_runner.py start --project <W>` on its own). It runs detached from the command that started it, in its own session, with its process id in `W/figma/runner.pid` and its output in `W/figma/runner-server.log`, and it keeps serving until the build is done. `workflow.py runner --project <W>` says whether the server is alive; `--ensure` starts it again if it is not, and `--await-runner` also checks that the runner has asked for a step recently. A server serves exactly one run, and design-lab builds one library at a time: a second run's server is refused while one is active (`figma_runner.py stop --project <W>` stops a run's server).
3. Open the target file in Figma desktop → Plugins → Development → design-lab runner. The first time on a machine, the plugin asks for the token: the person's own, in `~/.design-lab/runner-token` (copy it with `pbcopy < ~/.design-lab/runner-token`). It keeps it, and every server reads the same file, so it is never asked for again unless the file is replaced. The token's only job is to stop a web page in the person's browser from talking to the local server: the server answers only requests carrying it, and only from a plugin's origin. It is never written into a run or a log, and Claude never reads, prints or copies it: the person copies it in their own terminal, and the scripts read the file themselves.
4. The plugin stays open. Before the build has steps it shows "Connected. Waiting for the build to start." and asks again every 5 seconds. At preflight it runs the handshake: it confirms the open file is the target and is empty (or holds only this run's preflight Cover), turns the first page into the Cover page, and draws a name-only Cover there with the real `cover.js`, so the connection, page creation, the Cover's font, writing and plugin data are all proved before the run is left to itself. The build later fills in that same Cover. If the server stops answering, the plugin keeps retrying rather than quitting.
5. The plugin runs to the end of the build, then closes. A failed step is logged to `W/figma/runner.log` with its message and stack, and is not recorded; the plugin stays open and the server answers "wait" until a fix lands. Fix the cause in the templates or rules, then re-run `figma_build.py init` (a template fix) or restart the server with `figma_runner.py stop` and `workflow.py runner --ensure` (a server fix): the build resumes from that step with nobody in Figma. An upload step fails if any one of its images does not reach Figma. A failed preflight check still closes the plugin, because preflight reports it to the person.

## Installing the runner

When asked how to install the runner, answer with these steps and nothing else, filling in real paths rather than placeholders:

1. The runner is imported from the stable folder `~/.design-lab/runner/`, which preflight fills from the plugin's `runner/` folder (`figma_runner.py` `install_runner`). Resolve the absolute path of `~/.design-lab/runner/manifest.json` and confirm the file exists before giving it; if it does not, run preflight, or `python3 -c "import sys; sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}/scripts'); import figma_runner; print(figma_runner.install_runner())"`.
2. Figma **desktop** (the browser app cannot load development plugins) → any design file → Plugins → Development → Import plugin from manifest → choose that file. It then appears as "design-lab runner" under Plugins → Development.
3. The import points at that exact path, which does not change between versions, so a design-lab update needs only a restart of the runner, never a new import.
4. Check it: run preflight, then start the plugin in the target file and paste the token from `~/.design-lab/runner-token` if it asks. The plugin's panel says it is connected, and a `serving preflight:check` line in `W/figma/runner.log` confirms it. The plugin can reach only `http://localhost:8765`, which is the only port the server listens on.

## Fallback: a model relays

When the runner cannot be used, `scripts/figma_build.py` decides everything and the agent relays. The loop, until `next` says done:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/figma_build.py next --project <W>
```

| `kind` | Do |
|---|---|
| `use_figma` | Read the `payload` file and pass its **entire contents, unchanged,** as `code` to `use_figma` (with the file key from `W/figma/state.json`). Write the returned JSON to `W/figma/inbox.json`, then `figma_build.py record --project <W> --step <step> --result W/figma/inbox.json`. |
| `upload` | Call `upload_assets` with `count` = number of `nodeIds`, those `nodeIds` in order, and `scaleMode`. POST each file to the matching URL: `curl -s -X POST -H "Content-Type: <contentType>" --data-binary @<file> "<url>" -w " %{http_code}"` (quote the URL). Write `{"statuses": [...]}` to the inbox and record it. |
| `screenshot` | Call `get_screenshot` for `nodeId` with `maxDimension`, download it with `curl -sL -o <out> "<url>"`, write `{"file": "<out>"}` to the inbox and record it. Recording runs the visual comparison. |
| `skip` | Record the step with no `--result`. |
| `done` | Stop. |

Rules:

- **Never edit a payload.** Each is ordinary JavaScript generated by the plugin: the step's arguments, a checksum over them, then the template code. `altered in transit` means a character changed on the way — read the file again and resend. `next` refuses to run if the templates changed since `init`; stop and report.
- **Never record a failed step.** `record` refuses a result without the identifiers the next steps need. Report the error verbatim and stop; the build resumes from the same step next time.
- **Make no design decisions.** If something looks wrong, report it. The fix belongs in the templates or the layout rules, where it fixes every future run, not in this file by hand.
- Load the official Figma-use skill before the first `use_figma` call.
