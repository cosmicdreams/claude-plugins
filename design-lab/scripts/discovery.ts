#!/usr/bin/env node
/** Phase-three CLI, retaining workflow.ts's detect/extract/usage/plan/variables flags. */
import { parseArgs } from "node:util";
import {
  detectProject,
  selectProject,
  extractProject,
  usageProject,
  planProject,
  variablesProject,
} from "../src/discovery-workflow.ts";
const [command, ...args] = process.argv.slice(2);
const definitions = {
  project: { type: "string", default: ".design-lab" },
  kind: { type: "string", default: "all" },
  component: { type: "string" },
  token: { type: "string" },
  usage: { type: "string" },
  "sitestudio-config": { type: "string" },
  "degraded-reason": { type: "string" },
  by: { type: "string" },
  "ddev-root": { type: "string" },
  "ddev-project": { type: "string" },
  "base-url": { type: "string" },
  "without-twig-debug": { type: "boolean" },
  high: { type: "string", default: "50" },
  medium: { type: "string", default: "10" },
} as const;
try {
  const { values } = parseArgs({ args, options: definitions });
  const project = values.project;
  const integer = (value: string): number => {
    if (!/^-?\d+$/.test(value))
      throw new Error(`expected an integer: ${value}`);
    return Number(value);
  };
  const result =
    command === "detect"
      ? detectProject(project)
      : command === "select"
        ? selectProject(project, {
            component: values.component,
            token: values.token,
            usage: values.usage,
            sitestudioConfig: values["sitestudio-config"],
            degradedReason: values["degraded-reason"],
            by: values.by,
          })
        : command === "extract"
          ? await extractProject(project, values.kind)
          : command === "usage"
            ? await usageProject(project, {
                ddevRoot: values["ddev-root"],
                ddevProject: values["ddev-project"],
                baseUrl: values["base-url"],
                withoutTwigDebug: values["without-twig-debug"],
                high: integer(values.high),
                medium: integer(values.medium),
              })
            : command === "plan"
              ? planProject(project)
              : command === "variables"
                ? variablesProject(project)
                : (() => {
                    throw new Error(
                      "usage: discovery.ts {detect|select|extract|usage|plan|variables} --project RUN",
                    );
                  })();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
