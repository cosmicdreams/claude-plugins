// Explicitly manual Claude-host fallback. No T3 tools or session cron required.
export const meta = {
  name: "ideas-funnel-pipeline",
  description: "Manual bounded funnel run using the shared single-writer contract",
  phases: [{ title: "manual-run" }],
};

if (!args.vault || !args.python || !args.config) throw new Error("Explicit vault, python and config paths required");
phase("manual-run");
// One coordinator keeps durable ownership across every model stage. Worker routing must
// use the current host's supported tools, not a hard-coded Workflow model.
const result = await agent(
  `Run a manual ideas-funnel daily pipeline for vault ${args.vault}; Python ${args.python}; config ${args.config}.
   Read the plugin skills/dispatch/SKILL.md and skills/delegate/SKILL.md first.
   Apply its daily caps, allowance freshness, single-writer durable ownership, recovery,
   and untrusted-input rules. Do not invoke T3 tools: this is the Claude-host fallback.
   Use the current host's permitted agent tools only if they expose the selected
   model and effort. Otherwise return a bounded manual packet and skip model work.
   Feed collection uses scripts/pull.py separately, before acquiring run ownership.
   Never register cron, create scheduled tasks, send notifications or install anything.
   Return the five-line report with actual outcomes; do not claim skipped work ran.`,
  { label: "manual-coordinator" }
);
log(JSON.stringify(result));
