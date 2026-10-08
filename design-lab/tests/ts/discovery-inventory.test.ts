import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve, relative } from "node:path";
import { detect, configSync, docroot } from "../../src/detect.ts";
import {
  configDir,
  customComponents,
  families,
} from "../../src/sitestudio-source.ts";
import { extract as extractSiteStudio } from "../../src/extract-sitestudio.ts";
import { extract as extractSdc } from "../../src/extract-sdc.ts";
import { extract as extractCanvas } from "../../src/extract-canvas.ts";
import { extract as extractAuthoring } from "../../src/extract-drupal-authoring.ts";
import { extract as extractRendering } from "../../src/extract-drupal-rendering.ts";
import { extractFile } from "../../src/extract-sass-style-facts.ts";

const temp = () => mkdtempSync("/tmp/design-lab-p3-discovery-");
const put = (root: string, path: string, text: string) => {
  const full = join(root, path);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, text);
  return full;
};
function site(root: string, settings?: string) {
  mkdirSync(join(root, "docroot/sites/default"), { recursive: true });
  mkdirSync(join(root, "docroot/themes/custom"), { recursive: true });
  mkdirSync(join(root, "config/default"), { recursive: true });
  put(root, "config/default/system.site.yml", "name: Example\n");
  if (settings)
    put(
      root,
      "docroot/sites/default/settings.php",
      "<?php\n" + settings + "\n",
    );
  return root;
}

test("Site Studio folder selection reads literal PHP values and refuses ambiguous or dynamic settings", () => {
  const root = site(
    temp(),
    "$settings['site_studio_sync'] = $app_root . '/../config/packages';",
  );
  mkdirSync(join(root, "config/packages"), { recursive: true });
  const found = configDir(root);
  assert.equal(relative(root, found.path!), "config/packages");
  assert.match(found.from!, /settings.php:2 \(site_studio_sync\)/);
  const dynamic = site(
    temp(),
    "$settings['site_studio_sync'] = getenv('SITE_STUDIO') . '/config';",
  );
  const result = configDir(dynamic);
  assert.equal(result.path, null);
  assert.match(result.problem!, /cannot be read without running PHP/);
});

test("Site Studio resolves each supported static expression, ignores comments, and excludes generated settings", () => {
  const cases: [string, string][] = [
    [
      "$settings['site_studio_sync'] = $app_root . '/../config/sitestudio';",
      "config/sitestudio",
    ],
    ["$settings['site_studio_sync'] ='../config/packages';", "config/packages"],
    ["$settings[\"site_studio_sync\"] = DRUPAL_ROOT . '/../export';", "export"],
    ["$settings['site_studio_sync'] = __DIR__ . '/../../../ss';", "ss"],
    [
      "$settings['site_studio_sync'] = '/var/www/html/config/packages';",
      "config/packages",
    ],
  ];
  for (const [line, expected] of cases) {
    const root = site(temp(), line);
    mkdirSync(join(root, expected), { recursive: true });
    assert.equal(relative(root, configDir(root).path!), expected, line);
  }
  const comments = site(
    temp(),
    "// $settings['site_studio_sync'] = '../config/old';\n$settings['site_studio_sync'] = '../config/packages';",
  );
  mkdirSync(join(comments, "config/packages"), { recursive: true });
  assert.equal(
    relative(comments, configDir(comments).path!),
    "config/packages",
  );
  const generated = site(
    temp(),
    "$settings['site_studio_sync'] = '../config/packages';",
  );
  mkdirSync(join(generated, "config/packages"), { recursive: true });
  writeFileSync(
    join(generated, "docroot/sites/default/settings.ddev.php"),
    "<?php\n$settings['site_studio_sync'] = '../config/packages';\n",
  );
  writeFileSync(
    join(generated, "docroot/sites/default/settings.php"),
    "<?php\n",
  );
  assert.equal(configDir(generated).path, null);
});

test("Site Studio requires an explicit export choice for missing, unreadable, or disagreeing settings", () => {
  const unreadable = site(
    temp(),
    "$settings['site_studio_sync'] = '../config/packages';\n$settings['site_studio_sync'] = getenv('SS');",
  );
  mkdirSync(join(unreadable, "config/packages"), { recursive: true });
  assert.match(
    configDir(unreadable).problem!,
    /cannot be read without running PHP/,
  );
  const missing = site(
    temp(),
    "$settings['site_studio_sync'] = '../config/gone';\n$settings['config_sync_directory'] = '../config/packages';",
  );
  mkdirSync(join(missing, "config/packages"), { recursive: true });
  assert.match(configDir(missing).problem!, /does not exist/);
  const multi = site(
    temp(),
    "$settings['site_studio_sync'] = '../config/packages';",
  );
  mkdirSync(join(multi, "config/packages"), { recursive: true });
  mkdirSync(join(multi, "config/other"), { recursive: true });
  mkdirSync(join(multi, "docroot/sites/other"), { recursive: true });
  writeFileSync(
    join(multi, "docroot/sites/other/settings.php"),
    "<?php\n$settings['site_studio_sync'] = '../config/other';\n",
  );
  assert.match(configDir(multi).problem!, /2 different values/);
  const noGuess = site(temp());
  mkdirSync(join(noGuess, "config/sitestudio"), { recursive: true });
  assert.equal(configDir(noGuess).path, null);
  assert.match(configDir(noGuess).problem!, /--sitestudio-config/);
});

test("literal settings preserve quotes, slashes, semicolons, and other comment-like characters", () => {
  const cases: [string, string][] = [
    ["$settings['site_studio_sync'] = '../config/a/*x*/b';", "config/a/*x*/b"],
    ["$settings['site_studio_sync'] = '../config/a #b';", "config/a #b"],
    ["$settings['site_studio_sync'] = '../config/a //b';", "config/a /b"],
    ["$settings['site_studio_sync'] = '../config/o\"ne';", 'config/o"ne'],
    ["$settings['site_studio_sync'] = \"../config/it's\";", "config/it's"],
    ["$settings['site_studio_sync'] = '../config/it\\'s';", "config/it's"],
    ["$settings['site_studio_sync'] = '../config/a;b';", "config/a;b"],
  ];
  for (const [setting, path] of cases) {
    const root = site(temp(), setting);
    mkdirSync(join(root, path), { recursive: true });
    assert.equal(relative(root, configDir(root).path!), path, setting);
  }
});

test("Drupal config setting can select a Site Studio export when no dedicated setting exists", () => {
  const root = site(
    temp(),
    "$settings['config_sync_directory'] = '../config/sync';",
  );
  mkdirSync(join(root, "config/sync"), { recursive: true });
  put(
    root,
    "config/sync/cohesion_elements.cohesion_component.hero.yml",
    "id: hero\n",
  );
  const chosen = configDir(root);
  assert.equal(relative(root, chosen.path!), "config/sync");
  assert.match(chosen.from!, /config_sync_directory/);
});

test("custom Site Studio components obey extension precedence, filename identity, and no-form behavior", () => {
  const root = site(temp());
  put(
    root,
    "docroot/modules/custom/kit/kit.info.yml",
    "name: Kit\ntype: module\n",
  );
  const component = "name: Tiny Custom\ncategory: custom_category\n";
  put(
    root,
    "docroot/modules/custom/kit/custom_components/tiny/tiny.custom_component.yml",
    component,
  );
  const result = extractSiteStudio(root);
  assert.deepEqual(
    result.components.map((c: any) => [c.id, c.fields]),
    [["tiny", []]],
  );
  assert.deepEqual(result.problems, []);
  const found = customComponents(root)[0];
  assert.equal(found.length, 1);
  assert.deepEqual(
    detect(root).componentSources.map((x: any) => x.strategy),
    ["sitestudio"],
  );
});

test("custom Site Studio components are found below nested groups and use the definition filename as ID", () => {
  const root = site(temp());
  put(
    root,
    "docroot/modules/custom/kit/kit.info.yml",
    "name: Kit\ntype: module\n",
  );
  put(
    root,
    "docroot/modules/custom/kit/custom_components/group/deep/banner.custom_component.yml",
    "name: Banner\ncategory: demo\n",
  );
  assert.deepEqual(
    extractSiteStudio(root).components.map((c: any) => c.id),
    ["banner"],
  );
});

test("a malformed custom form becomes a scoped problem while other components remain available", () => {
  const root = site(temp());
  put(
    root,
    "docroot/themes/custom/good/good.info.yml",
    "name: Good\ntype: theme\n",
  );
  put(
    root,
    "docroot/themes/custom/good/custom_components/tiny/tiny.custom_component.yml",
    "name: Tiny\ncategory: demo\n",
  );
  put(
    root,
    "docroot/themes/custom/broken/broken.info.yml",
    "name: Broken\ntype: theme\n",
  );
  put(
    root,
    "docroot/themes/custom/broken/custom_components/bad/bad.custom_component.yml",
    "name: Bad\ncategory: demo\nform: form.json\n",
  );
  put(
    root,
    "docroot/themes/custom/broken/custom_components/bad/form.json",
    "{bad",
  );
  const result = extractSiteStudio(root);
  assert.deepEqual(
    result.components.map((c: any) => c.id),
    ["tiny"],
  );
  assert.equal(result.problems![0]!.kind, "unparseable-custom-component");
});

test("custom Site Studio search follows symlinked extensions and reports duplicate names by precedence", () => {
  const root = site(temp()),
    outside = temp();
  put(outside, "shared/shared.info.yml", "name: Shared\ntype: module\n");
  put(
    outside,
    "shared/custom_components/banner/banner.custom_component.yml",
    "name: Banner\ncategory: demo\n",
  );
  mkdirSync(join(root, "docroot/modules/custom"), { recursive: true });
  symlinkSync(
    join(outside, "shared"),
    join(root, "docroot/modules/custom/linked"),
  );
  put(
    root,
    "docroot/themes/custom/theme/theme.info.yml",
    "name: Theme\ntype: theme\n",
  );
  put(
    root,
    "docroot/themes/custom/theme/custom_components/banner/banner.custom_component.yml",
    "name: Other banner\ncategory: demo\n",
  );
  const [paths, problems] = customComponents(root);
  assert.equal(paths.length, 1);
  assert.match(paths[0]!, /docroot\/modules\/custom\/linked/);
  assert.equal(problems[0]!.kind, "duplicate-custom-component");
});

test("custom Site Studio discovery follows linked component folders and skips contrib, core, blocked, and nested search roots", () => {
  const root = temp(),
    outside = temp();
  mkdirSync(join(root, "web/sites/default"), { recursive: true });
  mkdirSync(join(root, "web/themes/custom"), { recursive: true });
  mkdirSync(join(root, "config/default"), { recursive: true });
  put(root, "config/default/system.site.yml", "name: Example\n");
  put(root, "web/modules/custom/kit/kit.info.yml", "name: Kit\ntype: module\n");
  put(
    outside,
    "shared/banner.custom_component.yml",
    "name: Banner\ncategory: demo\n",
  );
  mkdirSync(join(root, "web/modules/custom/kit/custom_components"), {
    recursive: true,
  });
  symlinkSync(
    join(outside, "shared"),
    join(root, "web/modules/custom/kit/custom_components/shared"),
  );
  for (const p of [
    "web/modules/contrib/ignored",
    "web/core/modules/ignored",
    "web/themes/contrib/ignored",
  ]) {
    put(
      root,
      `${p}/${p.split("/").at(-1)}.info.yml`,
      "name: ignored\ntype: module\n",
    );
    put(
      root,
      `${p}/custom_components/ghost/ghost.custom_component.yml`,
      "name: Ghost\ncategory: demo\n",
    );
  }
  put(
    root,
    "web/modules/custom/kit/custom_components/fixtures/test_only/test_only.custom_component.yml",
    "name: Test\ncategory: demo\n",
  );
  put(
    root,
    "web/modules/custom/kit/nested/custom_components/nested/nested.custom_component.yml",
    "name: Nested\ncategory: demo\n",
  );
  put(
    root,
    "web/modules/custom/kit/custom_components/9bad/9bad.custom_component.yml",
    "name: Bad\ncategory: demo\n",
  );
  put(
    root,
    "web/modules/custom/kit/custom_components/no_category/no_category.custom_component.yml",
    "name: Missing\n",
  );
  const [paths, problems, known] = customComponents(root);
  assert.equal(known, false);
  assert.equal(paths.length, 1);
  assert.equal(basename(paths[0]!), "banner.custom_component.yml");
  assert.deepEqual(
    problems.map((x) => x.kind),
    ["invalid-custom-component"],
  );
});

test("Site Studio config components retain field and option semantics", () => {
  const root = site(
    temp(),
    "$settings['site_studio_sync'] = '../config/packages';",
  );
  mkdirSync(join(root, "config/packages"), { recursive: true });
  put(
    root,
    "config/packages/cohesion_elements.cohesion_component.hero.yml",
    'id: hero\nlabel: Hero\njson_values: \'{"model": {"title-uid": {"settings": {"machineName": "title", "title": "Title", "type": "cohTextBox", "required": true}, "model": {"value": "Hello"}}, "style-uid": {"settings": {"machineName": "style", "title": "Style", "type": "cohSelect", "options": [{"value": "left", "label": "Left"}]}, "model": {"value": "left"}}}}\'\nstatus: true\n',
  );
  const c = extractSiteStudio(root).components[0]!;
  assert.equal(c.id, "hero");
  assert.equal(c.fields[0]!.kind, "text");
  assert.equal(c.fields[0]!.required, true);
  assert.deepEqual(c.fields[1]!.options, [{ value: "left", label: "Left" }]);
});

test("Site Studio renders multiple drop-zone markers as one universal slot", () => {
  const root = site(
    temp(),
    "$settings['site_studio_sync'] = '../config/packages';",
  );
  mkdirSync(join(root, "config/packages"), { recursive: true });
  put(
    root,
    "config/packages/cohesion_elements.cohesion_component.layout.yml",
    `id: layout\nlabel: Layout\njson_values: '{"canvas": [{"uid": "component-drop-zone"}, {"uid": "component-drop-zone"}], "model": {}}'\nstatus: true\n`,
  );
  const c = extractSiteStudio(root).components[0]!;
  assert.deepEqual(c.slots, [
    { name: "content", label: "Component drop zone", accepts: ["*"] },
  ]);
});

test("detection chooses authoring bundles over a larger incidental SDC inventory", () => {
  const root = site(temp());
  put(root, "config/default/block_content.type.basic.yml", "id: basic\n");
  put(root, "config/default/paragraphs.paragraphs_type.text.yml", "id: text\n");
  for (const name of ["a", "b", "c"])
    put(
      root,
      `docroot/themes/custom/theme/${name}/${name}.component.yml`,
      "name: Item\n",
    );
  const out = detect(root);
  assert.equal(out.recommended.component, "drupal-authoring");
  assert.equal(
    out.componentSources.find((x) => x.strategy === "sdc")!.count,
    3,
  );
  assert.equal(configSync(root), join(root, "config/default"));
  assert.equal(docroot(root), join(root, "docroot"));
});

test("Site Studio source outranks a few incidental Drupal authoring bundles", () => {
  const root = site(
    temp(),
    "$settings['site_studio_sync'] = '../config/packages';",
  );
  mkdirSync(join(root, "config/packages"), { recursive: true });
  put(root, "config/default/block_content.type.basic.yml", "id: basic\n");
  put(root, "config/default/paragraphs.paragraphs_type.text.yml", "id: text\n");
  for (const id of ["cta", "card", "hero"])
    put(
      root,
      `config/packages/cohesion_elements.cohesion_component.cpt_${id}.yml`,
      `id: ${id}\n`,
    );
  assert.equal(detect(root).recommended.component, "sitestudio");
});

test("recording no Site Studio export suppresses config reads, and known inactive extensions are skipped", () => {
  const root = site(
    temp(),
    "$settings['site_studio_sync'] = '../config/packages';",
  );
  mkdirSync(join(root, "config/packages"), { recursive: true });
  put(
    root,
    "config/packages/cohesion_elements.cohesion_component.hero.yml",
    "id: hero\nlabel: Hero\njson_values: '{\"model\": {}}'\nstatus: true\n",
  );
  assert.deepEqual(extractSiteStudio(root, null).components, []);
  assert.equal(extractSiteStudio(root).components.length, 1);
  const active = site(
    temp(),
    "$settings['config_sync_directory'] = '../config/default';",
  );
  put(
    active,
    "config/default/core.extension.yml",
    "module:\n  active_module: 0\n",
  );
  for (const name of ["active_module", "disabled_module"]) {
    put(
      active,
      `docroot/modules/custom/${name}/${name}.info.yml`,
      `name: ${name}\ntype: module\n`,
    );
    put(
      active,
      `docroot/modules/custom/${name}/custom_components/${name}/${name}.custom_component.yml`,
      `name: ${name}\ncategory: demo\n`,
    );
  }
  const [paths, , known] = customComponents(active);
  assert.equal(known, true);
  assert.deepEqual(
    paths.map((p) => basename(p)),
    ["active_module.custom_component.yml"],
  );
});

test("token detection uses loaded stylesheet paths and excludes the active workspace from prior art", () => {
  const root = site(temp());
  put(
    root,
    "docroot/themes/custom/test/test.libraries.yml",
    "global:\n  css:\n    theme:\n      dist/index.css: {}\n",
  );
  put(
    root,
    "docroot/themes/custom/test/source/card/index.css",
    ":root { --fake-1: #111; --fake-2: #222; }\n",
  );
  put(
    root,
    "docroot/themes/custom/test/source/00-config/scss/settings/_colors.scss",
    "$brand: #123456;\n",
  );
  mkdirSync(join(root, ".design-lab/figma-batches"), { recursive: true });
  const out = detect(root),
    css = out.tokenSources.find(
      (x: any) => x.strategy === "css-custom-properties",
    );
  assert.equal(css!.variablesLoadedByTheme, 0);
  assert.equal(out.recommended.token, "sass-source");
  assert.equal(
    out.priorArt.some((x: any) => x.path.startsWith(".design-lab")),
    false,
  );
});

test("SDC and Canvas inventory include registered custom-theme components only", () => {
  const root = site(temp());
  mkdirSync(join(root, "config/default"), { recursive: true });
  put(
    root,
    "docroot/themes/custom/acme/card/card.component.yml",
    "name: Card\nprops:\n  required: [title]\n  properties:\n    title:\n      type: string\n      enum: [small, large]\nslots:\n  body:\n    title: Body\n",
  );
  put(
    root,
    "config/default/canvas.component.sdc.acme.card.yml",
    "id: card\nsource_local_id: acme:card\nlabel: Editorial Card\nactive_version: 2\nversioned_properties:\n  active:\n    settings:\n      prop_field_definitions:\n        title:\n          field_type: string\n          required: true\n",
  );
  const sdc = extractSdc(root);
  assert.equal(sdc.components[0]!.fields[0]!.required, true);
  assert.equal(sdc.components[0]!.fields[0]!.kind, "enum");
  const canvas = extractCanvas(root);
  assert.equal(canvas.components[0]!.id, "card");
  assert.equal(canvas.components[0]!.label, "Editorial Card");
  assert.equal(canvas.components[0]!.componentVersion, 2);
});

test("Canvas detection sees custom theme directories without info files and only direct config globs", () => {
  const root = site(temp());
  mkdirSync(join(root, "docroot/themes/custom/no_info"), { recursive: true });
  put(
    root,
    "config/default/canvas.component.sdc.no_info.card.yml",
    "id: card\n",
  );
  put(
    root,
    "config/default/nested/canvas.component.sdc.no_info.ignored.yml",
    "id: ignored\n",
  );
  const out = detect(root),
    canvas = out.componentSources.find((x: any) => x.strategy === "canvas");
  assert.equal(canvas!.count, 1);
});

test("Site Studio family detection uses direct export entries, not nested lookalikes", () => {
  const root = site(
    temp(),
    "$settings['site_studio_sync'] = '../config/packages';",
  );
  mkdirSync(join(root, "config/packages/nested"), { recursive: true });
  put(
    root,
    "config/packages/cohesion_elements.cohesion_component.hero.yml",
    `id: hero\nlabel: Hero\njson_values: '{"model": {}}'\nstatus: true\n`,
  );
  put(
    root,
    "config/packages/nested/cohesion_elements.cohesion_component.fake.yml",
    "id: fake\n",
  );
  assert.deepEqual(families(join(root, "config/packages")), {
    "cohesion_elements.cohesion_component": 1,
  });
  assert.equal(extractSiteStudio(root).components.length, 1);
});

test("prior-art scan observes its documented depth, includes symlink directory names, and does not follow links", () => {
  const root = site(temp()),
    outside = temp();
  put(root, "reports/component-library.md", "existing\n");
  put(root, "reports/a/b/c/design-system.md", "too deep\n");
  put(outside, "design-system/deep/figma/hidden.txt", "outside\n");
  mkdirSync(join(root, "reports/linked"), { recursive: true });
  symlinkSync(
    join(outside, "design-system"),
    join(root, "reports/linked/figma-directory"),
  );
  const hits = detect(root).priorArt.map((h: any) => [h.path, h.kind]);
  assert.ok(
    hits.some(
      (h: any) => h[0] === "reports/component-library.md" && h[1] === "file",
    ),
  );
  assert.ok(!hits.some((h: any) => h[0] === "reports/a/b/c/design-system.md"));
  assert.ok(
    hits.some(
      (h: any) =>
        h[0] === "reports/linked/figma-directory" && h[1] === "directory",
    ),
  );
  assert.ok(!hits.some((h: any) => h[0].includes("figma-directory/deep")));
});

test("Drupal authoring resolves paragraph slots and predefined field kinds; Twig evidence stays source-bounded", () => {
  const root = site(temp());
  put(
    root,
    "config/default/paragraphs.paragraphs_type.layout.yml",
    "id: layout\nlabel: Layout\n",
  );
  put(
    root,
    "config/default/paragraphs.paragraphs_type.text.yml",
    "id: text\nlabel: Text\n",
  );
  put(
    root,
    "config/default/field.storage.paragraph.field_items.yml",
    "field_name: field_items\ncardinality: -1\nsettings:\n  target_type: paragraph\n",
  );
  put(
    root,
    "config/default/field.field.paragraph.layout.field_items.yml",
    "field_name: field_items\nfield_type: entity_reference_revisions\nlabel: Items\nsettings:\n  handler_settings:\n    target_bundles:\n      text: text\n",
  );
  const authored = extractAuthoring(root);
  const layout = authored.components.find(
    (c: any) => c.id === "paragraph:layout",
  );
  assert.equal(layout!.slots[0]!.accepts![0], "paragraph:text");
  const sass = put(
    root,
    "docroot/themes/custom/theme/templates/paragraph/paragraph--layout.scss",
    ".layout { color: red; .part { gap: 1rem; } }",
  );
  const facts = extractFile(sass);
  assert.equal(facts.rootRules[0]!.selector, ".layout");
  assert.equal(facts.partRules[0]!.selector, ".part");
  put(
    root,
    "docroot/themes/custom/theme/templates/paragraph/paragraph--layout.html.twig",
    "{% embed 'theme:card' %}{% endembed %}{{ include('theme:card') }}{% include 'theme:button' %}<div {{ attributes.addClass('layout') }}>{{ content.field_items }}</div>",
  );
  put(
    root,
    "docroot/themes/custom/theme/components/card/card.component.yml",
    "name: Card\n",
  );
  put(
    root,
    "docroot/themes/custom/theme/components/card/card.scss",
    ".card { color: blue; }",
  );
  const rendered = extractRendering(root, {
    components: [
      { id: "paragraph:layout", fields: [], slots: [{ name: "field_items" }] },
    ],
  });
  const item = rendered.items["paragraph:layout"]!;
  assert.equal(item.rootSdc, "theme:card");
  assert.deepEqual(item.sdc, ["theme:card", "theme:button"]);
  assert.ok(
    item.stylesheets.includes(
      "docroot/themes/custom/theme/components/card/card.scss",
    ),
  );
  assert.equal(item.referencedFields[0], "field_items");
});

test("Drupal authoring replaces list placeholders with predefined options and maps contrib field types", () => {
  const root = site(temp());
  put(
    root,
    "config/default/block_content.type.basic.yml",
    "id: basic\nlabel: Basic\n",
  );
  put(
    root,
    "config/default/field.storage.block_content.field_style.yml",
    "field_name: field_style\nsettings:\n  allowed_values:\n    - value: placeholder\n      label: Placeholder\nthird_party_settings:\n  list_predefined_options:\n    plugin_id: example_styles\n",
  );
  put(
    root,
    "config/default/field.field.block_content.basic.field_style.yml",
    "field_name: field_style\nfield_type: list_string\nlabel: Style\n",
  );
  put(
    root,
    "config/default/field.storage.block_content.field_email.yml",
    "field_name: field_email\nsettings: {}\n",
  );
  put(
    root,
    "config/default/field.field.block_content.basic.field_email.yml",
    "field_name: field_email\nfield_type: email\nlabel: Email\n",
  );
  put(
    root,
    "config/default/field.storage.block_content.field_date.yml",
    "field_name: field_date\nsettings: {}\n",
  );
  put(
    root,
    "config/default/field.field.block_content.basic.field_date.yml",
    "field_name: field_date\nfield_type: smartdate\nlabel: Date\n",
  );
  put(
    root,
    "docroot/modules/custom/example/src/Plugin/ListOptions/Styles.php",
    "<?php\n/** @ListOptions(\n * id = 'example_styles'\n * )\n */\npublic function getListOptions() { return ['plain' => $this->t('Plain'), 'feature' => $this->t('Feature')]; }\n",
  );
  const c = extractAuthoring(root).components[0]!,
    fields = Object.fromEntries(c.fields.map((f: any) => [f.name, f]));
  assert.deepEqual(fields['field_style'].options, [
    { value: "plain", label: "Plain" },
    { value: "feature", label: "Feature" },
  ]);
  assert.equal(fields['field_email'].kind, "text");
  assert.equal(fields['field_date'].kind, "text");
  assert.equal(c.defects.length, 0);
});
