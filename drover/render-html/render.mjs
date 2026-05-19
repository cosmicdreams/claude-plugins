#!/usr/bin/env node
// render.mjs — bootstrap entry for the drover HTML renderer.
//
// Uses only Node builtins so it loads even when node_modules is absent.
// On first run it installs render deps (`npm ci` from the tracked
// package-lock.json, falling back to `npm install`), then hands off to
// render-core.mjs — which statically imports handlebars + js-yaml.
//
// This is why node_modules is gitignored: the install is a one-time,
// deterministic build step triggered lazily here, not a vendored tree.
//
// All flags pass straight through to render-core. See its header for usage.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));

function ensureDeps() {
  // handlebars is the heaviest dep and the one render-core needs first;
  // its presence is a sufficient proxy for "deps installed".
  const marker = resolve(HERE, "node_modules", "handlebars", "package.json");
  if (existsSync(marker)) return;

  const hasLock = existsSync(resolve(HERE, "package-lock.json"));
  const subcmd = hasLock ? "ci" : "install";
  console.error(`[drover] installing HTML render deps (one-time, npm ${subcmd})…`);
  try {
    execFileSync("npm", [subcmd, "--no-audit", "--no-fund", "--loglevel=error"], {
      cwd: HERE,
      stdio: "inherit",
    });
  } catch (e) {
    console.error(
      "[drover] dependency install failed. Ensure Node ≥20 and npm are " +
      "installed and on PATH, then re-run.\n" + (e?.message ?? e),
    );
    process.exit(70); // EX_SOFTWARE: environment not ready
  }
}

ensureDeps();
const { run } = await import("./render-core.mjs");
run(process.argv.slice(2));
