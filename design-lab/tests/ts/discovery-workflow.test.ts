import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { createServer } from 'node:http';
import { delimiter, join, resolve } from 'node:path';
import { pluginRoot } from '../../src/runtime.ts';
import { writeJson } from '../../src/contracts.ts';
import {
  detectProject,
  selectProject,
  extractProject,
  planProject,
  variablesProject,
  usageProject,
} from '../../src/discovery-workflow.ts';
import { planComponent, naiveVariantCount, writePlanJson } from '../../src/plan.ts';
import { fetchPage, urljoin } from '../../src/extract-drupal-usage.ts';
import { extractComponent } from '../../src/extract-sdc.ts';
import { resolve as resolveToken } from '../../src/extract-tokens-sourcemap.ts';
const temp = () => mkdtempSync('/tmp/design-lab-p3-workflow-');
const put = (path: string, text: string) => {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, text);
};
function project(root: string) {
  const run = temp();
  writeJson(join(run, 'project.json'), {
    schemaVersion: 1,
    standardVersion: '3.0.0',
    pluginVersion: 'test',
    repository: { root, commit: null, dirty: false },
    decisions: {},
    phases: {
      usage: { status: 'pending' },
      inventory: { status: 'pending' },
      tokens: { status: 'pending' },
    },
    artifacts: {},
  });
  return run;
}
void test('a person can choose another Site Studio export and extraction honors that choice', async () => {
  const root = temp();
  put(join(root, 'docroot/sites/default/settings.php'), "<?php\n$settings['site_studio_sync'] = '../config/original';");
  put(
    join(root, 'config/original/cohesion_elements.cohesion_component.a.yml'),
    "id: a\nlabel: Original\njson_values: '{}'\nstatus: true\n",
  );
  put(
    join(root, 'config/chosen/cohesion_elements.cohesion_component.b.yml'),
    "id: b\nlabel: Chosen\njson_values: '{}'\nstatus: true\n",
  );
  const run = project(root);
  detectProject(run);
  selectProject(run, {
    component: 'sitestudio',
    sitestudioConfig: join(root, 'config/chosen'),
  });
  await extractProject(run, 'components');
  assert.deepEqual(
    JSON.parse(readFileSync(join(run, 'components.json'), 'utf8')).components.map((c: { id: string }) => c.id),
    ['b'],
  );
});
void test('naming an undetected export makes Site Studio selectable in the same command', async () => {
  const root = temp();
  mkdirSync(join(root, 'docroot/themes'), { recursive: true });
  put(
    join(root, 'exports/cohesion_elements.cohesion_component.hero.yml'),
    "id: hero\nlabel: Hero\njson_values: '{}'\nstatus: true\n",
  );
  const run = project(root);
  detectProject(run);
  assert.throws(() => selectProject(run, { component: 'sitestudio' }), /not a detected/);
  selectProject(run, {
    component: 'sitestudio',
    sitestudioConfig: join(root, 'exports'),
  });
  await extractProject(run, 'components');
  assert.equal(JSON.parse(readFileSync(join(run, 'components.json'), 'utf8')).components[0].id, 'hero');
});
void test('Canvas fixture drives the project pipeline and usage requires a recorded waiver', async () => {
  const root = temp();
  cpSync(join(pluginRoot, 'tests/fixtures/canvas-site'), root, {
    recursive: true,
  });
  put(join(root, 'web/themes/custom/demo/demo.libraries.yml'), 'global:\n  css:\n    theme:\n      tokens.css: {}\n');
  put(join(root, 'web/themes/custom/demo/tokens.css'), ':root {--color-blue:#123456;--space-small:1rem}');
  const run = project(root);
  detectProject(run);
  selectProject(run, { component: 'canvas', token: 'css-custom-properties' });
  await extractProject(run);
  assert.throws(() => planProject(run), /usage evidence/);
  assert.throws(() => selectProject(run, { usage: 'none' }), /degraded-reason/);
  selectProject(run, {
    usage: 'none',
    degradedReason: 'fixture has no database',
    by: 'test operator',
  });
  planProject(run);
  variablesProject(run);
  const components = JSON.parse(readFileSync(join(run, 'components.json'), 'utf8'));
  assert.equal(components.components.length, 2);
  assert.equal(components.components[0].usage.placements, null);
  assert.equal(components.components[0].usage.tier, 'Untiered');
});
void test('Site Studio custom fixture retains the authored form in the inventory', async () => {
  const root = temp(),
    extension = join(root, 'web/modules/custom/fixture');
  put(join(extension, 'fixture.info.yml'), 'name: Fixture\ntype: module\n');
  mkdirSync(join(extension, 'custom_components'), { recursive: true });
  cpSync(join(pluginRoot, 'tests/fixtures/sitestudio_custom'), join(extension, 'custom_components/tiny'), {
    recursive: true,
  });
  const run = project(root);
  detectProject(run);
  await extractProject(run, 'components');
  const inventory = JSON.parse(readFileSync(join(run, 'components.json'), 'utf8'));
  assert.equal(inventory.components.length, 1);
  assert.equal(inventory.components[0].isCustomComponent, true);
  assert.ok(inventory.components[0].fields.length > 0);
});
void test('large naive variant products are written as exact baseline integers', () => {
  const component = {
    id: 'large',
    label: 'Large',
    sourceRef: 'test',
    fields: Array.from({ length: 40 }, (_, i) => ({
      name: String(i),
      kind: 'enum',
      options: [{ value: 'a' }, { value: 'b' }],
    })),
    slots: [],
    defects: [],
  };
  const count = naiveVariantCount(component),
    file = join(temp(), 'plan.json');
  writePlanJson(file, { standardVersion: '3.0.0', plans: [planComponent(component)] });
  assert.equal(count, 3n ** 40n);
  assert.match(readFileSync(file, 'utf8'), new RegExp('"naiveVariants": ' + count.toString()));
});
void test('raw Unicode aliases retain urllib unavailable-page behavior', async () => {
  const url = urljoin('https://local.ddev.site/', '/news/PNCB’sCEO');
  assert.match(url, /PNCB’s/);
  assert.deepEqual(await fetchPage(url), [0, '']);
  assert.equal(urljoin('https://example.test/', '/encoded/%E2%80%99'), 'https://example.test/encoded/%E2%80%99');
});
void test('SDC empty enums and authored enum labels retain baseline behavior', () => {
  const root = temp(),
    file = join(root, 'label.component.yml');
  put(
    file,
    'name: Labels\nprops:\n  properties:\n    empty:\n      type: string\n      enum: []\n    mode:\n      type: string\n      enum: [HERO_BANNER, two-words, null, true]\n',
  );
  const component = extractComponent(file, root);
  assert.equal(component.fields[0]!.kind, 'text');
  assert.deepEqual(
    component.fields[1]!.options!.map((o) => o.label),
    ['Hero Banner', 'Two Words', 'None', 'True'],
  );
});
void test("Sass color lightness uses baseline's even half-tie rounding", () =>
  assert.equal(resolveToken('lighten(#000000, 30%)', new Map()), '#4c4c4c'));

void test('re-extracting components keeps an approved Untiered usage waiver', async () => {
  const root = temp();
  cpSync(join(pluginRoot, 'tests/fixtures/canvas-site'), root, {
    recursive: true,
  });
  put(join(root, 'web/themes/custom/demo/demo.libraries.yml'), 'global:\n  css:\n    theme:\n      tokens.css: {}\n');
  put(join(root, 'web/themes/custom/demo/tokens.css'), ':root {--color-blue:#123456;--space-small:1rem}');
  const run = project(root);
  detectProject(run);
  selectProject(run, { component: 'canvas', token: 'css-custom-properties' });
  await extractProject(run, 'components');
  selectProject(run, {
    usage: 'none',
    degradedReason: 'fixture has no database',
    by: 'test operator',
  });
  await extractProject(run, 'components');
  const saved = JSON.parse(readFileSync(join(run, 'project.json'), 'utf8'));
  assert.equal(saved.phases.usage.status, 'waived');
  const components = JSON.parse(readFileSync(join(run, 'components.json'), 'utf8'));
  assert.equal(components.components[0].usage.placements, null);
  assert.equal(components.components[0].usage.tier, 'Untiered');
});

void test('usage refuses template-only evidence when Twig debug is off on the local site', async (t) => {
  const root = temp(),
    bin = temp(),
    page = createServer((request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(request.url === '/node/9' ? '<div class="paragraph paragraph--type--hero">Hero</div>' : '');
    });
  await new Promise<void>((done) => page.listen(0, '127.0.0.1', done));
  t.after(() => page.close());
  const address = page.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  // A stand-in `ddev` on PATH: it reports the project and answers the three queries the extractor issues.
  const fake = [
    `#!${process.execPath}`,
    'const args = process.argv.slice(2);',
    "if (args[0] === 'describe') {",
    `  process.stdout.write(JSON.stringify({ raw: { status: 'running', name: 'site', primary_url: 'http://127.0.0.1:${port}' } }));`,
    "} else if (args[0] === 'mysql') {",
    '  const sql = args.at(-1);',
    "  if (sql === 'SHOW TABLES;') process.stdout.write('paragraphs_item_field_data\\nnode_field_data\\n');",
    "  else if (sql.includes('FROM paragraphs_item_field_data')) process.stdout.write('1\\thero\\tnode\\t9\\t1\\n');",
    "  else if (sql.includes('FROM node_field_data')) process.stdout.write('9\\t1\\tpage\\n');",
    '}',
    '',
  ].join('\n');
  writeFileSync(join(bin, 'ddev'), fake, { mode: 0o755 });
  const previousPath = process.env['PATH'];
  process.env['PATH'] = `${bin}${delimiter}${previousPath ?? ''}`;
  t.after(() => {
    process.env['PATH'] = previousPath;
  });
  const run = temp();
  writeJson(join(run, 'components.json'), {
    components: [{ id: 'paragraph:hero', label: 'Hero', sourceRef: 'hero.yml', fields: [], slots: [], defects: [] }],
  });
  writeJson(join(run, 'project.json'), {
    schemaVersion: 1,
    standardVersion: '3.0.0',
    pluginVersion: 'test',
    repository: { root, commit: null, dirty: false },
    decisions: { usageSource: 'drupal-db' },
    phases: { usage: { status: 'pending' } },
    artifacts: {},
  });
  await assert.rejects(usageProject(run), /Twig debug is off on the local site/);
});
