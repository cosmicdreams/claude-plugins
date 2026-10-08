/**
 * Detection, tokens, render evidence, plan, variable plan and merged usage are written through the closed schemas by
 * the real discovery commands. Each test builds a repository that takes the branches which add, omit or null a
 * field, runs the command, and reads the file back; a value the schema rejects makes the command fail and write nothing.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validate, writeArtifact } from '../../src/contracts.ts';
import { detectProject, extractProject, planProject, variablesProject } from '../../src/discovery-workflow.ts';
import { mergeUsage } from '../../src/extract-drupal-usage.ts';
import type { Components } from '../../src/generated/components.ts';
import type { Usage } from '../../src/generated/usage.ts';

const folders: string[] = [];
after(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});
const temp = () => {
  const folder = mkdtempSync('/tmp/design-lab-writer-discovery-');
  folders.push(folder);
  return folder;
};
const put = (root: string, path: string, text: string) => {
  const full = join(root, path);
  mkdirSync(resolve(full, '..'), { recursive: true });
  writeFileSync(full, text);
  return full;
};
const drupal = (root: string, settings = '') => {
  put(root, 'docroot/sites/default/settings.php', '<?php\n' + settings);
  put(root, 'config/default/system.site.yml', 'name: Example\n');
  return root;
};
function run(root: string, decisions: Record<string, unknown>, phases: Record<string, unknown> = {}) {
  const folder = temp();
  writeArtifact('project', join(folder, 'project.json'), {
    schemaVersion: 1,
    standardVersion: '3.0.0',
    pluginVersion: 'test',
    repository: { root, commit: null, dirty: false },
    decisions,
    phases: {
      discovery: { status: 'pending' },
      inventory: { status: 'pending' },
      usage: { status: 'pending' },
      tokens: { status: 'pending' },
      plan: { status: 'pending' },
      ...phases,
    },
    artifacts: {},
  });
  return folder;
}
const read = (folder: string, name: string): unknown => JSON.parse(readFileSync(join(folder, name), 'utf8'));
const valid = (kind: Parameters<typeof validate>[0], folder: string, name = kind + '.json') =>
  assert.deepEqual(validate(kind, read(folder, name)), []);

void test('detection writes for a Site Studio site with a declared export, custom components and every other source', () => {
  const root = drupal(temp(), "$settings['site_studio_sync'] = '../config/packages';\n");
  put(
    root,
    'config/packages/cohesion_elements.cohesion_component.hero.yml',
    "id: hero\nlabel: Hero\njson_values: '{}'\nstatus: true\n",
  );
  put(
    root,
    'config/packages/cohesion_custom_styles.cohesion_custom_style.a.yml',
    "id: a\nlabel: A\nclass_name: a\njson_values: '{}'\n",
  );
  put(root, 'docroot/modules/custom/m/m.info.yml', 'name: M\n');
  put(root, 'docroot/modules/custom/m/custom_components/bad/bad.custom_component.yml', 'name: Bad\n');
  put(
    root,
    'docroot/themes/custom/t/components/c/c.component.yml',
    'name: C\nprops:\n  properties:\n    k:\n      type: string\n      enum: [a, b]\nslots:\n  x: {}\n',
  );
  put(root, 'docroot/themes/custom/t/t.libraries.yml', 'g:\n  css:\n    theme:\n      css/a.css: {}\n');
  put(
    root,
    'docroot/themes/custom/t/css/a.css',
    ':root{' + Array.from({ length: 25 }, (_, i) => `--v${i}:#fff;`).join('') + '}',
  );
  put(
    root,
    'docroot/themes/custom/t/css/stray.css',
    ':root{' + Array.from({ length: 25 }, (_, i) => `--s${i}:#000;`).join('') + '}',
  );
  put(root, 'docroot/themes/custom/t/scss/v.scss', '$a: 1px;\n$b: 2px;\n');
  put(
    root,
    'docroot/themes/custom/t/css/a.css.map',
    JSON.stringify({ sources: ['a.scss'], sourcesContent: ['$x: 1;\n'] }),
  );
  put(root, 'config/default/canvas.component.sdc.t.c.yml', "id: sdc.t.c\nsource_local_id: 't:c'\n");
  put(root, 'config/default/paragraphs.paragraphs_type.one.yml', 'id: one\n');
  put(root, 'config/default/paragraphs.paragraphs_type.two.yml', 'id: two\n');
  put(root, 'config/default/paragraphs.paragraphs_type.three.yml', 'id: three\n');
  put(root, 'config/default/block_content.type.basic.yml', 'id: basic\n');
  put(root, 'tailwind.config.js', 'module.exports = {}');
  put(root, 'src/a.stories.js', 'x');
  put(root, 'notes/design-system.md', 'x');
  const folder = run(root, {});
  detectProject(folder);
  valid('detection', folder);
});

void test('detection writes for a Site Studio site whose export cannot be read, and for a site with no configuration', () => {
  const dynamic = drupal(temp(), "$settings['site_studio_sync'] = getenv('X') . '/c';\n");
  put(dynamic, 'docroot/modules/custom/m/custom_components/dup/dup.custom_component.yml', 'name: Dup\ncategory: c\n');
  const first = run(dynamic, {});
  detectProject(first);
  valid('detection', first);
  const bare = temp();
  mkdirSync(join(bare, 'docroot'), { recursive: true });
  const second = run(bare, {});
  detectProject(second);
  valid('detection', second);
});

void test('tokens: CSS custom properties with media modes, shadowed duplicates and an unreadable stylesheet all write', async () => {
  const root = drupal(temp());
  put(
    root,
    'docroot/themes/custom/demo/demo.libraries.yml',
    'global:\n  css:\n    theme:\n      css/tokens.css: {}\n      css/nested/tokens.css: {}\n      css/locked.css: {}\n',
  );
  put(
    root,
    'docroot/themes/custom/demo/css/tokens.css',
    ':root { --font-size-h1: 32px; --text: var(--ink); --ink: #111; --gap: 4px; }\n@media (min-width: 768px) { :root { --font-size-h1: 40px; } }\n.card { --gap: 8px; }\n',
  );
  put(root, 'docroot/themes/custom/demo/css/nested/tokens.css', ':root { --font-size-h1: 24px; --text: #333; }');
  put(root, 'docroot/themes/custom/demo/css/unloaded.css', ':root { --fake: #abc; }');
  const locked = put(root, 'docroot/themes/custom/demo/css/locked.css', ':root { --locked: 1px; }');
  chmodSync(locked, 0);
  try {
    const folder = run(root, { tokenSource: 'css-custom-properties' });
    await extractProject(folder, 'tokens');
    valid('tokens', folder);
  } finally {
    chmodSync(locked, 0o644);
  }
});

void test('tokens: Sass source with maps, base and component duplicates and an alias chain all write', async () => {
  const root = drupal(temp());
  put(
    root,
    'docroot/themes/custom/demo/source/00-config/_tokens.scss',
    '$brand: #123456;\n$surface-brand: $brand;\n$font-size-body: 1rem;\n$spacers: (\n  1: 4px,\n  2: 8px,\n);\n$grid-breakpoints: (\n  sm: 576px,\n);\n',
  );
  put(
    root,
    'docroot/themes/custom/demo/source/02-components/_card.scss',
    '$brand: #654321;\n$spacers-1: 5px;\n$card-radius: 4px !default;\n',
  );
  const folder = run(root, { tokenSource: 'sass-source' });
  await extractProject(folder, 'tokens');
  valid('tokens', folder);
});

void test('tokens: source maps with duplicate variables across sources, a broken map and a map without sources all write', async () => {
  const root = drupal(temp());
  put(
    root,
    'docroot/themes/custom/demo/css/theme.css.map',
    JSON.stringify({
      version: 3,
      sources: ['base/_tokens.scss', 'components/_card.scss'],
      sourcesContent: [
        '$brand: #526FDC;\n$primary-hover: lighten($brand, 10);\n',
        '$brand: #000000;\n$card-color: $primary-hover;\n$space: em(16);\n',
      ],
    }),
  );
  put(root, 'docroot/themes/custom/demo/css/broken.css.map', '{bad json');
  put(
    root,
    'docroot/themes/custom/demo/css/empty.css.map',
    JSON.stringify({ version: 3, sources: ['a.scss'], sourcesContent: [] }),
  );
  const folder = run(root, { tokenSource: 'sass-sourcemap' });
  await extractProject(folder, 'tokens');
  valid('tokens', folder);
});

void test('tokens: Site Studio settings without names, tags without values and non-string values all write', async () => {
  const root = drupal(temp());
  const cfg = 'config/sync/';
  put(
    root,
    cfg + 'cohesion_website_settings.cohesion_color.red.yml',
    'label: Brand red\njson_values: |\n  {"uid":"red","value":{"value":{"value":"#aabbcc"}},"variable":"$coh-color-red","class":"coh-color-red","tags":[{"value":"brand"},{}],"inuse":true}\n',
  );
  put(
    root,
    cfg + 'cohesion_website_settings.cohesion_color.empty.yml',
    'json_values: |\n  {"uid":"empty","value":{"value":{"value":""}}}\n',
  );
  put(
    root,
    cfg + 'cohesion_website_settings.cohesion_font_stack.body.yml',
    'json_values: |\n  {"uid":"body","fontStack":"Inter, sans-serif","systemfont":true}\n',
  );
  put(
    root,
    cfg + 'cohesion_website_settings.cohesion_scss_variable.space.yml',
    'json_values: |\n  {"uid":"space","value":{"value":16}}\n',
  );
  put(
    root,
    cfg + 'cohesion_website_settings.cohesion_scss_variable.flag.yml',
    'json_values: |\n  {"value":{"value":true}}\n',
  );
  put(
    root,
    cfg + 'cohesion_custom_styles.cohesion_custom_style.plain.yml',
    `json_values: |\n  ${JSON.stringify({ styles: { styles: { xl: { 'font-size': 32, 'line-height': '40px' }, md: { 'font-size': 24 } } } })}\n`,
  );
  const folder = run(root, { tokenSource: 'sitestudio-styles', sitestudioConfig: join(root, 'config/sync') });
  await extractProject(folder, 'tokens');
  valid('tokens', folder);
  const palette = read(folder, 'tokens.json') as import('../../src/generated/tokens.ts').Tokens;
  assert.deepEqual(palette.colors?.find((c) => c.uid === 'red')?.tags, ['brand', null]);
  variablesProject(folder);
  valid('variable-plan', folder);
});

void test('render evidence, plan and variable plan write for bundles with and without templates', async () => {
  const root = drupal(temp());
  put(root, 'config/default/paragraphs.paragraphs_type.hero.yml', 'id: hero\nlabel: Hero\n');
  put(root, 'config/default/paragraphs.paragraphs_type.bare.yml', 'id: bare\n');
  put(root, 'config/default/block_content.type.basic.yml', 'id: basic\nlabel: Basic\n');
  put(
    root,
    'config/default/field.storage.paragraph.field_title.yml',
    'field_name: field_title\ncardinality: 1\nsettings: {}\n',
  );
  put(
    root,
    'config/default/field.field.paragraph.hero.field_title.yml',
    'field_name: field_title\nfield_type: string\nlabel: Title\n',
  );
  put(
    root,
    'docroot/themes/custom/t/templates/paragraph/paragraph--hero.html.twig',
    '{% embed \'theme:card\' %}{% endembed %}<div class="hero">{{ content.field_title }}{{ content.field_other }}</div>',
  );
  put(root, 'docroot/themes/custom/t/components/card/card.component.yml', 'name: Card\n');
  put(
    root,
    'docroot/themes/custom/t/components/card/card.scss',
    '.card { color: red; .part { gap: 1rem; } @media (min-width: 1px) { margin: 0; } }',
  );
  put(root, 'docroot/themes/custom/t/templates/paragraph/paragraph.html.twig', '<div></div>');
  put(
    root,
    'docroot/themes/custom/t/css/tokens.css',
    ':root { --color-red: #f00; --color-red-alias: #f00; --color-text: #111; --space-1: 4px; }',
  );
  put(root, 'docroot/themes/custom/t/t.libraries.yml', 'g:\n  css:\n    theme:\n      css/tokens.css: {}\n');
  const folder = run(
    root,
    { componentSource: 'drupal-authoring', tokenSource: 'css-custom-properties', usageSource: 'none' },
    { usage: { status: 'waived', detail: { reason: 'none', by: 't' } } },
  );
  await extractProject(folder, 'all');
  valid('render-evidence', folder);
  valid('components', folder);
  valid('tokens', folder);
  planProject(folder);
  valid('plan', folder);
  variablesProject(folder);
  valid('variable-plan', folder);
});

void test('variable plan writes for tokens that lack code names, hex values and names', async () => {
  const root = drupal(temp());
  put(
    root,
    'docroot/themes/custom/demo/source/00-config/_tokens.scss',
    '$spacers: (\n  1: 4px,\n  2: 8px,\n);\n$brand: #123456;\n$surface-brand: $brand;\n$font-size-body: 1rem;\n',
  );
  const folder = run(root, { tokenSource: 'sass-source' });
  await extractProject(folder, 'tokens');
  variablesProject(folder);
  valid('variable-plan', folder);
  const siteStudio = temp();
  drupal(siteStudio);
  put(
    siteStudio,
    'config/sync/cohesion_website_settings.cohesion_color.noname.yml',
    'json_values: |\n  {"uid":"noname","value":{"value":{"value":"#aabbcc"}}}\n',
  );
  put(
    siteStudio,
    'config/sync/cohesion_website_settings.cohesion_font_stack.noname.yml',
    'json_values: |\n  {"uid":"noname","fontStack":"Inter, sans-serif"}\n',
  );
  put(
    siteStudio,
    'config/sync/cohesion_custom_styles.cohesion_custom_style.s.yml',
    `json_values: |\n  ${JSON.stringify({ styles: { styles: { xl: { 'font-size': '32px', color: '#fff', padding: '4px' } } } })}\n`,
  );
  const second = run(siteStudio, {
    tokenSource: 'sitestudio-styles',
    sitestudioConfig: join(siteStudio, 'config/sync'),
  });
  await extractProject(second, 'tokens');
  variablesProject(second);
  valid('variable-plan', second);
});

void test('a usage entry placed by a Site Studio template merges and writes into the component', () => {
  const components: Components = {
    standardVersion: '3.0.0',
    toolVersion: 't',
    generatedAt: 'now',
    source: { strategy: 'sitestudio', root: '/x' },
    components: [{ id: 'hero', label: 'Hero', sourceRef: 'a.yml', fields: [], slots: [], defects: [] }],
  };
  const usage: Usage = {
    standardVersion: '3.0.0',
    toolVersion: 't',
    generatedAt: 'now',
    source: { strategy: 'drupal-db', scope: 'published', definitions: {}, approot: '/x' },
    usage: { hero: { placements: 2, structuralRefs: 1, pages: 1, templates: ['cohesion_master_templates.main'] } },
    problems: [],
  };
  const merged = mergeUsage(components, usage),
    folder = temp();
  writeArtifact('components', join(folder, 'components.json'), merged);
  valid('components', folder);
});

void test('valid sparse token artifacts preserve null semantic hex values and font stacks in variable-plan writes', () => {
  const root = drupal(temp()),
    css = run(root, {}),
    studio = run(root, {});
  const cssTokens: import('../../src/generated/tokens.ts').Tokens = {
    standardVersion: '3.0.0',
    toolVersion: 'test',
    source: { strategy: 'css-custom-properties', root },
    tokens: [{ name: 'color-text', family: 'color', layer: 'base' }],
  };
  const studioTokens: import('../../src/generated/tokens.ts').Tokens = {
    standardVersion: '3.0.0',
    toolVersion: 'test',
    source: { strategy: 'sitestudio-styles', root },
    modes: ['Value'],
    colors: [{ name: null, hex: null }],
    fontStacks: [{ name: 'Body', primaryFamily: 'Inter' }],
    scssVariables: [],
    customStyles: [],
  };
  for (const [folder, tokens] of [
    [css, cssTokens],
    [studio, studioTokens],
  ] as const) {
    assert.deepEqual(validate('tokens', tokens), []);
    writeArtifact('tokens', join(folder, 'tokens.json'), tokens);
    variablesProject(folder);
    valid('variable-plan', folder);
  }
  const first = read(css, 'variable-plan.json') as import('../../src/generated/variable-plan.ts').VariablePlan;
  assert.ok(Object.values(first.collections).some((c) => c.variables.some((v) => v.hex === null)));
  const second = read(studio, 'variable-plan.json') as import('../../src/generated/variable-plan.ts').VariablePlan;
  assert.ok(Object.values(second.collections).some((c) => c.variables.some((v) => v.stack === null)));
  assert.ok(second.warnings?.some((w) => w.value === null));
});
