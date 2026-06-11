export const meta = {
  name: "ideas-funnel-pipeline",
  description: "Daily ideas funnel: ingest → threshold check → optional refinery → optional scorer",
  phases: ["ingest", "threshold-check", "refinery", "scorer"],
};

const VAULT = args.vault || "~/Vaults/Neurons";
const CONFIG = args.config || "~/.config/ideas-funnel/domains";

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

const scorerSchema = {
  type: "object",
  required: ["cards_scored", "cards_skipped"],
  properties: {
    cards_scored: { type: "number" },
    cards_skipped: { type: "number" },
    score_summary: { type: "string" },
  },
};

phase("ingest");
log(`Vault: ${VAULT}`);

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

const domains = domainsRaw.domains || [];
log(`Active domains: ${domains.join(", ")}`);

const ingestResults = await parallel(
  domains.map((domain) => async () => {
    return agent(
      `You are an ingest agent for the ideas-funnel plugin.
       Process domain: ${domain}
       Vault: ${VAULT}
       Raw inbox: ${VAULT}/Raw/Inbox/${domain}/
       Domain config: ${CONFIG}/${domain}.yaml
       Manifest: ${VAULT}/Raw/.manifest.json

       Step 1 — Fetch new items. Read ${CONFIG}/${domain}.yaml to find the feeds.rss[]
       and feeds.keywords[] arrays. For each RSS URL, fetch the feed (WebFetch), extract
       items published since the most recent ingested_at date in the manifest (or last 7
       days if no prior ingests), and write each new item as a markdown file to
       ${VAULT}/Raw/Inbox/${domain}/ using the item title as the filename. Skip items
       already present in the manifest. If the feed fetch fails, log the error and
       continue with other feeds.

       Step 2 — Ingest. Follow the ideas-funnel:ingest skill at
       \${CLAUDE_PLUGIN_ROOT}/skills/ingest/SKILL.md exactly.
       Operate only on the ${domain} domain inbox. Do not touch other domains.
       Compress any article body over 4000 words through headroom before page-breaking
       if \`command -v headroom\` succeeds.

       Return structured JSON matching the output schema.`,
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

if (allSignals.length > 0) {
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

const runDate = args.date;
const shouldScore = (() => {
  if (!runDate) return false;
  const [, , day] = runDate.split("-").map(Number);
  return day === 1;
})();

if (shouldScore) {
  phase("scorer");
  log("Monthly scorer run triggered");

  await agent(
    `You are the scorer for the ideas-funnel plugin.
     Vault: ${VAULT}
     Run date: ${runDate}

     Review all Concepts/ and Bridges/ pages. For each page:
     - Decay confidence by the page's decay_class rate if last_confirmed is stale.
     - Set state to "stale" when confidence drops below 0.4.
     - Set state to "hardened" when confirmation_count >= 5 and confidence >= 0.9.
     - Update last_touched on every page you modify.

     Do not modify Sources/ or Domains/ pages.
     Return structured JSON matching the output schema.`,
    {
      label: "scorer",
      schema: scorerSchema,
    }
  );
}

log("Pipeline complete");
