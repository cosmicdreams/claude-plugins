/** Component build proposals. Keep variant arithmetic and evidence gates identical to plan.ts. */
import type { Components } from "./generated/components.ts";
import { writeJson } from "./contracts.ts";

type Component = Components["components"][number];
type Field = Component["fields"][number];
export interface RenderingSignals {
  rootClasses?: unknown[];
  sdc?: unknown;
  templates?: unknown[];
}
export interface CaptureSignals {
  images?: unknown[];
  states?: unknown[];
  path?: string | null;
}
interface UsageSignals {
  placements?: number | null;
  structuralRefs?: number | null;
  structuralReferences?: number | null;
  status?: string;
  renderedPages?: number;
  globalTemplate?: boolean;
  templateRefs?: unknown[];
}
const truthy = (v: unknown): boolean =>
  Array.isArray(v)
    ? v.length > 0
    : v && typeof v === "object"
      ? Object.keys(v).length > 0
      : !!v;
export const MAX_VARIANTS = 64;
const exactNaiveCount = Symbol("baseline integer variant product");
export function naiveVariantCount(component: Component): bigint {
  return component.fields.reduce(
    (n, f) =>
      f.kind === "enum" && f.options?.length
        ? n * BigInt(Math.max(1, effectiveOptions(f)))
        : n,
    1n,
  );
}
export function variesBySide(field: Field): boolean {
  const sides = new Set<string>();
  for (const option of field.options ?? [])
    for (const match of String(option["value"] || "").matchAll(
      /padding-(top-bottom|left-right|top|bottom|left|right|small|medium|large|none)/g,
    )) {
      if (!["small", "medium", "large", "none"].includes(match[1]!))
        sides.add(match[1]!);
    }
  return sides.size > 1;
}
export function effectiveOptions(field: Field): number {
  const options = field.options ?? [];
  if (!options.length) return 0;
  return (
    options.length +
    (options.some((o) => o["value"] == null || o["value"] === "")
      ? 0
      : field.default == null || field.default === ""
        ? 1
        : 0)
  );
}
export function treat(field: Field): [string, number, string | null] {
  const n = effectiveOptions(field),
    kind = field.kind,
    family = field.tokenFamily;
  if (kind === "enum") {
    if (!n)
      return ["manual", 1, "no options could be extracted - resolve by hand"];
    if (family === "spacing")
      return [
        "variable",
        n,
        variesBySide(field)
          ? "options vary by which sides are padded - variant may be wanted"
          : null,
      ];
    if (family === "color-scheme" || family === "layout")
      return ["variant", n, null];
    if (n === 2) return ["boolean", 2, null];
    if (n <= 6) return ["variant", n, null];
    return [
      "manual",
      1,
      `${n} options and no token family - not built as a variant axis. Icon or media pickers want an instance swap; a long value list is usually tokens in disguise. Decide by hand.`,
    ];
  }
  if (kind === "richtext" || kind === "text") return ["text", 1, null];
  if (kind === "boolean") return ["boolean", 1, null];
  if (kind === "hidden" || kind === "help") return ["skip", 1, null];
  return ["manual", 1, null];
}
export function classify(
  component: Component,
  rendering: RenderingSignals = {},
  capture: CaptureSignals = {},
): [string, string, boolean, boolean] {
  const usage = (component["usage"] ?? {}) as UsageSignals;
  const placements = usage.placements || 0,
    structural = usage.structuralRefs || usage.structuralReferences || 0;
  const captured = !!capture.images?.length;
  const sdc = String(component.sourceRef || "").endsWith(".component.yml");
  const rendered = !!(
    usage.renderedPages ||
    usage.globalTemplate ||
    usage.templateRefs?.length
  );
  const signals = !!(
    rendering.rootClasses?.length ||
    truthy(rendering.sdc) ||
    rendering.templates?.length ||
    sdc ||
    component["isCustomComponent"] ||
    rendered ||
    captured
  );
  const contained = !!(component["containedBy"] as unknown[] | undefined)
    ?.length;
  const measured =
    !["unavailable", "partial", "unknown"].includes(usage.status ?? "") &&
    Number.isInteger(usage.placements) &&
    Number.isInteger(usage.structuralRefs ?? usage.structuralReferences);
  const role =
    measured && !placements && !structural && !rendered && !captured
      ? "retirement"
      : !signals
        ? "schema-only"
        : contained && !placements && !(sdc && captured)
          ? "subcomponent"
          : "component";
  const identity = captured
    ? role === "subcomponent"
      ? "embedded"
      : "independent"
    : signals
      ? "unverified"
      : "none";
  return [role, identity, captured, signals];
}
export function planComponent(
  component: Component,
  rendering: RenderingSignals = {},
  capture: CaptureSignals = {},
  nestedRenders = 0,
) {
  const axes: {
      field: string | undefined;
      label: string | undefined;
      options: number;
    }[] = [],
    properties: { field: string | undefined; treatment: string }[] = [],
    flags: { field: string | undefined; note: string }[] = [],
    skipped: (string | undefined)[] = [];
  for (const field of component.fields) {
    const [treatment, n, flag] = treat(field);
    if (flag) flags.push({ field: field.name, note: flag });
    if (treatment === "variant")
      axes.push({ field: field.name, label: field.label, options: n });
    else if (treatment === "skip") skipped.push(field.name);
    else properties.push({ field: field.name, treatment });
  }
  for (const slot of component.slots ?? [])
    properties.push({ field: slot.name, treatment: "swap" });
  const total = axes.reduce((n, a) => n * a.options, 1);
  const exactNaive = naiveVariantCount(component),
    naive = Number(exactNaive);
  const [role, identity, captured, signals] = classify(
    component,
    rendering,
    capture,
  );
  const refusal =
    total > MAX_VARIANTS
      ? `proposed ${total} variants exceeds maxVariants ${MAX_VARIANTS} - treat as a layout engine (auto-layout plus variable modes), not a variant set`
      : ["schema-only", "retirement"].includes(role)
        ? `source entity is ${role}, not an evidenced reusable visual component`
        : !captured
          ? "no component-scoped screenshot exists; capture visual and behavioral states before construction"
          : null;
  const verdict =
    role === "subcomponent" && !nestedRenders && !refusal
      ? "map"
      : refusal
        ? "refuse"
        : "build";
  const result = {
    id: component.id,
    label: component.label,
    libraryRole: role,
    visualIdentity: identity,
    visualEvidence: {
      captured,
      renderSignals: signals,
      path: capture.path ?? null,
      states: capture.states ?? [],
      images: capture.images ?? [],
    },
    variantAxes: axes,
    variants: total,
    naiveVariants: naive,
    properties,
    flags,
    skippedFields: skipped,
    verdict,
    refuseReason: refusal,
    defects: component.defects ?? [],
  };
  Object.defineProperty(result, exactNaiveCount, { value: exactNaive });
  return result;
}
/** Preserve baseline's arbitrary integer arithmetic on disk, including informational products
 * above Number.MAX_SAFE_INTEGER. In-process consumers retain the existing number-shaped API;
 * callers requiring the exact product can use naiveVariantCount(). */
export function writePlanJson(
  path: string,
  document: {
    plans: ReturnType<typeof planComponent>[];
  },
): string {
  const rawJSON = (JSON as typeof JSON & { rawJSON(text: string): unknown })
    .rawJSON;
  const plans = document.plans.map((plan) => {
    const exact = (plan as unknown as Record<symbol, bigint>)[exactNaiveCount];
    return exact === undefined
      ? plan
      : { ...plan, naiveVariants: rawJSON(exact.toString()) };
  });
  return writeJson(path, { ...document, plans });
}
