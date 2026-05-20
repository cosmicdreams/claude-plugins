// render-core.mjs — turn drover JSON + DESIGN.md tokens into an HTML report.
//
// This module statically imports third-party deps (handlebars, js-yaml via
// design-tokens). It is loaded by render.mjs *after* its bootstrap has
// ensured node_modules exists, so those imports always resolve.
//
// Usage (via render.mjs):
//   node render.mjs --data path/to/2026-04.json \
//                   --design path/to/DESIGN.md \
//                   --template monthly-client \
//                   --out path/to/2026-04-monthly-client.html
//                   [--logo path/to/velir-logo.png]
//
// Defaults:
//   --design   ../assets/design/DESIGN.md (relative to render.mjs)
//   --template monthly-client
//   --logo     ../assets/branding/velir-logo.png
//   --out      derived from --data: same dir, replace .json with -<template>.html

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { loadDesign, baseStylesheet } from "./design-tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    template: "monthly-client",
    design: resolve(HERE, "..", "assets", "design", "DESIGN.md"),
    logo: resolve(HERE, "..", "assets", "branding", "velir-logo.png"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--data": args.data = next(); break;
      case "--design": args.design = next(); break;
      case "--template": args.template = next(); break;
      case "--out": args.out = next(); break;
      case "--logo": args.logo = next(); break;
      case "-h":
      case "--help":
        printHelpAndExit(0);
        break;
      default:
        if (a.startsWith("--")) {
          console.error(`unknown flag: ${a}`);
          printHelpAndExit(2);
        }
    }
  }
  if (!args.data) {
    console.error("ERROR: --data is required");
    printHelpAndExit(2);
  }
  return args;
}

function printHelpAndExit(code) {
  console.log(`drover-render-html — generate HTML from drover JSON + DESIGN.md

Usage:
  node render.mjs --data <json> [--template monthly-client] [--design <DESIGN.md>]
                  [--out <html>] [--logo <png>]

Templates: monthly-client (more coming)
`);
  process.exit(code);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function logoDataUri(logoPath) {
  if (!logoPath || !existsSync(logoPath)) return null;
  const ext = extname(logoPath).slice(1).toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" :
               ext === "png" ? "image/png" :
               ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
               "application/octet-stream";
  const buf = readFileSync(logoPath);
  const base = ext === "svg" ? buf.toString("utf8") : buf.toString("base64");
  return ext === "svg"
    ? `data:${mime};utf8,${encodeURIComponent(base)}`
    : `data:${mime};base64,${base}`;
}

// --- Handlebars helpers --------------------------------------------------

Handlebars.registerHelper("fmt", (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return n;
  return v.toLocaleString("en-US");
});
Handlebars.registerHelper("join", (arr, sep) => Array.isArray(arr) ? arr.join(sep) : "");
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("upper", (s) => String(s ?? "").toUpperCase());

// --- View-model builders -------------------------------------------------

function buildMonthlyClientView(data) {
  const sevOrder = ["critical", "error", "warning", "notice", "info", "unknown"];
  const sev = data.totals.by_severity || {};
  const sevTotal = Object.values(sev).reduce((a, b) => a + b, 0) || 1;
  const sevMax = Math.max(...Object.values(sev), 1);
  const severityChart = sevOrder
    .filter((k) => (sev[k] || 0) > 0)
    .map((k, i) => ({
      key: k,
      count: sev[k] || 0,
      sharePct: (((sev[k] || 0) / sevTotal) * 100).toFixed(1),
      widthPct: (((sev[k] || 0) / sevMax) * 100).toFixed(1),
      first: i === 0,
    }));

  const topIssues = (data.groups_collapsed || data.groups || [])
    .slice(0, 5)
    .map((g) => ({
      title: g.summary || g.fingerprint,
      severity: g.severity || "unknown",
      count: g.count,
      channel: g.channel || g.source || "—",
      firstSeen: g.first_seen ? String(g.first_seen).slice(0, 10) : null,
      lastSeen: g.last_seen ? String(g.last_seen).slice(0, 10) : null,
      sample: (g.samples && g.samples[0]) ? truncate(g.samples[0], 280) : null,
    }));

  const topGroup = (data.groups_collapsed || data.groups || [])[0];
  const topShare = topGroup
    ? ((topGroup.count / Math.max(1, data.totals.events_total)) * 100).toFixed(1)
    : "0.0";

  return {
    meta: data.meta,
    coverage: data.coverage,
    coverageLow: (data.coverage?.coverage_pct ?? 100) < 90,
    totals: data.totals,
    severityChart,
    topIssues,
    topShare,
    tickets: (data.tickets || []).map((t) => ({
      ...t,
      sample: t.sample ? truncate(t.sample, 280) : null,
    })),
    schemaVersion: `v${data.drover_schema_version}`,
    generatedAt: String(data.generated_at).replace("T", " ").slice(0, 19) + " UTC",
  };
}

function buildRootCauseSummaryView(data) {
  const total = data.totals.events_total || 0;
  const groups = data.groups_collapsed || [];

  // Pareto cut at 80% (same logic as report.py)
  let cumulative = 0;
  let paretoN = 0;
  let paretoPct = 0;
  for (const g of groups) {
    cumulative += g.count || 0;
    paretoN += 1;
    paretoPct = (cumulative / Math.max(total, 1)) * 100;
    if (paretoPct >= 80 || paretoN >= 10) {
      break;
    }
  }

  const topN = Math.min(5, groups.length);
  const topShare = groups.slice(0, topN).reduce((sum, g) => sum + (g.count || 0), 0);
  const topSharePct = ((topShare / Math.max(total, 1)) * 100).toFixed(1);

  // volume share chart
  const chartMaxN = Math.max(topN, paretoN);
  const chartGroups = groups.slice(0, chartMaxN);
  const chartMaxCount = Math.max(...chartGroups.map(g => g.count || 0), 1);
  const volumeChart = chartGroups.map((g, i) => {
    const chans = g.channels || (g.channel ? [g.channel] : ["(none)"]);
    const memberCount = g.member_count || 1;
    let label = "";
    if (chans.length > 1) {
      label = chans.join("+");
    } else if (memberCount > 1) {
      label = `${chans[0]} ×${memberCount}`;
    } else {
      label = `${chans[0]} · ${g.fingerprint.slice(0, 6)}`;
    }
    const count = g.count || 0;
    return {
      label,
      count,
      widthPct: ((count / chartMaxCount) * 100).toFixed(1),
      sharePct: ((count / Math.max(total, 1)) * 100).toFixed(1),
      first: i === 0,
    };
  });

  // Top issues in detail
  const topIssues = groups.slice(0, topN).map((g, idx) => {
    const count = g.count || 0;
    const sharePct = ((count / Math.max(total, 1)) * 100).toFixed(1);
    const delta = g.delta || {};
    let trend = null;
    let trendKey = null;
    if (delta.delta_pct !== undefined && delta.delta_pct !== null) {
      const pctVal = Math.round(delta.delta_pct);
      trend = `${pctVal > 0 ? "▲" : pctVal < 0 ? "▼" : "•"} ${Math.abs(pctVal)}% vs prior month`;
      trendKey = pctVal > 0 ? "up" : pctVal < 0 ? "down" : "flat";
    } else if (delta.is_new) {
      trend = "🆕 new this month";
      trendKey = "new";
    }

    const chans = g.channels || (g.channel ? [g.channel] : []);
    const memberCount = g.member_count || 1;
    let title = "";
    if (memberCount > 1) {
      title = chans.map(c => `"${c}"`).join(" + ");
    } else {
      title = `"${g.channel || "(none)"}"`;
    }

    return {
      index: idx + 1,
      title,
      fingerprint: g.fingerprint,
      severity: g.severity || "unknown",
      count,
      sharePct,
      trend,
      trendKey,
      firstSeen: g.first_seen ? String(g.first_seen).slice(0, 10) : null,
      lastSeen: g.last_seen ? String(g.last_seen).slice(0, 10) : null,
      memberCount,
      memberFingerprints: g.member_fingerprints || [],
      cause: g.cause,
      sample: g.samples && g.samples[0] ? truncate(g.samples[0], 400) : null,
    };
  });

  // Coverage detail (days with retrieval gaps)
  const retrievalGaps = (data.coverage?.missing_or_failed || []).slice(0, 10).map(m => {
    const reason = m.reason || "";
    return `${m.date} ${m.log_type} (${m.state}${reason ? ": " + reason : ""})`;
  });
  const hasMoreGaps = (data.coverage?.missing_or_failed || []).length > 10;
  const missingGapsCount = (data.coverage?.missing_or_failed || []).length - 10;

  return {
    meta: data.meta,
    coverage: data.coverage,
    coverageLow: (data.coverage?.coverage_pct ?? 100) < 90,
    totals: data.totals,
    paretoN,
    paretoPct: Math.round(paretoPct),
    topN,
    topSharePct,
    volumeChart,
    topIssues,
    retrievalGaps,
    hasMoreGaps,
    missingGapsCount,
    tickets: (data.tickets || []).map((t) => ({
      ...t,
      sample: t.sample ? truncate(t.sample, 280) : null,
    })),
    schemaVersion: `v${data.drover_schema_version}`,
    generatedAt: String(data.generated_at).replace("T", " ").slice(0, 19) + " UTC",
  };
}

function buildCalendarBoundaryView(data) {
  const total = data.totals.events_total || 0;
  const bySev = data.totals.by_severity || {};
  const byCh = data.totals.by_channel || {};
  const byDay = data.totals.by_day || {};
  const groups = data.groups_collapsed || [];

  // Severity breakdown
  const sevOrder = ["critical", "error", "warning", "notice", "info", "unknown"];
  const sevMax = Math.max(...Object.values(bySev), 1);
  const severityChart = sevOrder
    .filter((k) => (bySev[k] || 0) > 0)
    .map((k, i) => ({
      key: k,
      count: bySev[k] || 0,
      sharePct: (((bySev[k] || 0) / Math.max(total, 1)) * 100).toFixed(1),
      widthPct: (((bySev[k] || 0) / sevMax) * 100).toFixed(1),
      first: i === 0,
    }));

  // Events by channel chart (top 15)
  const channelEntries = Object.entries(byCh)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  const channelMax = Math.max(...channelEntries.map(e => e[1]), 1);
  const channelChart = channelEntries.map(([ch, count], i) => ({
    channel: ch,
    count,
    sharePct: ((count / Math.max(total, 1)) * 100).toFixed(1),
    widthPct: ((count / channelMax) * 100).toFixed(1),
    first: i === 0,
  }));

  // Daily volume chart
  const dayEntries = Object.entries(byDay)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const dayMax = Math.max(...dayEntries.map(e => e[1].total || 0), 1);
  const dailyChart = dayEntries.map(([day, val]) => {
    const count = val.total || 0;
    return {
      day,
      count,
      widthPct: ((count / dayMax) * 100).toFixed(1),
    };
  });

  // Top channels in detail (top 5)
  const topChannels = Object.entries(byCh)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ch, count]) => {
      const sharePct = ((count / Math.max(total, 1)) * 100).toFixed(1);
      const chGroups = groups.filter(g => (g.channel || "(none)") === ch)
        .sort((a, b) => (b.count || 0) - (a.count || 0));
      const topSummary = chGroups.length > 0 ? truncate(chGroups[0].summary || "", 200) : "";
      return {
        channel: ch,
        count,
        sharePct,
        groupCount: chGroups.length,
        topSummary,
      };
    });

  // Coverage detail (days with retrieval gaps)
  const retrievalGaps = (data.coverage?.missing_or_failed || []).slice(0, 10).map(m => {
    const reason = m.reason || "";
    return `${m.date} ${m.log_type} (${m.state}${reason ? ": " + reason : ""})`;
  });
  const hasMoreGaps = (data.coverage?.missing_or_failed || []).length > 10;
  const missingGapsCount = (data.coverage?.missing_or_failed || []).length - 10;

  return {
    meta: data.meta,
    coverage: data.coverage,
    coverageLow: (data.coverage?.coverage_pct ?? 100) < 90,
    totals: data.totals,
    criticalCount: bySev.critical || 0,
    errorCount: bySev.error || 0,
    warningCount: bySev.warning || 0,
    severityChart,
    channelChart,
    dailyChart,
    topChannels,
    retrievalGaps,
    hasMoreGaps,
    missingGapsCount,
    tickets: (data.tickets || []).map((t) => ({
      ...t,
      sample: t.sample ? truncate(t.sample, 280) : null,
    })),
    schemaVersion: `v${data.drover_schema_version}`,
    generatedAt: String(data.generated_at).replace("T", " ").slice(0, 19) + " UTC",
  };
}

function buildTriageBriefView(data) {
  const total = data.totals.events_total || 0;
  const groups = data.groups || [];

  const topIssues = groups.slice(0, 25).map((g, idx) => {
    const count = g.count || 0;
    const delta = g.delta || {};
    let trend = null;
    let trendKey = null;
    if (delta.delta_pct !== undefined && delta.delta_pct !== null) {
      const pctVal = Math.round(delta.delta_pct);
      trend = `${pctVal > 0 ? "▲" : pctVal < 0 ? "▼" : "•"} ${Math.abs(pctVal)}% vs prior month`;
      trendKey = pctVal > 0 ? "up" : pctVal < 0 ? "down" : "flat";
    } else if (delta.is_new) {
      trend = "🆕 new";
      trendKey = "new";
    }

    const sevs = Object.entries(g.severities || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");

    return {
      index: idx + 1,
      fingerprint: g.fingerprint,
      summary: g.summary,
      channel: g.channel || "(none)",
      severity: g.severity || "unknown",
      count,
      trend,
      trendKey,
      firstSeen: g.first_seen ? String(g.first_seen).slice(0, 10) : null,
      lastSeen: g.last_seen ? String(g.last_seen).slice(0, 10) : null,
      severitiesStr: sevs,
      samples: (g.samples || []).slice(0, 3),
    };
  });

  return {
    meta: data.meta,
    coverage: data.coverage,
    coverageLow: (data.coverage?.coverage_pct ?? 100) < 90,
    totals: data.totals,
    topIssues,
    schemaVersion: `v${data.drover_schema_version}`,
    generatedAt: String(data.generated_at).replace("T", " ").slice(0, 19) + " UTC",
  };
}

function buildJiraReadyView(data) {
  const groups = data.groups || [];

  const topIssues = groups.slice(0, 15).map((g, idx) => {
    const ch = g.channel || "(none)";
    const sev = g.severity || "unknown";
    const project = data.meta.project;
    const env = data.meta.env;
    const month = data.meta.month_label;

    const shortSummary = truncate(g.summary || "", 80);
    const title = `[${project}/${env}] ${ch}: ${shortSummary}`;

    let desc = `Project: ${project}
Environment: ${env}
Month: ${month}
Channel: ${ch}
Severity: ${sev}
Occurrences: ${g.count}
`;
    if (g.first_seen) desc += `First seen: ${g.first_seen}\n`;
    if (g.last_seen) desc += `Last seen: ${g.last_seen}\n`;
    desc += `Drover fingerprint: ${g.fingerprint}\n\n`;
    desc += `Summary:\n${truncate(g.summary || "", 800)}\n`;
    
    if (g.samples && g.samples.length > 0) {
      desc += `\nSample log lines:\n`;
      g.samples.slice(0, 2).forEach(s => {
        desc += `  ${truncate(s, 400)}\n`;
      });
    }

    return {
      index: idx + 1,
      fingerprint: g.fingerprint,
      title,
      description: desc,
      channel: ch,
      severity: sev,
      count: g.count,
    };
  });

  return {
    meta: data.meta,
    coverage: data.coverage,
    coverageLow: (data.coverage?.coverage_pct ?? 100) < 90,
    totals: data.totals,
    topIssues,
    schemaVersion: `v${data.drover_schema_version}`,
    generatedAt: String(data.generated_at).replace("T", " ").slice(0, 19) + " UTC",
  };
}

function truncate(s, n) {
  if (!s) return s;
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

const VIEW_BUILDERS = {
  "monthly-client": buildMonthlyClientView,
  "root-cause-summary": buildRootCauseSummaryView,
  "calendar-boundary": buildCalendarBoundaryView,
  "triage-brief": buildTriageBriefView,
  "jira-ready": buildJiraReadyView,
};

// --- entry ---------------------------------------------------------------

export function run(argv) {
  const args = parseArgs(argv);
  const data = loadJson(args.data);
  const tokens = loadDesign(args.design);

  const buildView = VIEW_BUILDERS[args.template];
  if (!buildView) {
    console.error(`ERROR: unknown template "${args.template}". Known: ${Object.keys(VIEW_BUILDERS).join(", ")}`);
    process.exit(2);
  }

  const tplPath = resolve(HERE, "templates", `${args.template}.hbs`);
  if (!existsSync(tplPath)) {
    console.error(`ERROR: template file missing: ${tplPath}`);
    process.exit(2);
  }
  const tplSrc = readFileSync(tplPath, "utf8");
  const tpl = Handlebars.compile(tplSrc, { noEscape: false });

  const view = buildView(data);
  view.css = baseStylesheet(tokens);
  view.logoDataUri = logoDataUri(args.logo);

  const html = tpl(view);

  const out = args.out || (() => {
    const dataDir = dirname(args.data);
    const stem = basename(args.data, extname(args.data));
    return join(dataDir, `${stem}-${args.template}.html`);
  })();
  writeFileSync(out, html);
  console.log(`wrote ${out}`);
  console.log(`  template: ${args.template}`);
  console.log(`  data:     ${args.data}`);
  console.log(`  design:   ${args.design}`);
  console.log(`  size:     ${html.length.toLocaleString()} bytes`);
}
