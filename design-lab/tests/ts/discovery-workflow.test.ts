import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pluginRoot } from "../../src/runtime.ts";
import { writeJson } from "../../src/contracts.ts";
import {
  detectProject,
  selectProject,
  extractProject,
  planProject,
  variablesProject,
} from "../../src/discovery-workflow.ts";
import {
  planComponent,
  naiveVariantCount,
  writePlanJson,
} from "../../src/plan.ts";
import { fetchPage, urljoin } from "../../src/extract-drupal-usage.ts";
import { extractComponent } from "../../src/extract-sdc.ts";
import { resolve as resolveToken } from "../../src/extract-tokens-sourcemap.ts";
const temp = () => mkdtempSync("/tmp/design-lab-p3-workflow-");
const put = (path: string, text: string) => {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
function project(root: string) {
  const run = temp();
  writeJson(join(run, "project.json"), {
    schemaVersion: 1,
    standardVersion: "3.0.0",
    pluginVersion: "test",
    repository: { root, commit: null, dirty: false },
    decisions: {},
    phases: {
      usage: { status: "pending" },
      inventory: { status: "pending" },
      tokens: { status: "pending" },
    },
    artifacts: {},
  });
  return run;
}
test("a person can choose another Site Studio export and extraction honors that choice", async () => {
  const root = temp();
  put(
    join(root, "docroot/sites/default/settings.php"),
    "<?php\n$settings['site_studio_sync'] = '../config/original';",
  );
  put(
    join(root, "config/original/cohesion_elements.cohesion_component.a.yml"),
    "id: a\nlabel: Original\njson_values: '{}'\nstatus: true\n",
  );
  put(
    join(root, "config/chosen/cohesion_elements.cohesion_component.b.yml"),
    "id: b\nlabel: Chosen\njson_values: '{}'\nstatus: true\n",
  );
  const run = project(root);
  detectProject(run);
  selectProject(run, {
    component: "sitestudio",
    sitestudioConfig: join(root, "config/chosen"),
  });
  await extractProject(run, "components");
  assert.deepEqual(
    JSON.parse(
      readFileSync(join(run, "components.json"), "utf8"),
    ).components.map((c: { id: string }) => c.id),
    ["b"],
  );
});
test("naming an undetected export makes Site Studio selectable in the same command", async () => {
  const root = temp();
  mkdirSync(join(root, "docroot/themes"), { recursive: true });
  put(
    join(root, "exports/cohesion_elements.cohesion_component.hero.yml"),
    "id: hero\nlabel: Hero\njson_values: '{}'\nstatus: true\n",
  );
  const run = project(root);
  detectProject(run);
  assert.throws(
    () => selectProject(run, { component: "sitestudio" }),
    /not a detected/,
  );
  selectProject(run, {
    component: "sitestudio",
    sitestudioConfig: join(root, "exports"),
  });
  await extractProject(run, "components");
  assert.equal(
    JSON.parse(readFileSync(join(run, "components.json"), "utf8")).components[0]
      .id,
    "hero",
  );
});
test("Canvas fixture drives the project pipeline and usage requires a recorded waiver", async () => {
  const root = temp();
  cpSync(join(pluginRoot, "tests/fixtures/canvas-site"), root, {
    recursive: true,
  });
  put(
    join(root, "web/themes/custom/demo/demo.libraries.yml"),
    "global:\n  css:\n    theme:\n      tokens.css: {}\n",
  );
  put(
    join(root, "web/themes/custom/demo/tokens.css"),
    ":root {--color-blue:#123456;--space-small:1rem}",
  );
  const run = project(root);
  detectProject(run);
  selectProject(run, { component: "canvas", token: "css-custom-properties" });
  await extractProject(run);
  assert.throws(() => planProject(run), /usage evidence/);
  assert.throws(() => selectProject(run, { usage: "none" }), /degraded-reason/);
  selectProject(run, {
    usage: "none",
    degradedReason: "fixture has no database",
    by: "test operator",
  });
  planProject(run);
  variablesProject(run);
  const components = JSON.parse(
    readFileSync(join(run, "components.json"), "utf8"),
  );
  assert.equal(components.components.length, 2);
  assert.equal(components.components[0].usage.placements, null);
  assert.equal(components.components[0].usage.tier, "Untiered");
});
test("Site Studio custom fixture retains the authored form in the inventory", async () => {
  const root = temp(),
    extension = join(root, "web/modules/custom/fixture");
  put(join(extension, "fixture.info.yml"), "name: Fixture\ntype: module\n");
  mkdirSync(join(extension, "custom_components"), { recursive: true });
  cpSync(
    join(pluginRoot, "tests/fixtures/sitestudio_custom"),
    join(extension, "custom_components/tiny"),
    { recursive: true },
  );
  const run = project(root);
  detectProject(run);
  await extractProject(run, "components");
  const inventory = JSON.parse(
    readFileSync(join(run, "components.json"), "utf8"),
  );
  assert.equal(inventory.components.length, 1);
  assert.equal(inventory.components[0].isCustomComponent, true);
  assert.ok(inventory.components[0].fields.length > 0);
});
test("large naive variant products are written as exact baseline integers", () => {
  const component = {
    id: "large",
    label: "Large",
    sourceRef: "test",
    fields: Array.from({ length: 40 }, (_, i) => ({
      name: String(i),
      kind: "enum",
      options: [{ value: "a" }, { value: "b" }],
    })),
    slots: [],
    defects: [],
  };
  const count = naiveVariantCount(component),
    file = join(temp(), "plan.json");
  writePlanJson(file, { plans: [planComponent(component)] });
  assert.equal(count, 3n ** 40n);
  assert.match(
    readFileSync(file, "utf8"),
    new RegExp('"naiveVariants": ' + count.toString()),
  );
});
test("raw Unicode aliases retain urllib unavailable-page behavior", async () => {
  const url = urljoin("https://local.ddev.site/", "/news/PNCB’sCEO");
  assert.match(url, /PNCB’s/);
  assert.deepEqual(await fetchPage(url), [0, ""]);
  assert.equal(
    urljoin("https://example.test/", "/encoded/%E2%80%99"),
    "https://example.test/encoded/%E2%80%99",
  );
});
test("SDC empty enums and authored enum labels retain baseline behavior", () => {
  const root = temp(),
    file = join(root, "label.component.yml");
  put(
    file,
    "name: Labels\nprops:\n  properties:\n    empty:\n      type: string\n      enum: []\n    mode:\n      type: string\n      enum: [HERO_BANNER, two-words, null, true]\n",
  );
  const component = extractComponent(file, root);
  assert.equal(component.fields[0].kind, "text");
  assert.deepEqual(
    component.fields[1].options.map((o: { label: string }) => o.label),
    ["Hero Banner", "Two Words", "None", "True"],
  );
});
test("Sass color lightness uses baseline's even half-tie rounding", () =>
  assert.equal(resolveToken("lighten(#000000, 30%)", new Map()), "#4c4c4c"));
