# pstack borrow evaluations

Old-versus-new evaluations of the changes in #122, #123, #124 and cosmicdreams/tstack#2. Plan and results live outside the repository, in the maintainer's `plans/research-lab/` folder. These are the fixtures and runners, kept so a later version can be scored on the same set.

| Folder or file | Evaluation | Runs with |
| --- | --- | --- |
| `../experiment_harness/run_eval.py` | E2: broken harnesses replayed through `experiment_loop.py` | `run_eval.py --scripts <arm>/research-lab/skills/experiment/scripts` |
| `e2-agent/` | E2: an agent writes the methodology; `replay_trials.py` then applies planted trials | `run_arm.py`, then `replay_trials.py` |
| `e4-benchmark/` | E4: three benchmark traps (`setup.sh` generates `input.txt`) | `run_arm.py` with `lib` and `test-lab` arms |
| `e6-retro/` | E6: retro evidence pack with two enforceable lessons and one judgment call | `run_arm.py` with a `process-lab` arm |
| `e7-review/` | E7: review-loop on a branch with seeded bugs; `hidden/` holds the ground-truth tests (D3 needs rework, see results) | `run_arm.py` with a wrapper plugin holding the review-loop skill |
| `e1-interrogate/` | E1: 16 claims and `panel_headless.cjs`, which runs a version of `interrogate-panel.js` outside the Workflow tool | `node panel_headless.cjs <panel.js> <fixture.json> <out.json>` |
| `trigger_run.py` | E5: which skill a query triggers first | `trigger_run.py --evals <skill>/evals/trigger-evals.json --skill <name>` |

`run_arm.py` copies a task folder into a sandbox and runs headless `claude -p` there, with only the given plugin copies (the installed ones are disabled through `--settings`). It skips permission prompts so the agent can run benchmarks and git, so give it only throwaway task folders. An arm is a plugin folder extracted from a commit, for example `git archive <commit> lib | tar -x -C arms/old`.
