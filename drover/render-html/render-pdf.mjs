#!/usr/bin/env node
// Convert a completed HTML report to its final PDF delivery artifact using a
// locally installed Chromium-family browser. No browser package is downloaded.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

function usage(code = 0) {
  console.log(`drover-render-pdf — print a drover HTML report to PDF

Usage:
  node render-pdf.mjs --html <report.html> [--out <report.pdf>]
                      [--browser <chrome-or-chromium>]

Browser resolution order:
  --browser, DROVER_PDF_BROWSER, then common Chrome/Chromium/Edge paths.
`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--html": args.html = next(); break;
      case "--out": args.out = next(); break;
      case "--browser": args.browser = next(); break;
      case "-h":
      case "--help": usage(0); break;
      default:
        console.error(`unknown flag: ${argv[i]}`);
        usage(2);
    }
  }
  if (!args.html) {
    console.error("ERROR: --html is required");
    usage(2);
  }
  return args;
}

function browserCandidates(explicit) {
  const mac = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  const linux = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
  const windows = [
    join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  return [explicit, process.env.DROVER_PDF_BROWSER, ...mac, ...linux, ...windows]
    .filter(Boolean)
    .map((p) => resolve(p));
}

function findBrowser(explicit) {
  const candidates = browserCandidates(explicit);
  const found = candidates.find(existsSync);
  if (!found) {
    throw new Error(
      "No supported browser found. Install Chrome, Chromium, or Edge; " +
      "or pass --browser /path/to/browser.\nChecked:\n" +
      candidates.map((p) => `  - ${p}`).join("\n"),
    );
  }
  return found;
}

function waitForPdf(child, out, timeoutMs = 60_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    let stderr = "";
    const started = Date.now();
    let poll;

    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearInterval(poll);
      rejectPromise(error);
    });
    child.on("exit", (code) => {
      clearInterval(poll);
      if (existsSync(out) && statSync(out).size > 0) resolvePromise();
      else rejectPromise(new Error(`Browser exited ${code} before creating the PDF: ${stderr}`));
    });

    poll = setInterval(() => {
      if (Date.now() - started > timeoutMs) {
        clearInterval(poll);
        rejectPromise(new Error(`Timed out waiting for browser PDF output: ${out}`));
        return;
      }
      if (!existsSync(out)) return;
      const size = statSync(out).size;
      const complete = size > 0 && readFileSync(out).subarray(-1024).includes(Buffer.from("%%EOF"));
      if (complete) {
        clearInterval(poll);
        resolvePromise();
      }
    }, 150);
  });
}

function stopBrowser(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolvePromise();
    };
    child.once("exit", finish);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!finished) child.kill("SIGKILL");
    }, 1_500);
    setTimeout(finish, 3_000);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const html = resolve(args.html);
  if (!existsSync(html)) throw new Error(`HTML input not found: ${html}`);

  const out = resolve(args.out || join(
    dirname(html),
    `${basename(html, extname(html))}.pdf`,
  ));
  const browser = findBrowser(args.browser);
  const profile = mkdtempSync(join(tmpdir(), "drover-pdf-"));
  rmSync(out, { force: true });

  const flags = [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--print-to-pdf-no-header",
    "--allow-file-access-from-files",
    `--user-data-dir=${profile}`,
    `--print-to-pdf=${out}`,
    pathToFileURL(html).href,
  ];
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    flags.unshift("--no-sandbox");
  }

  try {
    const child = spawn(browser, flags, { stdio: ["ignore", "ignore", "pipe"] });
    try {
      await waitForPdf(child, out);
    } finally {
      await stopBrowser(child);
    }
    if (!existsSync(out) || statSync(out).size === 0) {
      throw new Error(`Browser reported success but did not create a PDF: ${out}`);
    }
    console.log(`wrote ${out}`);
    console.log(`  html:    ${html}`);
    console.log(`  browser: ${browser}`);
    console.log(`  size:    ${statSync(out).size.toLocaleString()} bytes`);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(70);
}
