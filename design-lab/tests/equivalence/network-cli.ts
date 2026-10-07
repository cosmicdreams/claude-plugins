import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pluginRoot } from "../../src/runtime.ts";
export async function findExamplesMain(args: {
  scratch: string;
  py: string;
  ts: string;
  base: string;
  paths: string[];
  components: string;
  strategy: string;
  python: string;
}): Promise<void> {
  const urls = join(args.scratch, "urls.txt");
  writeFileSync(
    urls,
    args.paths.map((p) => new URL(p, args.base).href).join("\n") + "\n",
  );
  const flags = [
    args.base,
    "--strategy",
    args.strategy,
    "--limit",
    "3",
    "--delay",
    "0",
    "--urls",
    urls,
    "--components",
    args.components,
  ];
  const python = spawnSync(
    args.python,
    [join(pluginRoot, "scripts/find_examples.py"), ...flags],
    {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (python.status !== 0)
    throw new Error("Python find_examples failed: " + python.stderr);
  writeFileSync(join(args.py, "examples.json"), python.stdout);
  const node = spawnSync(
    process.execPath,
    [join(pluginRoot, "src/find-examples.ts"), ...flags],
    { encoding: "utf8", env: process.env, maxBuffer: 10 * 1024 * 1024 },
  );
  if (node.status !== 0)
    throw new Error("TS find_examples failed: " + node.stderr);
  writeFileSync(join(args.ts, "examples.json"), node.stdout);
}
