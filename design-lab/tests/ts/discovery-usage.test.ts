import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as usage from '../../src/extract-drupal-usage.ts';
import * as canvas from '../../src/extract-canvas-usage.ts';
import * as twig from '../../src/capture/twig.ts';
import { validate } from '../../src/contracts.ts';

type ExternalObject = Record<string, unknown>;
const fixtures = resolve(fileURLToPath(new URL('.', import.meta.url)), '../fixtures');
const temp = (): string => mkdtempSync(join(tmpdir(), 'design-lab-p3-'));

// ---- fake DDEV: records every command and answers the ones the extractors issue ----
type Call = { command: string; args: string[]; cwd: string };
function fakeDdev(
  answers: {
    tables?: string[];
    running?: boolean;
    name?: string;
    failOn?: RegExp;
    sqlq?: Record<string, string>;
  } = {},
) {
  const calls: Call[] = [];
  const run: usage.Runner = (command, args, cwd) => {
    calls.push({ command, args, cwd });
    const joined = args.join(' ');
    if (answers.failOn?.test(joined)) return { status: 1, stdout: '', stderr: 'boom\n' };
    if (args[0] === 'describe')
      return {
        status: 0,
        stdout: JSON.stringify({
          raw: {
            status: answers.running === false ? 'stopped' : 'running',
            name: answers.name ?? 'site',
            primary_url: 'https://site.ddev.site',
          },
        }),
        stderr: '',
      };
    if (args[0] === 'mysql')
      return {
        status: 0,
        stdout: args.at(-1) === 'SHOW TABLES;' ? (answers.tables ?? []).join('\n') + '\n' : '',
        stderr: '',
      };
    if (args[0] === 'drush')
      return {
        status: 0,
        stdout: Object.entries(answers.sqlq ?? {}).find(([needle]) => args.at(-1)!.includes(needle))?.[1] ?? '',
        stderr: '',
      };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  return { run, calls };
}

// ---- Canvas ----
test('sqlq rows keep the first row and empty columns, and refuse a ragged row', () => {
  const sample =
    'page\t0\t1\t3\ten\t0\t\t\tuuid-1\tsdc.mytheme.site-header\tv1\t{}\t\npage\t0\t2\t3\ten\t1\tparent-uuid\tcontent\tuuid-2\tsdc.mytheme.photo-slide\tv1\t{}\tSlide\n';
  const rows = canvas.parseSqlqRows(sample, 13);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]![2], '1');
  assert.deepEqual(rows[0]!.slice(6, 8), ['', '']);
  assert.equal(rows[0]!.at(-1), '');
  assert.equal(rows[1]![9], 'sdc.mytheme.photo-slide');
  assert.deepEqual(canvas.parseSqlqRows('/page/1\t/home\n/page/2\t/resources\n', 2), [
    ['/page/1', '/home'],
    ['/page/2', '/resources'],
  ]);
  assert.throws(() => canvas.parseSqlqRows('bad\trow\n', 13), /expected 13 columns, got 2/);
});

test('twig references and the Canvas merge preserve the structural count', () => {
  const root = temp(),
    theme = join(root, 'web/themes/custom/demo');
  mkdirSync(join(theme, 'templates/layout'), { recursive: true });
  mkdirSync(join(theme, 'components/parent'), { recursive: true });
  writeFileSync(join(theme, 'templates/layout/page.html.twig'), "{% include 'demo:site-header' %}\n");
  writeFileSync(
    join(theme, 'components/parent/parent.twig'),
    "{% embed 'demo:photo-slide' %}{% endembed %}\n{% source 'demo:photo-slide' %}\n",
  );
  const components = {
    components: [
      { id: 'sdc.demo.site-header', sourceSdcId: 'demo:site-header' },
      { id: 'sdc.demo.photo-slide', sourceSdcId: 'demo:photo-slide' },
    ],
  };
  const refs = canvas.scanThemeTemplates(root, components);
  assert.equal(refs['demo:site-header']![0]!.line, 1);
  assert.equal(refs['demo:site-header']![0]!.global, true);
  assert.equal(refs['demo:photo-slide']!.length, 2);
  const rows = {
    placements: [
      ['page', '0', '2', '3', 'en', '0', 'parent', 'content', 'uuid', 'sdc.demo.photo-slide', 'v1', '{}', ''],
    ],
    pages: [['2', '3']],
    aliases: [['/page/2', '/resources']],
    templates: [],
    twig_refs: refs,
  };
  const merged = canvas.mergeCanvasUsage(components, canvas.buildUsage(components, rows, { approot: root }));
  const [header, photo] = merged['components'];
  assert.equal(header?.category, usage.TIERS.high);
  assert.equal(photo?.usage?.structuralReferences, 1);
  assert.equal(photo?.category, usage.TIERS.structural);
  assert.deepEqual(photo?.usage.exampleCandidates, ['/resources']);
});

test('twig scanning orders files by path segment, not by joined string', () => {
  assert.ok(canvas.comparePaths('a/x.twig', 'a-b/x.twig') < 0); // baseline: ['a','x.twig'] < ['a-b','x.twig']
  assert.ok('a-b/x.twig' < 'a/x.twig'); // the joined-string order it must not use
});

test('content-template nodes skip disabled templates', () => {
  const site = temp();
  cpSync(join(fixtures, 'canvas-site'), site, { recursive: true });
  const rows = canvas.templateRows(site);
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((row) => row[2])), new Set(['program', 'season']));
  assert.ok(rows.every((row) => row[3]!.startsWith('config/') && row[3]!.includes('canvas.content_template.')));
});

test('published current-page rows, templates and non-SDC entries count correctly', () => {
  for (const needle of ['p.revision_id=c.revision_id', 'p.status=1', 'c.deleted=0'])
    assert.ok(canvas.PLACEMENTS_SQL.includes(needle));
  const counts: Record<string, number> = {
    'formatted-section': 82,
    'content-column': 30,
    'program-link': 7,
    'photo-slide': 7,
  };
  const components = {
    components: Object.keys(counts).map((name) => ({
      id: 'sdc.mytheme.' + name,
      fields: [],
      slots: [],
      defects: [],
      label: name,
      sourceRef: name,
    })),
  };
  const placements: string[][] = [];
  for (const [name, count] of Object.entries(counts))
    for (let index = 0; index < count; index++) {
      // The joined query has already excluded unpublished and old revisions.
      const parent = name === 'content-column' && index < 20 ? 'parent-uuid' : '';
      placements.push([
        'page',
        '0',
        String((index % 16) + 1),
        '3',
        'en',
        String(index),
        parent,
        parent ? 'content' : '',
        'uuid',
        'sdc.mytheme.' + name,
        'version',
        '{}',
        '',
      ]);
    }
  for (const id of ['block.mytheme_contact_form', 'js.bullseye'])
    placements.push(['page', '0', '1', '3', 'en', '0', '', '', 'uuid', id, '', '{}', '']);
  const rows = {
    placements,
    pages: Array.from({ length: 16 }, (_, i) => [String(i + 1), '3']),
    aliases: [['/page/1', '/welcome']],
    templates: [
      [
        'sdc.mytheme.program-link',
        'node.program.full',
        'program',
        'config/sync/canvas.content_template.node.program.full.yml',
      ],
    ],
  };
  const result = canvas.buildUsage(components, rows, { approot: '/fixture' });
  assert.deepEqual(validate('usage', result), []);
  assert.equal(result?.['source']?.population?.publishedPages, 16);
  assert.equal(result?.['usage']?.['sdc.mytheme.formatted-section']?.placements, 82);
  const column = result['usage']['sdc.mytheme.content-column'];
  assert.deepEqual([column?.placements, column?.structuralRefs, column?.pages], [10, 20, 16]);
  assert.ok(column?.exampleCandidates?.includes('/welcome'));
  const link = result['usage']['sdc.mytheme.program-link'];
  assert.deepEqual([link?.placements, link?.templatePlacements, link?.templateBundles], [8, 1, ['program']]);
  assert.equal(result?.['usage']?.['js.bullseye']?.placements, 1);
  assert.deepEqual(result?.['problems']?.[0]?.evidence, ['block.mytheme_contact_form', 'js.bullseye']);
  const section = usage.mergeUsage(components, result)['components'].find((c) => c.id.endsWith('formatted-section'));
  assert.equal(section?.category, usage.TIERS.high);
  assert.throws(() => canvas.buildUsage(components, { placements: [['short']] }, {}), /fewer than 13 columns/);
});

test('Canvas collection runs the same ddev drush arguments and reports a stopped project', () => {
  const ddev = fakeDdev({
    sqlq: {
      'canvas_page_field_data WHERE status=1': '2\t3\n',
      path_alias: '/page/2\t/resources\n',
    },
  });
  const rows = canvas.collectRows(tmpdir(), 'site', ddev.run);
  assert.deepEqual(rows.pages, [['2', '3']]);
  assert.deepEqual(rows.aliases, [['/page/2', '/resources']]);
  assert.deepEqual(
    ddev.calls.map((call) => call.args.slice(0, 3)),
    [
      ['describe', '-j'],
      ['drush', 'sqlq', canvas.PLACEMENTS_SQL.trim()],
      ['drush', 'sqlq', canvas.PAGES_SQL],
      ['drush', 'sqlq', canvas.ALIASES_SQL.trim()],
    ],
  );
  assert.ok(ddev.calls.every((call) => call.command === 'ddev'));
  assert.throws(() => canvas.collectRows(tmpdir(), null, fakeDdev({ running: false }).run), /is not running/);
  assert.throws(() => canvas.collectRows(tmpdir(), 'other', fakeDdev().run), /expected 'other'/);
  assert.throws(
    () => canvas.collectRows(tmpdir(), null, fakeDdev({ failOn: /sqlq/ }).run),
    /DDEV database query failed: boom/,
  );
});

// ---- Site Studio ----
const component = (name: string, children: ExternalObject[] = []): ExternalObject => ({
  type: 'component',
  componentId: name,
  children,
});
const layout = (number: number, host: string, parent: number, canvasTree: ExternalObject[]): string[] => [
  String(number),
  host,
  String(parent),
  JSON.stringify({
    canvas: canvasTree,
    model: { ignored: component('model_only') },
  }),
];
/** PHP serialize(), as Drupal stores config. */
function php(value: unknown): string {
  if (value === null) return 'N;';
  if (typeof value === 'boolean') return `b:${Number(value)};`;
  if (typeof value === 'number') return `i:${value};`;
  if (typeof value === 'string') return `s:${Buffer.byteLength(value)}:"${value}";`;
  const entries = Object.entries(value as ExternalObject);
  return `a:${entries.length}:{${entries.map(([k, v]) => (/^\d+$/.test(k) ? php(Number(k)) : php(k)) + php(v)).join('')}}`;
}
const template = (
  kind: string,
  name: string,
  canvasTree: ExternalObject[],
  settings: ExternalObject = {},
): string[] => [
  `cohesion_templates.cohesion_${kind}_templates.${name}`,
  php({
    status: true,
    id: name,
    json_values: JSON.stringify({ canvas: canvasTree }),
    ...settings,
  }),
];
const inventory = (): import('../../src/usage-types.ts').UsageInventory => ({
  source: { strategy: 'sitestudio' },
  components: ['hero_highlight', 'text_banner', 'cpt_callouts', 'promo', 'unused'].map((name) => ({
    id: name,
    sourceRef: `cohesion_elements.cohesion_component.${name}.yml`,
  })),
});
const build = (rows: usage.Rows, inv = inventory()) => usage.buildUsage(inv, rows, {});

test('Site Studio counts direct, nested and reusable placements and published pages separately', () => {
  const reference = {
    type: 'component-content',
    componentContentId: 'cc_uuid-7',
  };
  const rows = {
    nodes: [
      ['14631', '1', 'page'],
      ['2', '0', 'page'],
      ['3', '1', 'page'],
    ],
    path_aliases: [['/node/14631', '/home']],
    component_contents: [['7', 'uuid-7']],
    sitestudio_layouts: [
      layout(1, 'node', 14631, [
        component('hero_highlight', [{ type: 'container', children: [component('cpt_callouts')] }]),
        { type: 'container', children: [component('text_banner')] },
        reference,
      ]),
      layout(2, 'node', 2, [component('text_banner')]),
      layout(3, 'component_content', 7, [component('promo'), reference]),
      layout(4, 'node', 3, [reference, reference]),
    ],
  };
  const document = build(rows),
    values = document['usage'];
  assert.equal(values?.['hero_highlight']?.placements, 1);
  assert.equal(values?.['cpt_callouts']?.placements, 0);
  assert.equal(values?.['cpt_callouts']?.structuralRefs, 1);
  assert.deepEqual(values?.['cpt_callouts']?.exampleCandidates, ['/home']);
  assert.equal(values?.['text_banner']?.placements, 2);
  assert.equal(values?.['text_banner']?.pages, 1);
  assert.equal(values?.['promo']?.structuralRefs, 1);
  assert.equal(values?.['promo']?.pages, 2);
  assert.deepEqual(values?.['promo']?.exampleCandidates, ['/home', '/node/3']);
  assert.ok(!JSON.stringify(document['problems']).includes('model_only'));
  const merged = usage.mergeUsage(inventory(), document);
  assert.equal(merged?.['components']?.[2]?.category, usage.TIERS.structural);
  assert.equal(merged?.['components']?.[4]?.category, usage.TIERS.retirement);
});

test('unpublished-only placements invent no example pages', () => {
  const value = build({
    nodes: [['2', '0', 'page']],
    sitestudio_layouts: [layout(1, 'node', 2, [component('hero_highlight')])],
  })['usage']['hero_highlight'];
  assert.deepEqual([value?.placements, value?.pages, value?.exampleCandidates], [1, 0, []]);
});

test('invalid layout JSON names the layout', () => {
  assert.throws(() => build({ sitestudio_layouts: [['99', 'node', '1', 'broken']] }), /Site Studio layout 99/);
  assert.throws(
    () => build({ sitestudio_layouts: [['98', 'node', '1', '{"canvas": 3}']] }),
    /Site Studio layout 98: invalid json_values: canvas must be an array/,
  );
});

test('authoring bundles keep their usage alongside Site Studio components', () => {
  const inv = inventory();
  inv['components'].push({ id: 'paragraph:card' });
  const document = usage.buildUsage(
    inv,
    {
      paragraphs: [['1', 'card', 'node', '1', '1']],
      sitestudio_layouts: [layout(2, 'node', 1, [component('hero_highlight')])],
    },
    {},
  );
  assert.equal(document?.['usage']?.['paragraph:card']?.placements, 1);
  assert.equal(document?.['usage']?.['hero_highlight']?.placements, 1);
});

test('a Site Studio extraction keeps database candidates and applies no paragraph markers', async () => {
  const rows: usage.Rows = {
    nodes: [['14631', '1', 'page']],
    sitestudio_layouts: [layout(1, 'node', 14631, [component('hero_highlight')])],
  };
  let enriched = false;
  const document = await usage.extract(tmpdir(), inventory(), null, null, {
    collectRows: () => rows,
    enrichExamples: async (d) => {
      enriched = true;
      return d;
    },
  });
  assert.equal(enriched, false);
  assert.deepEqual(document?.['usage']?.['hero_highlight']?.exampleCandidates, ['/node/14631']);
  assert.deepEqual(document?.['usage']?.['hero_highlight']?.examples, []);
  assert.match(document?.['usage']?.['hero_highlight']?.noExampleReason ?? '', /not supported/);
  const master = await usage.extract(tmpdir(), inventory(), null, null, {
    collectRows: () => ({
      nodes: [['1', '1', 'page']],
      sitestudio_templates: [
        template('master', 'master_template', [component('promo')], {
          default: true,
        }),
      ],
    }),
  });
  assert.deepEqual(master?.['usage']?.['promo']?.exampleCandidates, ['/']);
  assert.deepEqual(master?.['usage']?.['promo']?.examples, []);
});

test('PHP unserialize reads byte lengths and nesting and rejects what it does not know', () => {
  const text = 'Café "quoted"; {braces}',
    value = { a: { 0: 1, 1: null }, b: true, s: text };
  assert.deepEqual(JSON.parse(JSON.stringify(usage.phpUnserialize(Buffer.from(php(value))))), value);
  assert.equal(usage.phpUnserialize(Buffer.from('d:1.5;')), 1.5);
  assert.throws(() => usage.phpUnserialize(Buffer.from('O:8:"stdClass":0:{}')), /unsupported/);
  for (const broken of ['a:1:{a:0:{}i:1;}', 's:50:"x";', 's:-1:"";', 'a:1:{i:0;i:1;'])
    assert.throws(() => usage.phpUnserialize(Buffer.from(broken)), Error, broken);
  assert.deepEqual(Object.keys(Object(usage.phpUnserialize(Buffer.from('a:1:{s:9:"__proto__";i:1;}')))), ['__proto__']);
});

test('master templates are structural and site-wide; a non-default master follows its content template', () => {
  const rows = {
    nodes: [
      ['10', '1', 'page'],
      ['11', '1', 'event'],
      ['12', '0', 'event'],
    ],
    path_aliases: [['/node/11', '/events/expo']],
    sitestudio_templates: [
      template(
        'master',
        'master_template',
        [component('site_header', [component('promo')]), { type: 'container' }, component('site_footer')],
        { default: true },
      ),
      template('master', 'boxed', [component('text_banner')], {
        default: false,
      }),
      template('master', 'retired', [component('cpt_callouts')], {
        default: false,
        status: false,
      }),
      template('content', 'node_event_full', [], {
        entity_type: 'node',
        bundle: 'event',
        view_mode: 'full',
        default: true,
        master_template: 'boxed',
      }),
      template('content', 'node_page_full', [], {
        entity_type: 'node',
        bundle: 'page',
        view_mode: 'full',
        default: true,
        master_template: 'master_template',
      }),
    ],
  };
  const inv = inventory();
  inv['components'].push({ id: 'site_header' }, { id: 'site_footer' });
  const document = usage.buildUsage(inv, rows, {}),
    values = document['usage'],
    header = values['site_header'];
  assert.deepEqual([header?.placements, header?.structuralRefs, header?.pages], [0, 1, 0]);
  assert.deepEqual(header?.exampleCandidates, ['/']); // even when a content template names the default master
  assert.deepEqual(header.templates, ['cohesion_templates.cohesion_master_templates.master_template']);
  assert.deepEqual(values?.['site_footer']?.exampleCandidates, ['/']);
  assert.deepEqual(values?.['promo']?.exampleCandidates, ['/']);
  assert.deepEqual(values?.['text_banner']?.exampleCandidates, ['/events/expo']);
  assert.equal(values?.['text_banner']?.pages, 1);
  assert.equal(values?.['cpt_callouts']?.structuralRefs, 0);
  assert.ok(!('templates' in values?.['cpt_callouts'])); // a disabled master renders nowhere
  assert.equal(document?.['source']?.population?.siteStudioTemplates, 5);
  const absent = document['problems'].filter((p) => p.check === 'inventoried-bundle-absent-from-database');
  assert.ok(!(absent[0]?.evidence ?? []).includes('site_header'));
  const tiers = Object.fromEntries(usage.mergeUsage(inv, document)['components'].map((c) => [c.id, c.category]));
  assert.equal(tiers['site_header'], usage.TIERS.structural);
  assert.equal(tiers['site_footer'], usage.TIERS.structural);
});

test('content, menu and view templates find examples and structural use', () => {
  const view = {
    display: {
      default: {
        display_plugin: 'default',
        display_options: {
          style: {
            type: 'cohesion_layout',
            options: { views_template: 'view_tpl_search' },
          },
        },
      },
      page_1: { display_plugin: 'page', display_options: { path: 'search' } },
      page_2: {
        display_plugin: 'page',
        display_options: { path: 'node/%/related' },
      },
      page_3: {
        display_plugin: 'page',
        display_options: { path: 'off', enabled: false },
      },
      block_1: { display_plugin: 'block', display_options: {} },
    },
  };
  const rows = {
    nodes: [
      ['20', '1', 'event'],
      ['21', '1', 'event'],
      ['22', '1', 'page'],
    ],
    sitestudio_templates: [
      template('content', 'node_event_full', [component('hero_highlight')], {
        entity_type: 'node',
        bundle: 'event',
        view_mode: 'full',
        default: true,
        master_template: '',
      }),
      template('content', 'node_event_teaser', [component('promo')], {
        entity_type: 'node',
        bundle: 'event',
        view_mode: 'teaser',
        default: true,
      }),
      template('menu', 'menu_tpl_main', [component('text_banner')]),
      template('view', 'view_tpl_search', [component('cpt_callouts')]),
      ['views.view.search', php(view)],
      [
        'views.view.retired',
        php({
          status: false,
          display: {
            page_1: {
              display_plugin: 'page',
              display_options: {
                path: 'retired',
                style: { options: { views_template: 'view_tpl_search' } },
              },
            },
          },
        }),
      ],
    ],
    sitestudio_layouts: [layout(1, 'node', 22, [component('hero_highlight')])],
  };
  const values = build(rows)['usage'];
  assert.deepEqual(values?.['hero_highlight']?.exampleCandidates, ['/node/22', '/node/21', '/node/20']); // the author's page stays first
  assert.equal(values?.['hero_highlight']?.pages, 3);
  assert.equal(values?.['promo']?.structuralRefs, 1);
  assert.deepEqual(values?.['promo']?.exampleCandidates, []); // a teaser names no page of its own
  assert.deepEqual(values?.['text_banner']?.exampleCandidates, ['/']);
  assert.deepEqual(values?.['cpt_callouts']?.exampleCandidates, ['/search']);
  assert.equal(values?.['cpt_callouts']?.structuralRefs, 1);
});

test('an unreadable or damaged template row is reported, never fatal', () => {
  let document = build({
    sitestudio_templates: [
      ['cohesion_templates.cohesion_master_templates.broken', 'a:9:{s:2:"id"'],
      template('master', 'master_template', [component('promo')], {
        default: true,
      }),
    ],
  });
  assert.deepEqual(document?.['usage']?.['promo']?.exampleCandidates, ['/']);
  assert.ok(document['problems'].some((p) => p.check === 'sitestudio-template-unreadable'));
  document = build({
    sitestudio_templates: [
      ['cohesion_templates.cohesion_master_templates.bad', 'a:1:{a:0:{}i:1;}'],
      ['cohesion_templates.cohesion_master_templates.deep', 'a:1:{i:0;'.repeat(3000) + 'N;' + '}'.repeat(3000)],
      template('master', 'master_template', [component('promo')], {
        default: true,
      }),
    ],
  });
  assert.deepEqual(document?.['usage']?.['promo']?.exampleCandidates, ['/']);
  assert.equal(document['problems'].filter((p) => p.check === 'sitestudio-template-unreadable').length, 2);
});

test('a global full template renders only bundles without their own; an unmodified default renders nothing', () => {
  const rows = {
    nodes: [
      ['30', '1', 'event'],
      ['31', '1', 'page'],
    ],
    sitestudio_templates: [
      template('content', 'node_event_full', [component('hero_highlight')], {
        entity_type: 'node',
        bundle: 'event',
        view_mode: 'full',
        default: true,
        master_template: '',
      }),
      template('content', 'node_any_full', [component('promo')], {
        entity_type: 'node',
        bundle: '__any__',
        view_mode: 'full',
        default: true,
        master_template: 'master_landing',
      }),
      template('master', 'master_landing', [component('text_banner')]),
    ],
  };
  const values = build(rows)['usage'];
  assert.deepEqual(values?.['promo']?.exampleCandidates, ['/node/31']);
  assert.deepEqual(values?.['text_banner']?.exampleCandidates, ['/node/31']);
  assert.deepEqual(values?.['hero_highlight']?.exampleCandidates, ['/node/30']);
  const unmodified = build({
    nodes: [['40', '1', 'event']],
    sitestudio_templates: [
      template('content', 'node_event_full', [component('promo')], {
        entity_type: 'node',
        bundle: 'event',
        view_mode: 'full',
        default: true,
        modified: false,
        master_template: '',
      }),
    ],
  });
  assert.deepEqual(unmodified?.['usage']?.['promo']?.exampleCandidates, []);
});

// ---- database collection ----
test('optional tables that do not exist are never queried', () => {
  const ddev = fakeDdev({
    tables: ['paragraphs_item_field_data', 'node_field_data'],
  });
  const rows = usage.collectRows(tmpdir(), null, ddev.run);
  assert.deepEqual(rows['layout_sections'], []);
  const queries = ddev.calls.filter((call) => call.args[0] === 'mysql').map((call) => call.args.join(' '));
  assert.ok(!queries.some((sql) => sql.includes('node__layout_builder__layout')));
  assert.ok(queries.some((sql) => sql.includes('FROM paragraphs_item_field_data')));
  assert.ok(!queries.some((sql) => sql.includes('FROM block_content ')));
  assert.deepEqual(
    ddev.calls
      .filter((call) => call.args[0] === 'mysql')
      .map((call) => call.args.slice(0, 3))
      .slice(0, 2),
    [
      ['mysql', '-N', '--raw'],
      ['mysql', '-N', '--raw'],
    ],
  );
  assert.equal(ddev.calls.find((call) => call.args[0] === 'mysql')!.args[3], '-e');
  assert.deepEqual(rows['__ddev'], [['site', 'https://site.ddev.site']]);
});

test('mysql rows end only at a newline and keep other separators inside values', () => {
  const run: usage.Runner = () => ({
    status: 0,
    stdout: 'a\tb c\nd\t\n\n',
    stderr: '',
  });
  assert.deepEqual(usage.mysql(tmpdir(), 'SELECT 1;', run), [
    ['a', 'b c'],
    ['d', ''],
  ]);
  assert.throws(
    () =>
      usage.mysql(tmpdir(), 'SELECT 1;', () => ({
        status: 1,
        stdout: '',
        stderr: ' bad ',
      })),
    /DDEV database query failed: bad/,
  );
});

// ---- Twig debug markers and the order usage tries them in ----
const render = (hook: string, suggestions: string[], body: string): string =>
  `<!-- THEME DEBUG -->\n<!-- THEME HOOK: '${hook}' -->\n<!-- FILE NAME SUGGESTIONS:\n${suggestions.map((name) => `   * ${name}`).join('\n')}\n-->\n<!-- 💡 BEGIN CUSTOM TEMPLATE OUTPUT from 'themes/x/${suggestions[0]}' -->\n${body}\n<!-- END CUSTOM TEMPLATE OUTPUT from 'themes/x/${suggestions[0]}' -->\n`;
const PAGE =
  '<html><body>' +
  render(
    'paragraph',
    ['paragraph--cards--default.html.twig', 'paragraph--cards.html.twig', 'paragraph.html.twig'],
    '<div data-component-id="kinetic:cards">a</div>',
  ) +
  render(
    'paragraph',
    ['paragraph--cards.html.twig', 'paragraph.html.twig'],
    '<div data-component-id="kinetic:cards">b</div>',
  ) +
  render(
    'block',
    ['block--cards.html.twig', 'block.html.twig'],
    '<div class="block--cards"><div data-component-id="kinetic:cards">c</div></div>',
  ) +
  render('paragraph', ['paragraph--link-default.html.twig', 'paragraph.html.twig'], "<a href='/x'>x</a>") +
  '</body></html>';
const enrich = (page: string, ids: string[], rendering: { items?: Record<string, { rootSdc?: string }> } | null) =>
  usage.enrichExamples(
    {
      source: {},
      usage: Object.fromEntries(
        ids.map((id) => [
          id,
          { exampleCandidates: ['/node/1'] } as Partial<import('../../src/usage-types.ts').UsageEntry>,
        ]),
      ),
    },
    'https://site.ddev.site',
    rendering,
    async () => [200, page],
  );

test('Twig debug suggestions use Drupal hyphens, count the bundle hook only, and nest', () => {
  assert.deepEqual(twig.suggestion('paragraph:link_default'), ['paragraph', 'paragraph--link-default.html.twig']);
  assert.equal(twig.rootSelector('block:cards'), '[data-design-lab-root="block:cards"]');
  assert.ok(twig.enabled(PAGE));
  assert.ok(!twig.enabled('<html></html>'));
  assert.deepEqual(
    ['paragraph:cards', 'block:cards', 'paragraph:link_default', 'paragraph:text'].map((id) => twig.count(PAGE, id)),
    [2, 1, 1, 0],
  );
  const link = render('paragraph', ['paragraph--link-default.html.twig'], '<a>x</a>');
  const page =
    '<html>' +
    render('block', ['block--banner.html.twig'], '<div>' + link + link + '</div>') +
    link +
    render('block', ['block--text.html.twig'], '<p>t</p>') +
    '</html>';
  assert.deepEqual(twig.rendersWithin(page, 'block:banner', ['paragraph:link_default']), {
    parentRenders: 1,
    children: { 'paragraph:link_default': 2 },
  });
  assert.deepEqual(twig.rendersWithin(page, 'block:text', ['paragraph:link_default']), {
    parentRenders: 1,
    children: { 'paragraph:link_default': 0 },
  });
});

test('with Twig debug the template marker beats a shared component id', async () => {
  const result = await enrich(PAGE, ['paragraph:cards', 'block:cards'], {
    items: { 'paragraph:cards': { rootSdc: 'kinetic:cards' } },
  });
  const cards = result?.['usage']?.['paragraph:cards']?.examples?.[0];
  assert.deepEqual([cards?.markerKind, cards?.instancesOnPage], ['template', 2]);
  assert.equal(result?.['usage']?.['block:cards']?.examples?.[0]?.markerKind, 'class');
  assert.equal(result?.['source']?.exampleVerification?.twigDebug, true);
  assert.ok(!('exampleCandidates' in (result?.['usage']?.['paragraph:cards'] ?? {})));
});

test('without Twig debug the component id is used', async () => {
  const result = await enrich('<div data-component-id="kinetic:cards">a</div>', ['paragraph:cards'], {
    items: { 'paragraph:cards': { rootSdc: 'kinetic:cards' } },
  });
  const example = result?.['usage']?.['paragraph:cards']?.examples?.[0];
  assert.deepEqual(
    [example?.markerKind, example?.marker, example?.markerUniqueToThisComponent],
    ['component', 'kinetic:cards', true],
  );
  assert.equal(result?.['source']?.exampleVerification?.twigDebug, false);
});

test('a template file name in a debug comment is not a class', async () => {
  const html =
    "<!-- THEME DEBUG -->\n<!-- THEME HOOK: 'block' -->\n<!-- BEGIN OUTPUT from 'themes/x/templates/block/block--icon-block.html.twig' -->\n" +
    '<div class="block--block-content--type--icon-block">Icons</div>\n<!-- END OUTPUT from \'themes/x/templates/block/block--icon-block.html.twig\' -->';
  const result = await enrich(html, ['block:icon_block'], null);
  assert.ok(!result?.['usage']?.['block:icon_block']?.examples?.some((e) => e.markerKind === 'class'));
  const real = await enrich(
    '<div class="block--icon-block">x</div><!-- block--icon-block -->',
    ['block:icon_block'],
    null,
  );
  assert.equal(real?.['usage']?.['block:icon_block']?.examples?.[0]?.markerKind, 'class');
  assert.equal(real?.['usage']?.['block:icon_block']?.examples?.[0]?.instancesOnPage, 1);
});

test('a page that cannot be fetched yields no example and says why', async () => {
  const result = await usage.enrichExamples(
    {
      source: {},
      usage: { 'paragraph:x': { exampleCandidates: ['/node/1', '/node/2'] } },
    } as import('../../src/usage-types.ts').ExampleDocument,
    'https://site.test/',
    null,
    async (url) => (url.endsWith('/1') ? [500, ''] : [0, '']),
  );
  const value = result['usage']['paragraph:x'];
  assert.deepEqual(value?.examples, []);
  assert.match(value?.noExampleReason ?? '', /no component-specific rendered marker/);
  assert.equal(result?.['source']?.exampleVerification?.pagesFetched, 2);
});

test('usage tiers use absolute thresholds', () => {
  assert.deepEqual(
    [
      [50, 0],
      [10, 0],
      [1, 0],
      [0, 4],
      [0, 0],
    ].map(([p, s]) => usage.usageTier(p!, s!)),
    [usage.TIERS.high, usage.TIERS.medium, usage.TIERS.low, usage.TIERS.structural, usage.TIERS.retirement],
  );
  assert.throws(
    () => usage.mergeUsage({ components: [{ id: 'a' }] }, { generatedAt: 'x', usage: {} }),
    /usage has no row for a/,
  );
});
