export const meta = {
  name: "sprint-run",
  description: "Vertical slice pipeline: one slice-worker per bead, optional cross-review stage.",
  phases: ["load-beads", "slice-workers", "cross-review", "write-results"],
};

const DDEV_CAP = 3;

const sliceWorkerSchema = {
  type: "object",
  required: ["bead_id", "outcome", "files_touched", "test_results", "retro_interview"],
  properties: {
    bead_id: { type: "string" },
    outcome: { type: "string", enum: ["completed", "escalated", "failed"] },
    files_touched: { type: "array", items: { type: "string" } },
    test_results: {
      type: "object",
      properties: {
        phpcs: { type: "string", enum: ["clean", "errors", "skipped"] },
        phpstan: { type: "string", enum: ["clean", "errors", "skipped"] },
        phpunit: { type: "string", enum: ["passing", "failing", "skipped"] },
      },
    },
    retro_interview: {
      type: "object",
      required: ["what_worked", "what_didnt", "technical_insight", "one_change"],
      properties: {
        what_worked: { type: "string" },
        what_didnt: { type: "string" },
        technical_insight: { type: "string" },
        one_change: {
          type: "object",
          required: ["change", "category", "expected_impact"],
          properties: {
            change: { type: "string" },
            category: {
              type: "string",
              enum: ["TOOLING", "COMMUNICATION", "TESTING", "WORKFLOW", "INFRASTRUCTURE"],
            },
            expected_impact: { type: "string" },
          },
        },
        key_decision: { type: "string" },
        cross_issue_pattern: { type: "string" },
        workflow_friction: { type: "string" },
      },
    },
  },
};

const crossReviewSchema = {
  type: "object",
  required: ["bead_id", "verdict", "evidence"],
  properties: {
    bead_id: { type: "string" },
    verdict: { type: "string", enum: ["approved", "rejected"] },
    evidence: { type: "string" },
    retro_interview: {
      type: "object",
      required: ["what_worked", "what_didnt", "technical_insight", "one_change"],
      properties: {
        what_worked: { type: "string" },
        what_didnt: { type: "string" },
        technical_insight: { type: "string" },
        one_change: {
          type: "object",
          required: ["change", "category", "expected_impact"],
          properties: {
            change: { type: "string" },
            category: {
              type: "string",
              enum: ["TOOLING", "COMMUNICATION", "TESTING", "WORKFLOW", "INFRASTRUCTURE"],
            },
            expected_impact: { type: "string" },
          },
        },
        failure_root_cause: { type: "string" },
        handoff_quality: {
          type: "string",
          enum: ["CLEAN", "MINOR_GAPS", "SIGNIFICANT_REWORK", "BLOCKED"],
        },
        infrastructure_friction: { type: "string" },
      },
    },
  },
};

function buildSlicePrompt(bead) {
  return `You are a slice-worker in a team sprint. Own this bead end-to-end.

Bead ID: ${bead.id}
Title: ${bead.title}

Steps:
1. export BD_ACTOR=slice-${bead.id}
2. bd show ${bead.id} --json   (read full card)
3. bd update ${bead.id} --claim --add-label lane-in-progress
4. Analyze root cause, implement fix, write failing test first, then passing.
5. Static analysis: command -v rtk >/dev/null && rtk ddev exec vendor/bin/phpcs --standard=Drupal,DrupalPractice <files> || ddev exec vendor/bin/phpcs --standard=Drupal,DrupalPractice <files>
6. phpunit via DDEV (the Workflow script batches DDEV items at ≤${DDEV_CAP} concurrent — no additional slot claiming needed). Run: ddev exec vendor/bin/phpunit <test>. Stop DDEV when done: ddev stop.
7. SUMMARY: bd update ${bead.id} --append-notes "SUMMARY: <what was fixed> / <ACs: ...>"
8. cross-review-yes label: bd update ${bead.id} --status open --assignee "" --remove-label lane-in-progress --add-label lane-needs-cross-review
   cross-review-no: bd close ${bead.id} --reason "All phases complete."

Emit structured JSON matching the slice-worker schema. Populate retro_interview from your session experience.
For verbose commands use rtk when present: command -v rtk >/dev/null && rtk <cmd> || <cmd>`;
}

function buildReviewPrompt(sliceResult) {
  return `You are a cross-reviewer. Verify slice-worker output for bead ${sliceResult.bead_id}.

Bead ID: ${sliceResult.bead_id}
Slice outcome: ${sliceResult.outcome}
Files touched: ${(sliceResult.files_touched || []).join(", ")}
Slice test results: ${JSON.stringify(sliceResult.test_results)}

Steps:
1. export BD_ACTOR=reviewer-${sliceResult.bead_id}
2. bd update ${sliceResult.bead_id} --claim --remove-label lane-needs-cross-review --add-label lane-cross-reviewing
3. Read the diff in the slice-worker's worktree.
4. Run quality gates independently. Use rtk when present: command -v rtk >/dev/null && rtk <cmd> || <cmd>
5. Check: correctness, test quality (no test theater), no stubs or hardcoded values.
6. APPROVED: bd close ${sliceResult.bead_id} --reason "Cross-review passed."
   REJECTED: bd update ${sliceResult.bead_id} --status open --assignee "" --remove-label lane-cross-reviewing --add-label lane-in-progress
7. Populate retro_interview from your session experience.

Emit structured JSON matching the cross-reviewer schema. Include file:line evidence for any rejection.`;
}

phase("load-beads");
log("Reading ready beads from board...");

const beadsRaw = await agent(
  'Run: bd ready -l board-sprint --json --unassigned 2>/dev/null || echo "[]"\nReturn only the raw JSON array, nothing else.',
  { label: "read-beads", phase: "load-beads" }
);

let beads = [];
try {
  beads = JSON.parse(beadsRaw);
} catch (_) {
  beads = [];
}

if (beads.length === 0) {
  log("No ready beads found. Nothing to run.");
  return { beads: [], results: [], reviews: [] };
}
log(`Found ${beads.length} ready bead(s).`);

const ddevBeads = beads.filter((b) => (b.labels || []).some((l) => l === "ddev" || l === "ddev=true"));
const nonDdevBeads = beads.filter((b) => !(b.labels || []).some((l) => l === "ddev" || l === "ddev=true"));

phase("slice-workers");
log("Launching slice-workers...");

const allSliceResults = [];

if (nonDdevBeads.length > 0) {
  const nonDdevResults = await parallel(
    nonDdevBeads.map((bead) => () =>
      agent(buildSlicePrompt(bead), {
        label: `slice-${bead.id}`,
        phase: "slice-workers",
        schema: sliceWorkerSchema,
        agentType: "sprint:slice-worker",
      })
    )
  );
  allSliceResults.push(...nonDdevResults.filter(Boolean));
}

for (let i = 0; i < ddevBeads.length; i += DDEV_CAP) {
  const chunk = ddevBeads.slice(i, i + DDEV_CAP);
  log(`DDEV batch ${Math.floor(i / DDEV_CAP) + 1}: ${chunk.length} bead(s)...`);
  const chunkResults = await parallel(
    chunk.map((bead) => () =>
      agent(buildSlicePrompt(bead), {
        label: `slice-${bead.id}`,
        phase: "slice-workers",
        schema: sliceWorkerSchema,
        agentType: "sprint:slice-worker",
      })
    )
  );
  allSliceResults.push(...chunkResults.filter(Boolean));
}

phase("cross-review");
const needsReview = allSliceResults.filter((r) =>
  r &&
  r.outcome === "completed" &&
  beads.find((b) => b.id === r.bead_id && (b.labels || []).includes("cross-review-yes"))
);

let reviewResults = [];
if (needsReview.length > 0) {
  log(`Cross-reviewing ${needsReview.length} bead(s)...`);
  reviewResults = (
    await parallel(
      needsReview.map((sliceResult) => () =>
        agent(buildReviewPrompt(sliceResult), {
          label: `review-${sliceResult.bead_id}`,
          phase: "cross-review",
          schema: crossReviewSchema,
          agentType: "sprint:cross-reviewer",
        })
      )
    )
  ).filter(Boolean);
} else {
  log("No beads require cross-review.");
}

phase("write-results");
const sprintDate = args.sprint_date || "unknown-date";
const sprintName = args.sprint_name || "unnamed-sprint";
const outDir = `analysis-reports/retro-session/${sprintDate}+${sprintName}`;

const output = {
  sprint_date: sprintDate,
  sprint_name: sprintName,
  beads: beads.map((b) => b.id),
  results: allSliceResults,
  reviews: reviewResults,
};

await agent(
  `Run these shell commands:
mkdir -p "${outDir}"
cat > "${outDir}/results.json" << 'ENDJSON'
${JSON.stringify(output, null, 2)}
ENDJSON
echo "Written."`,
  { label: "write-results", phase: "write-results" }
);

log(`Results written to ${outDir}/results.json`);
return output;
