# Moving a gate from observe to enforce

Enforcement that is wrong even occasionally gets the plugin uninstalled by the whole team, and it does not come back. So every project starts in `observe` mode and moves forward only on evidence from the ledger.

| Stage | Behavior | Move forward when |
| --- | --- | --- |
| observe | Record crossings, failed checks, and obligations. Mention them. Never block. | The discharge rate for a gate is known and the skip reasons are understood. |
| warn | Same, and `process-lab:lint` treats open obligations as problems to fix now. | Skips have become rare and every remaining one has a waiver reason. |
| enforce | Pre-command checks refuse the command with the reason. | The team agrees, in the retro, and the page says so. |

`mode` in the manifest is per project. Moving back is always allowed and needs no evidence: if an enforced check misfires, set the project to `observe` first and investigate second.

A waiver is not a failure. It is a recorded reason the process did not fit, and repeated reasons are the raw material for `process-lab:codify`.
