export const meta = {
  name: "ideas-funnel-pipeline",
  description: "Daily ideas funnel: Fable supervision → bounded worker ingest → Refinery → lint/decay/rescue/stats",
  phases: ["supervise", "ingest", "threshold-check", "refinery", "lint", "decay", "rescue", "stats"],
};

const VAULT = args.vault || "~/Vaults/Neurons";
const CONFIG = args.config || "~/.config/ideas-funnel/domains";

const supervisorSchema = {
  type: "object",
  required: ["run_ingest", "domains", "max_items_per_domain", "run_refinery", "run_lint", "run_decay", "run_rescue", "budget"],
  properties: {
    run_ingest: { type: "boolean" },
    domains: { type: "array", items: { type: "string" } },
    max_items_per_domain: { type: "number" },
    priority_terms: { type: "array", items: { type: "string" } },
    run_refinery: { type: "boolean" },
    run_lint: { type: "boolean" },
    run_decay: { type: "boolean" },
    run_rescue: { type: "boolean" },
    budget: {
      type: "object",
      properties: {
        max_worker_tasks: { type: "number" },
        max_expensive_tasks: { type: "number" },
        preferred_worker_model: { type: "string" },
        cheap_worker_model: { type: "string" },
      },
    },
    unknowns: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
};

const domainIngestSchema = {
  type: "object",
  required: ["domain", "sources_processed", "concepts_new", "concepts_updated", "density_signals"],
  properties: {
    domain: { type: "string" },
    sources_processed: { type: "number" },
    concepts_new: { type: "number" },
    concepts_updated: { type: "number" },
    entities_new: { type: "number" },
    entities_updated: { type: "number" },
    density_signals: {
      type: "array",
      items: {
        type: "object",
        required: ["concept", "source_count"],
        properties: {
          concept: { type: "string" },
          source_count: { type: "number" },
        },
      },
    },
    error: { type: "string" },
    routed_tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task: { type: "string" },
          route: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};

const refinerySchema = {
  type: "object",
  required: ["concepts_promoted", "bridges_created", "conflicts_detected"],
  properties: {
    concepts_promoted: { type: "number" },
    bridges_created: { type: "number" },
    conflicts_detected: { type: "number" },
    pages_written: { type: "array", items: { type: "string" } },
  },
};

const maintenanceSchema = {
  type: "object",
  properties: {
    errors: { type: "number" },
    warnings: { type: "number" },
    pages_touched: { type: "number" },
    state_changes: { type: "number" },
    rescued: { type: "number" },
    summary: { type: "string" },
  },
};

phase("supervise");
log(`Vault: ${VAULT}`);

const supervisorPlan = await agent(
  `You are Fable supervising the ideas-funnel plugin.
   Vault: ${VAULT}
   Config: ${CONFIG}

   Follow \${CLAUDE_PLUGIN_ROOT}/skills/supervise/SKILL.md.
   Read the current funnel health, recent daily notes, stats, conflicts,
   Raw/.manifest.json, and Beads lane pressure if bd is available.
   Decide whether ingest/refinery/lint/decay/rescue should run, which domains
   should be processed, and the max item count per domain.

   Keep expensive work delegated: use the plan to route bulk extraction to
   workers rather than doing it yourself. Return structured JSON only.`,
  {
    label: "fable-supervisor",
    schema: supervisorSchema,
  }
);

phase("ingest");

const domainsRaw = await agent(
  `List all active domain slugs from YAML files in ${CONFIG}/.
   A domain is active when its YAML lacks "active: false".
   Return a JSON array of slug strings (filenames without the .yaml extension).`,
  {
    label: "list-domains",
    schema: {
      type: "object",
      required: ["domains"],
      properties: { domains: { type: "array", items: { type: "string" } } },
    },
  }
);

const activeDomains = domainsRaw.domains || [];
const requestedDomains = supervisorPlan.domains && supervisorPlan.domains.length > 0
  ? supervisorPlan.domains
  : activeDomains;
const domains = requestedDomains.filter((domain) => activeDomains.includes(domain));
const maxItemsPerDomain = supervisorPlan.max_items_per_domain || 12;
log(`Active domains: ${activeDomains.join(", ")}`);
log(`Selected domains: ${domains.join(", ")}`);

const ingestResults = supervisorPlan.run_ingest === false
  ? []
  : await parallel(
      domains.map((domain) => async () => {
        return agent(
          `You are an ingest worker for the ideas-funnel plugin.
           Process domain: ${domain}
           Vault: ${VAULT}
           Raw inbox: ${VAULT}/Raw/Inbox/${domain}/
           Domain config: ${CONFIG}/${domain}.yaml
           Manifest: ${VAULT}/Raw/.manifest.json
           Max items this run: ${maxItemsPerDomain}
           Priority terms from Fable: ${(supervisorPlan.priority_terms || []).join(", ")}
           Preferred expensive worker: ${supervisorPlan.budget?.preferred_worker_model || "gpt-5.5"}
           Max expensive tasks this run: ${supervisorPlan.budget?.max_expensive_tasks || 2}

           Step 1 — Apply backpressure. Inventory unprocessed raw items, dedupe obvious
           repeats, then choose at most ${maxItemsPerDomain} items by Fable priority,
           source quality, novelty, and relevance. Leave the rest untouched for later.

           Step 2 — Fetch only what is needed for selected items. Read ${CONFIG}/${domain}.yaml
           for feeds.rss[] and feeds.keywords[]. Skip URLs already present in the manifest.

           Step 3 — Follow the ideas-funnel:ingest skill at
           \${CLAUDE_PLUGIN_ROOT}/skills/ingest/SKILL.md exactly.
           Follow \${CLAUDE_PLUGIN_ROOT}/skills/delegate/SKILL.md when deciding whether
           an extraction/comparison task should be treated as GPT-5.5 worker work,
           cheap/local work, or shell work.

           Operate only on the ${domain} domain inbox. Do not touch other domains.
           Do not write shared layers. Return structured JSON matching the output schema.`,
          {
            label: `ingest-${domain}`,
            agentType: "ideas-funnel:ingest",
            schema: domainIngestSchema,
          }
        );
      })
    );

phase("threshold-check");

const allSignals = ingestResults
  .filter(Boolean)
  .flatMap((r) => r.density_signals || []);

log(`Density signals received: ${allSignals.length}`);

if (supervisorPlan.run_refinery !== false && allSignals.length > 0) {
  phase("refinery");

  const signalList = allSignals
    .map((s) => `- ${s.concept} (${s.source_count} sources)`)
    .join("\n");

  await agent(
    `You are the refinery agent for the ideas-funnel plugin.
     Vault: ${VAULT}

     The following concepts have crossed the ≥3-unrelated-sources threshold and need promotion:
     ${signalList}

     Follow the refinery agent definition at \${CLAUDE_PLUGIN_ROOT}/agents/refinery.md.
     For each concept: read all source pages referencing it, synthesize a shared Concepts/ page,
     detect contradictions, update index.md and log.md.

     Return structured JSON matching the output schema.`,
    {
      label: "refinery",
      agentType: "ideas-funnel:refinery",
      schema: refinerySchema,
    }
  );
}

if (supervisorPlan.run_lint !== false) {
  phase("lint");
  await agent(
    `Run ideas-funnel lint for ${VAULT}.
     Follow \${CLAUDE_PLUGIN_ROOT}/skills/lint/SKILL.md.
     Return structured JSON with error and warning counts.`,
    {
      label: "lint",
      schema: maintenanceSchema,
    }
  );
}

if (supervisorPlan.run_decay !== false) {
  phase("decay");
  await agent(
    `Apply ideas-funnel memory decay.
     Vault: ${VAULT}

     Follow \${CLAUDE_PLUGIN_ROOT}/skills/decay/SKILL.md.
     Use only valid states: fresh, stable, at_risk, archived. Set hardened as
     a boolean flag only. Return structured JSON.`,
    {
      label: "decay",
      schema: maintenanceSchema,
    }
  );
}

if (supervisorPlan.run_rescue !== false) {
  phase("rescue");
  await agent(
    `Run ideas-funnel rescue for ${VAULT}.
     Follow \${CLAUDE_PLUGIN_ROOT}/skills/rescue/SKILL.md.
     Focus on stale raw items, orphans, and at-risk pages. Respect backpressure:
     recommend top-N rescue candidates rather than processing the entire backlog.
     Return structured JSON.`,
    {
      label: "rescue",
      schema: maintenanceSchema,
    }
  );
}

phase("stats");
await agent(
  `Update ideas-funnel stats for ${VAULT}.
   Follow \${CLAUDE_PLUGIN_ROOT}/skills/stats/SKILL.md.
   Include the Fable supervisor plan, ingest results, density signal count, model
   routing notes, and maintenance outcomes when available.`,
  {
    label: "stats",
    schema: maintenanceSchema,
  }
);

log("Pipeline complete");
