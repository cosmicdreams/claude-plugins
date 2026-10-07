/** Stateful phase-three operations. Later workflow phases remain on the baseline front door. */
import {
  existsSync,
  readFileSync,
  statSync,
  appendFileSync,
  readdirSync,
} from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { assertValid, validate, writeJson } from "./contracts.ts";
import type { ArtifactKind } from "./contracts.ts";
import type { Project } from "./generated/project.ts";
import type { Components } from "./generated/components.ts";
import { pluginRoot } from "./runtime.ts";
import { detect } from "./detect.ts";
import { summary } from "./sitestudio-source.ts";
import { planComponent, writePlanJson } from "./plan.ts";
import type { RenderingSignals, CaptureSignals } from "./plan.ts";
import { build } from "./plan-variables.ts";
import type { TokenInput } from "./plan-variables.ts";

type JsonObject = Record<string, unknown>;
export const now = (): string =>
  new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
const read = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;
const optional = <T>(path: string, fallback: T): T =>
  existsSync(path) ? read<T>(path) : fallback;
export function loadProject(value: string): [string, Project] {
  const base = resolve(value),
    path = statSync(base).isDirectory() ? resolve(base, "project.json") : base,
    project = read<unknown>(path);
  assertValid("project", project);
  return [path, project];
}
export function invalidate(
  project: Project,
  phases: string[],
  kinds: string[],
): void {
  for (const phase of phases)
    if (phase in project.phases) project.phases[phase] = { status: "pending" };
  project.artifacts = Object.fromEntries(
    Object.entries(project.artifacts).filter(
      ([, a]) => !kinds.includes(String((a as JsonObject)["kind"])),
    ),
  );
}
function setPhase(
  path: string,
  project: Project,
  phase: string,
  status: string,
  detail?: JsonObject,
): void {
  const at = now();
  project.phases[phase] = {
    status,
    updatedAt: at,
    ...(detail && Object.keys(detail).length ? { detail } : {}),
  };
  writeJson(path, project);
  appendFileSync(
    resolve(dirname(path), "phase-log.jsonl"),
    JSON.stringify({ at, phase, status }) + "\n",
  );
}
function register(
  path: string,
  project: Project,
  name: string,
  file: string,
  kind: ArtifactKind,
): void {
  const errors = validate(kind, read<unknown>(file));
  const git = (args: string[]) => {
    const result = spawnSync("git", ["-C", pluginRoot, ...args], {
      encoding: "utf8",
    });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const commit = git(["rev-parse", "HEAD"]);
  project.artifacts[name] = {
    path: relative(dirname(path), file),
    kind,
    sha256:
      "sha256:" + createHash("sha256").update(readFileSync(file)).digest("hex"),
    valid: !errors.length,
    errors,
    updatedAt: now(),
    producedBy: {
      pluginDir: resolve(pluginRoot),
      toolVersion:
        "design-lab " +
        read<{ version: string }>(
          resolve(pluginRoot, ".claude-plugin/plugin.json"),
        ).version,
      commit,
      dirty: commit ? !!git(["status", "--porcelain", "--", "."]) : null,
    },
  };
  writeJson(path, project);
}
function artifact(
  path: string,
  project: Project,
  name: string,
  kind: ArtifactKind,
  document: unknown,
): void {
  assertValid(kind, document);
  const output = resolve(dirname(path), `${kind}.json`);
  writeJson(output, document);
  register(path, project, name, output, kind);
}
export function markUntiered(document: Components): void {
  for (const c of document.components)
    c["usage"] = {
      ...((c["usage"] ?? {}) as JsonObject),
      status: "unavailable",
      placements: null,
      structuralRefs: null,
      structuralReferences: null,
      tier: "Untiered",
    };
}
export function detectProject(value: string): unknown {
  const [path, project] = loadProject(value),
    document = detect(project.repository.root);
  artifact(path, project, "detection", "detection", document);
  invalidate(
    project,
    [
      "inventory",
      "usage",
      "capture",
      "tokens",
      "plan",
      "foundation",
      "components",
      "index",
      "verify",
    ],
    [
      "components",
      "render-evidence",
      "capture-evidence",
      "tokens",
      "usage",
      "plan",
      "variable-plan",
      "foundation",
      "build-record",
      "index",
      "verify-report",
    ],
  );
  const recommended = document.recommended ?? {};
  project.decisions["componentSource"] = recommended.component ?? null;
  project.decisions["tokenSource"] = recommended.token ?? null;
  project.decisions["usageSource"] = recommended.usage ?? null;
  const chosen = project.decisions["sitestudioConfig"];
  if (
    typeof chosen !== "string" ||
    !existsSync(chosen) ||
    !statSync(chosen).isDirectory()
  )
    project.decisions["sitestudioConfig"] =
      document.siteStudio?.configDir ?? null;
  setPhase(path, project, "discovery", "complete", {
    priorArtCount: document.priorArt?.length ?? 0,
    componentCandidates: document.componentSources?.length ?? 0,
    tokenCandidates: document.tokenSources?.length ?? 0,
  });
  return {
    output: resolve(dirname(path), "detection.json"),
    recommended,
    priorArt: document.priorArt ?? [],
  };
}
export interface Selection {
  component?: string;
  token?: string;
  usage?: string;
  sitestudioConfig?: string;
  degradedReason?: string;
  by?: string;
}
export function selectProject(value: string, args: Selection): unknown {
  const [path, project] = loadProject(value),
    detection = read<Record<string, { strategy: string }[]>>(
      resolve(dirname(path), "detection.json"),
    );
  const candidates = {
    component: new Set(
      (detection["componentSources"] ?? []).map((x) => x.strategy),
    ),
    token: new Set((detection["tokenSources"] ?? []).map((x) => x.strategy)),
    usage: new Set((detection["usageSources"] ?? []).map((x) => x.strategy)),
  };
  const previous = { ...project.decisions };
  let folder: string | undefined;
  if (args.sitestudioConfig) {
    folder = resolve(args.sitestudioConfig.replace(/^~(?=\/|$)/, homedir()));
    if (
      !existsSync(folder) ||
      !statSync(folder).isDirectory() ||
      !readdirSync(folder).some((n) => /^cohesion_.*\.yml$/.test(n))
    )
      throw new Error(
        `${folder} holds no Site Studio configuration (no cohesion_*.yml files)`,
      );
    const given = summary(project.repository.root, folder);
    if (given.components || given.customComponents.length)
      candidates.component.add("sitestudio");
    if (given.customStyles) candidates.token.add("sitestudio-styles");
  }
  for (const key of ["component", "token", "usage"] as const)
    if (args[key] && args[key] !== "none" && !candidates[key].has(args[key]!))
      throw new Error(
        `${args[key]} is not a detected ${key} strategy: ${[...candidates[key]].sort().join(", ")}`,
      );
  if (args.usage === "none" && (!args.degradedReason || !args.by))
    throw new Error(
      args.degradedReason
        ? "--usage none requires --by <human-decider>"
        : "--usage none requires --degraded-reason",
    );
  if (args.component && args.component !== previous["componentSource"])
    invalidate(
      project,
      [
        "inventory",
        "usage",
        "capture",
        "plan",
        "components",
        "index",
        "verify",
      ],
      [
        "components",
        "render-evidence",
        "capture-evidence",
        "usage",
        "plan",
        "build-record",
        "index",
        "verify-report",
      ],
    );
  if (args.token && args.token !== previous["tokenSource"])
    invalidate(
      project,
      ["tokens", "foundation", "components", "index", "verify"],
      [
        "tokens",
        "variable-plan",
        "foundation",
        "build-record",
        "index",
        "verify-report",
      ],
    );
  if (args.usage && args.usage !== previous["usageSource"])
    invalidate(
      project,
      ["usage", "capture", "plan", "components", "index", "verify"],
      [
        "usage",
        "capture-evidence",
        "plan",
        "build-record",
        "index",
        "verify-report",
      ],
    );
  if (folder) {
    if (folder !== previous["sitestudioConfig"])
      invalidate(
        project,
        [
          "inventory",
          "usage",
          "capture",
          "tokens",
          "plan",
          "foundation",
          "components",
          "index",
          "verify",
        ],
        [
          "components",
          "render-evidence",
          "capture-evidence",
          "tokens",
          "usage",
          "plan",
          "variable-plan",
          "foundation",
          "build-record",
          "index",
          "verify-report",
        ],
      );
    project.decisions["sitestudioConfig"] = folder;
  }
  if (args.component) project.decisions["componentSource"] = args.component;
  if (args.token) project.decisions["tokenSource"] = args.token;
  if (args.usage) {
    project.decisions["usageSource"] = args.usage;
    if (args.usage === "none") {
      setPhase(path, project, "usage", "waived", {
        reason: args.degradedReason,
        by: args.by,
        waivedAt: now(),
        effect: "usage tiers and prioritisation are unverified",
      });
      const file = resolve(dirname(path), "components.json");
      if (existsSync(file)) {
        const document = read<Components>(file);
        markUntiered(document);
        artifact(path, project, "components", "components", document);
      }
    } else project.phases["usage"] = { status: "pending" };
  }
  project.decisions["selectedAt"] = now();
  writeJson(path, project);
  return project.decisions;
}
const componentModules: Record<string, string> = {
  canvas: "extract-canvas",
  "drupal-authoring": "extract-drupal-authoring",
  paragraphs: "extract-paragraphs",
  sdc: "extract-sdc",
  sitestudio: "extract-sitestudio",
};
const tokenModules: Record<string, string> = {
  "css-custom-properties": "extract-tokens-cssvars",
  "sass-sourcemap": "extract-tokens-sourcemap",
  "sass-source": "extract-tokens-sass",
  "sitestudio-styles": "extract-tokens-sitestudio",
};
export async function extractProject(
  value: string,
  kind = "all",
): Promise<unknown> {
  if (!["all", "components", "tokens"].includes(kind))
    throw new Error("kind must be components, tokens, or all");
  const [path, project] = loadProject(value),
    root = project.repository.root;
  if (kind === "components" || kind === "all") {
    const strategy = String(project.decisions["componentSource"]);
    if (!componentModules[strategy])
      throw new Error(
        `component strategy ${strategy} has no extractor; run select`,
      );
    const module = (await import(
      pathToFileURL(
        resolve(pluginRoot, "src", componentModules[strategy]! + ".ts"),
      ).href
    )) as { extract(root: string, config?: string | null): Components };
    const document =
      strategy === "sitestudio"
        ? module.extract(
            root,
            (project.decisions["sitestudioConfig"] as string | null) ?? null,
          )
        : module.extract(root);
    if (project.decisions["usageSource"] === "none") markUntiered(document);
    invalidate(
      project,
      [
        ...(project.decisions["usageSource"] === "none" ? [] : ["usage"]),
        "capture",
        "plan",
        "components",
        "index",
        "verify",
      ],
      [
        "usage",
        "capture-evidence",
        "plan",
        "build-record",
        "index",
        "verify-report",
      ],
    );
    artifact(path, project, "components", "components", document);
    if (strategy === "drupal-authoring") {
      const module = await import("./extract-drupal-rendering.ts");
      artifact(
        path,
        project,
        "renderEvidence",
        "render-evidence",
        module.extract(root, document),
      );
    }
    setPhase(path, project, "inventory", "complete", {
      strategy,
      components: document.components.length,
    });
  }
  if (kind === "tokens" || kind === "all") {
    const strategy = String(project.decisions["tokenSource"]);
    if (!tokenModules[strategy])
      throw new Error(
        `token strategy ${strategy} has no extractor; run select`,
      );
    const config = project.decisions["sitestudioConfig"] as
      string | null | undefined;
    if (strategy === "sitestudio-styles" && !config)
      throw new Error(
        "no Site Studio configuration folder is recorded for this run: the site's settings do not name one; give it with select --sitestudio-config <folder>",
      );
    const module = (await import(
      pathToFileURL(resolve(pluginRoot, "src", tokenModules[strategy]! + ".ts"))
        .href
    )) as { extract(root: string, config?: string | null): unknown };
    const document =
      strategy === "sitestudio-styles"
        ? module.extract(root, config)
        : module.extract(root);
    invalidate(
      project,
      ["plan", "foundation", "components", "index", "verify"],
      [
        "plan",
        "variable-plan",
        "foundation",
        "build-record",
        "index",
        "verify-report",
      ],
    );
    artifact(path, project, "tokens", "tokens", document);
    setPhase(path, project, "tokens", "complete", { strategy });
  }
  return { project: path, phases: project.phases };
}
export interface UsageOptions {
  ddevRoot?: string;
  ddevProject?: string;
  baseUrl?: string;
  withoutTwigDebug?: boolean;
  high?: number;
  medium?: number;
}
export async function usageProject(
  value: string,
  args: UsageOptions = {},
): Promise<unknown> {
  const [path, project] = loadProject(value),
    strategy = project.decisions["usageSource"];
  if (strategy !== "drupal-db" && strategy !== "canvas-db")
    throw new Error(`usage strategy ${String(strategy)} has no extractor`);
  const folder = dirname(path),
    components = read<Components>(resolve(folder, "components.json")),
    root = resolve(args.ddevRoot ?? project.repository.root),
    high = args.high ?? 50,
    medium = args.medium ?? 10;
  const rendering = optional<JsonObject | null>(
    resolve(folder, "render-evidence.json"),
    null,
  );
  const drupal = await import("./extract-drupal-usage.ts"),
    canvas = await import("./extract-canvas-usage.ts");
  let document =
    strategy === "canvas-db"
      ? await canvas.extract(root, components, args.ddevProject)
      : await drupal.extract(root, components, args.ddevProject, rendering);
  const verification = document["source"]?.exampleVerification;
  if (
    strategy === "drupal-db" &&
    verification?.pagesFetched &&
    !verification.twigDebug &&
    !args.withoutTwigDebug
  )
    throw new Error(
      "Twig debug is off on the local site. Turn on Twig debug only (not the Twig cache switch), rebuild caches, and run usage again; pass --without-twig-debug to accept losing every component located by its template",
    );
  if (args.baseUrl) {
    const rendered = await import("./find-rendered-components.ts"),
      [evidence, details] = await rendered.scan(args.baseUrl, root, components);
    document = rendered.enrichUsage(document, evidence, details);
  }
  artifact(path, project, "usage", "usage", document);
  const merged =
    strategy === "canvas-db"
      ? canvas.mergeCanvasUsage(components, document, high, medium)
      : drupal.mergeUsage(components, document, high, medium);
  artifact(path, project, "components", "components", merged);
  invalidate(
    project,
    ["capture", "plan", "components", "index", "verify"],
    ["capture-evidence", "plan", "build-record", "index", "verify-report"],
  );
  const rows = Object.values(document["usage"]) as {
    placements: number;
    structuralRefs: number;
  }[];
  setPhase(path, project, "usage", "complete", {
    strategy,
    artifact: "usage",
    ddevRoot: root,
    ddevProject: args.ddevProject ?? null,
    components: rows.length,
    placements: rows.reduce((s, r) => s + r.placements, 0),
    structuralRefs: rows.reduce((s, r) => s + r.structuralRefs, 0),
    thresholds: { high, medium },
  });
  return project.phases["usage"];
}
export function planProject(value: string): unknown {
  const [path, project] = loadProject(value),
    folder = dirname(path),
    detection = optional<{ usageSources?: unknown[] }>(
      resolve(folder, "detection.json"),
      {},
    ),
    usageSource = project.decisions["usageSource"],
    status = project.phases["usage"]?.status;
  if (
    detection.usageSources?.length &&
    usageSource !== "none" &&
    status !== "complete"
  )
    throw new Error(
      "usage evidence was detected but is not complete; run usage, or obtain approval and select --usage none --degraded-reason <reason> --by <human-decider>",
    );
  if (
    detection.usageSources?.length &&
    usageSource === "none" &&
    status !== "waived"
  )
    throw new Error("degraded usage requires a recorded waiver");
  const components = read<Components>(resolve(folder, "components.json")),
    renders = optional<{ items: Record<string, RenderingSignals> }>(
      resolve(folder, "render-evidence.json"),
      { items: {} },
    ).items,
    captures = optional<{ captures: Record<string, CaptureSignals> }>(
      resolve(folder, "capture-evidence.json"),
      { captures: {} },
    ).captures;
  const relationships = optional<
      Record<string, { children?: Record<string, number> }>
    >(resolve(folder, "capture/relationships.json"), {}),
    nested: Record<string, number> = {};
  for (const evidence of Object.values(relationships))
    for (const [child, count] of Object.entries(evidence.children ?? {}))
      nested[child] = (nested[child] ?? 0) + count;
  const plans = components.components.map((c) =>
      planComponent(c, renders[c.id], captures[c.id], nested[c.id] ?? 0),
    ),
    document = {
      standardVersion: project.standardVersion,
      generatedAt: now(),
      maxVariants: 64,
      plans,
    };
  assertValid("plan", document);
  const file = resolve(folder, "plan.json");
  writePlanJson(file, document);
  register(path, project, "plan", file, "plan");
  invalidate(
    project,
    ["components", "index", "verify"],
    ["build-record", "index", "verify-report"],
  );
  setPhase(path, project, "plan", "awaiting-approval", {
    build: plans.filter((p) => p.verdict === "build").length,
    refuse: plans.filter((p) => p.verdict === "refuse").length,
    flags: plans.reduce((s, p) => s + p.flags.length, 0),
  });
  return project.phases["plan"];
}
export function variablesProject(value: string): unknown {
  const [path, project] = loadProject(value),
    document = build(read<TokenInput>(resolve(dirname(path), "tokens.json")));
  artifact(path, project, "variablePlan", "variable-plan", document);
  invalidate(
    project,
    ["foundation", "components", "index", "verify"],
    ["foundation", "build-record", "index", "verify-report"],
  );
  writeJson(path, project);
  return {
    output: resolve(dirname(path), "variable-plan.json"),
    collections: Object.keys(document.collections).length,
    warnings: document.warnings,
  };
}
