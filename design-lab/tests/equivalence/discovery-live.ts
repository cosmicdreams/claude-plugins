/** DB and bounded local HTTP oracle acceptance. Run after discovery.ts in the same scratch tree. */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { writeJson } from "../../src/contracts.ts";
import { pluginRoot } from "../../src/runtime.ts";
import { extract, mergeUsage } from "../../src/extract-drupal-usage.ts";
import {
  extract as canvasExtract,
  mergeCanvasUsage,
} from "../../src/extract-canvas-usage.ts";
import { scan } from "../../src/find-rendered-components.ts";
import {
  addresses,
  siteConfig,
  fetchPages,
} from "../../src/published-pages.ts";
import { buildVoice } from "../../src/extract-voice.ts";
import { buildCompositions } from "../../src/extract-compositions.ts";
import { sites, differences, normalize, ignoredFields } from "./discovery.ts";
import type { Dict } from "../../src/discovery-io.ts";
import type { Page } from "../../src/find-rendered-components.ts";
import { findExamplesMain } from "./network-cli.ts";

const python = process.env["DESIGN_LAB_PYTHON"] ?? "python3";
export async function main(output: string): Promise<void> {
  output = resolve(output);
  if (!/^\/(private\/)?tmp\//.test(output))
    throw new Error("live output must be under /tmp");
  const summary: Dict = { ignoredFields, results: [] };
  for (const [name, frozen] of sites) {
    const scratch = join(output, name!),
      request = JSON.parse(
        readFileSync(join(scratch, "request.json"), "utf8"),
      ) as Dict,
      project = JSON.parse(
        readFileSync(join(frozen!, "project.json"), "utf8"),
      ) as Dict;
    const root = request["root"],
      py = join(scratch, "python"),
      ts = join(scratch, "ts");
    const describe = spawnSync("ddev", ["describe", "-j"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    let status: Dict = {};
    try {
      status = JSON.parse(describe.stdout)["raw"] ?? {};
    } catch {}
    if (describe.status !== 0 || status["status"] !== "running") {
      summary.results.push({
        site: name,
        status: "skipped",
        reason:
          "DDEV project not running; start authorized only for PNCB/DEFINITIVEHC",
      });
      continue;
    }
    const base = status["primary_url"] as string,
      entry: Dict = {
        site: name,
        baseUrl: base,
        artifacts: {},
        timings: { ts: {}, python: {} },
      };
    summary.results.push(entry);
    for (const arm of [py, ts]) writeJson(join(arm, "project.json"), project);
    const runOracle = (stage: string): void => {
      writeJson(join(scratch, `request-${stage}.json`), {
        ...request,
        stage,
        baseUrl: base,
        ddevProject: project["phases"]?.usage?.detail?.ddevProject ?? null,
      });
      const p = spawnSync(
        python,
        [
          join(pluginRoot, "tests/equivalence/discovery-oracle.py"),
          join(scratch, `request-${stage}.json`),
        ],
        {
          encoding: "utf8",
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      if (p.status !== 0)
        throw new Error(`${name} ${stage} Python failed: ${p.stderr}`);
      Object.assign(
        entry["timings"].python,
        JSON.parse(readFileSync(join(py, `timings-${stage}.json`), "utf8")),
      );
    };
    const save = async <T>(
      artifact: string,
      operation: () => T | Promise<T>,
    ): Promise<T> => {
      const start = performance.now(),
        doc = await operation();
      writeJson(join(ts, artifact + ".json"), doc);
      entry["timings"].ts[artifact] = (performance.now() - start) / 1000;
      return doc;
    };
    const compare = (artifact: string): void => {
      const diff = differences(
        normalize(JSON.parse(readFileSync(join(py, artifact + ".json"), "utf8"))),
        normalize(JSON.parse(readFileSync(join(ts, artifact + ".json"), "utf8"))),
      );
      entry["artifacts"][artifact] = {
        status: diff.length ? "mismatch" : "match",
        ...(diff.length ? { diff } : {}),
      };
    };
    runOracle("usage");
    const components = JSON.parse(
        readFileSync(join(ts, "components.json"), "utf8"),
      ) as Dict,
      rendering = existsSync(join(ts, "render-evidence.json"))
        ? (JSON.parse(
            readFileSync(join(ts, "render-evidence.json"), "utf8"),
          ) as Dict)
        : null;
    const usage = await save("usage", () =>
      request["decisions"].usageSource === "canvas-db"
        ? canvasExtract(
            root,
            components,
            project["phases"]?.usage?.detail?.ddevProject,
          )
        : extract(
            root,
            components,
            project["phases"]?.usage?.detail?.ddevProject,
            rendering,
          ),
    );
    await save("enriched-components", () =>
      request["decisions"].usageSource === "canvas-db"
        ? mergeCanvasUsage(components, usage)
        : mergeUsage(components, usage),
    );
    compare("usage");
    compare("enriched-components");
    runOracle("network");
    const { root: cfgRoot, name: siteName, front } = siteConfig(ts),
      paths = await save("published-addresses", () => ({
        paths: addresses(cfgRoot, front, 3),
      }));
    const pages = await fetchPages(base, paths.paths);
    await save("published-pages", () => ({ pages }));
    const [evidence, details] = await scan(base, root, components, 3);
    await save("rendered-components", () => ({
      components: evidence,
      source: details,
    }));
    await save("voice", () =>
      buildVoice(pages, siteName, "oracle-clock", front),
    );
    await save("compositions", () => buildCompositions(pages));
    for (const artifact of [
      "published-addresses",
      "published-pages",
      "rendered-components",
      "voice",
      "compositions",
    ])
      compare(artifact);
    // The original find_examples verifies normal TLS; use DDEV's HTTP address in both arms.
    await findExamplesMain({
      scratch,
      py,
      ts,
      base: status["httpurl"],
      paths: paths.paths,
      components: join(ts, "components.json"),
      strategy:
        request["decisions"].componentSource === "sitestudio"
          ? "sitestudio"
          : "paragraphs",
      python,
    });
    compare("examples");
    const snapshots = JSON.parse(
      readFileSync(join(py, "network-responses.json"), "utf8"),
    ) as { pages: Page[] };
    const replayVoice = buildVoice(
        snapshots.pages,
        siteName,
        "oracle-clock",
        front,
      ),
      replayCompositions = buildCompositions(snapshots.pages);
    entry["sameResponseReplay"] = {
      voice: differences(
        normalize(JSON.parse(readFileSync(join(py, "voice.json"), "utf8"))),
        normalize(replayVoice),
      ),
      compositions: differences(
        JSON.parse(readFileSync(join(py, "compositions.json"), "utf8")),
        replayCompositions,
      ),
    };
    writeJson(join(output, "live-summary.json"), summary);
    console.log(name, JSON.stringify(entry["artifacts"]));
  }
  writeJson(join(output, "live-summary.json"), summary);
  if (
    summary.results.some((r: Dict) =>
      Object.values<Dict>(r["artifacts"] ?? {}).some(
        (a) => a["status"] === "mismatch",
      ),
    )
  )
    process.exitCode = 1;
}
if (import.meta.main)
  await main(process.argv[2] ?? "/tmp/design-lab-p3-equivalence");
