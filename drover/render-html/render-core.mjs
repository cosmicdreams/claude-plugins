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

function truncate(s, n) {
  if (!s) return s;
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

const VIEW_BUILDERS = {
  "monthly-client": buildMonthlyClientView,
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
