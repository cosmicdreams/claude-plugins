/**
 * The component extractors write components.json through the closed schema. Each test builds a repository that
 * takes the branches which add, omit or null a field, runs the real extract-and-write command, and then reads the
 * file back. A value the schema rejects makes the command fail and write nothing, so these tests fail loudly.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validate, writeArtifact } from '../../src/contracts.ts';
import { extractProject } from '../../src/discovery-workflow.ts';
import type { Components } from '../../src/generated/components.ts';

const folders: string[] = [];
after(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});
const temp = () => {
  const folder = mkdtempSync('/tmp/design-lab-writer-components-');
  folders.push(folder);
  return folder;
};
const put = (root: string, path: string, text: string) => {
  const full = join(root, path);
  mkdirSync(resolve(full, '..'), { recursive: true });
  writeFileSync(full, text);
};
function drupal(root: string) {
  put(root, 'docroot/sites/default/settings.php', '<?php\n');
  put(root, 'config/default/system.site.yml', 'name: Example\n');
  return root;
}
/** A run folder whose project.json names the strategy, as `select` would have recorded it. */
function run(root: string, componentSource: string, extra: Record<string, unknown> = {}) {
  const folder = temp();
  writeArtifact('project', join(folder, 'project.json'), {
    schemaVersion: 1,
    standardVersion: '3.0.0',
    pluginVersion: 'test',
    repository: { root, commit: null, dirty: false },
    decisions: { componentSource, usageSource: 'none', ...extra },
    phases: {
      inventory: { status: 'pending' },
      usage: { status: 'pending' },
      capture: { status: 'pending' },
      plan: { status: 'pending' },
      components: { status: 'pending' },
      index: { status: 'pending' },
      verify: { status: 'pending' },
    },
    artifacts: {},
  });
  return folder;
}
async function written(folder: string): Promise<Components> {
  await extractProject(folder, 'components');
  const document: unknown = JSON.parse(readFileSync(join(folder, 'components.json'), 'utf8'));
  assert.deepEqual(validate('components', document), []);
  return document as Components;
}

void test('SDC: components with no name, no title, array types, mixed enums, float defaults and an unreadable file all write', async () => {
  const root = drupal(temp());
  put(
    root,
    'docroot/themes/custom/t/components/card/card.component.yml',
    "name: Card\nprops:\n  type: object\n  properties:\n    title:\n      type: string\n    on:\n      type: boolean\n      default: true\n    n:\n      type: [number, 'null']\n      default: 1.5\n    list:\n      type: array\n      default: [1, 2]\n    kind:\n      type: string\n      enum: [a, true, null, 3]\n    structured:\n      type: [object, array]\n      enum: [{nested: [1, true]}, [a, b]]\nslots:\n  body:\n    title: Body\n  foot: {}\n",
  );
  put(root, 'docroot/themes/custom/t/components/bare/bare.component.yml', 'props:\n  type: object\n');
  put(root, 'docroot/themes/custom/t/components/bad/bad.component.yml', '- just\n- a list\n');
  const document = await written(run(root, 'sdc'));
  assert.equal(document.source.parser, 'pyyaml');
  assert.equal(document.components.find((c) => c.id === 'bare')?.label, null);
  assert.equal(document.problems?.[0]?.kind, 'unparseable');
});

void test('paragraphs: entry points, containment, dangling storage, unmapped types, enums without options and unreadable bundles all write', async () => {
  const root = drupal(temp());
  const cfg = (name: string, text: string) => put(root, `config/default/${name}`, text);
  cfg('paragraphs.paragraphs_type.layout.yml', 'id: layout\nlabel: Layout\nstatus: false\n');
  cfg('paragraphs.paragraphs_type.text.yml', 'id: text\nlabel: Text\ndescription: Words\n');
  cfg('paragraphs.paragraphs_type.broken.yml', 'id: [unclosed\n');
  cfg(
    'field.storage.paragraph.field_items.yml',
    'field_name: field_items\ncardinality: -1\nsettings:\n  target_type: paragraph\n',
  );
  cfg(
    'field.field.paragraph.layout.field_items.yml',
    'field_name: field_items\nfield_type: entity_reference_revisions\nlabel: Items\nsettings:\n  handler_settings:\n    target_bundles:\n      text: text\n      ghost: ghost\n',
  );
  cfg(
    'field.field.paragraph.layout.field_loose.yml',
    'field_name: field_loose\nfield_type: entity_reference_revisions\nlabel: Loose\n',
  );
  cfg('field.storage.paragraph.field_style.yml', 'field_name: field_style\ncardinality: 1\nsettings: {}\n');
  cfg('field.field.paragraph.text.field_style.yml', 'field_name: field_style\nfield_type: list_string\nlabel: Style\n');
  cfg(
    'field.field.paragraph.text.field_strange.yml',
    'field_name: field_strange\nfield_type: made_up\nlabel: Strange\n',
  );
  cfg(
    'field.storage.paragraph.field_media.yml',
    'field_name: field_media\ncardinality: 1\nsettings:\n  target_type: media\n',
  );
  cfg(
    'field.field.paragraph.text.field_media.yml',
    'field_name: field_media\nfield_type: entity_reference\nlabel: Media\nrequired: true\ndescription: A picture\n',
  );
  cfg(
    'field.storage.paragraph.field_body.yml',
    'field_name: field_body\ncardinality: -1\nsettings:\n  target_type: paragraph\n',
  );
  cfg(
    'field.field.node.page.field_body.yml',
    'field_name: field_body\nfield_type: entity_reference_revisions\nlabel: Body\nsettings:\n  handler_settings:\n    target_bundles:\n      layout: layout\n',
  );
  const document = await written(run(root, 'paragraphs'));
  assert.ok(document.entryPoints?.length);
  assert.equal(document.components.find((c) => c.id === 'layout')?.isEntryPoint, true);
});

void test('Drupal authoring: static and plugin enums, dangling references, media targets and a bundle with no label all write', async () => {
  const root = drupal(temp());
  const cfg = (name: string, text: string) => put(root, `config/default/${name}`, text);
  cfg('block_content.type.basic.yml', 'id: basic\nlabel: Basic\nstatus: false\n');
  cfg('paragraphs.paragraphs_type.text.yml', 'id: text\n');
  cfg('paragraphs.paragraphs_type.layout.yml', 'id: layout\nlabel: Layout\ndescription: Columns\n');
  cfg(
    'field.storage.paragraph.field_items.yml',
    'field_name: field_items\ncardinality: -1\nsettings:\n  target_type: paragraph\n',
  );
  cfg(
    'field.field.paragraph.layout.field_items.yml',
    'field_name: field_items\nfield_type: entity_reference_revisions\nlabel: Items\nrequired: true\nsettings:\n  handler_settings:\n    target_bundles:\n      text: text\n      ghost: ghost\n',
  );
  cfg('field.field.paragraph.layout.field_any.yml', 'field_name: field_any\nfield_type: entity_reference_revisions\n');
  cfg('field.storage.paragraph.field_any.yml', 'field_name: field_any\nsettings:\n  target_type: paragraph\n');
  cfg(
    'field.storage.paragraph.field_style.yml',
    'field_name: field_style\ncardinality: 1\nsettings:\n  allowed_values:\n    - value: a\n      label: A\n    - value: b\n',
  );
  cfg(
    'field.field.paragraph.text.field_style.yml',
    'field_name: field_style\nfield_type: list_string\nlabel: Style\ndefault_value:\n  - value: a\n',
  );
  cfg(
    'field.storage.paragraph.field_plugin.yml',
    'field_name: field_plugin\nthird_party_settings:\n  list_predefined_options:\n    plugin_id: missing_plugin\n',
  );
  cfg('field.field.paragraph.text.field_plugin.yml', 'field_name: field_plugin\nfield_type: list_string\n');
  cfg(
    'field.field.paragraph.text.field_lonely.yml',
    'field_name: field_lonely\nfield_type: weird_type\ndescription: Lonely\n',
  );
  cfg('field.storage.paragraph.field_media.yml', 'field_name: field_media\nsettings:\n  target_type: media\n');
  cfg(
    'field.field.paragraph.text.field_media.yml',
    'field_name: field_media\nfield_type: entity_reference\nlabel: Media\nsettings:\n  handler_settings:\n    target_bundles: [image, video]\n',
  );
  const document = await written(run(root, 'drupal-authoring'));
  assert.equal(document.components.find((c) => c.id === 'block:basic')?.status, false);
});

void test('Canvas: a component config whose SDC is missing, a folder, a field only the config defines and an array default all write', async () => {
  const root = drupal(temp());
  put(
    root,
    'docroot/themes/custom/t/components/card/card.component.yml',
    'name: Card\nprops:\n  type: object\n  properties:\n    title:\n      type: string\n',
  );
  put(
    root,
    'config/default/canvas.component.sdc.t.card.yml',
    "id: sdc.t.card\nlabel: Card (Canvas)\nsource_local_id: 't:card'\nactive_version: abc\nversioned_properties:\n  active:\n    settings:\n      prop_field_definitions:\n        title:\n          field_type: string\n          field_widget: string_textfield\n          required: true\n          default_value:\n            - value: Hello\n        extra:\n          field_type: list_string\n          default_value: [a, b]\n        entity:\n          field_type: entity_reference\n          default_value: {}\n",
  );
  put(root, 'config/default/canvas.component.sdc.t.gone.yml', "id: sdc.t.gone\nsource_local_id: 't:gone'\n");
  put(
    root,
    'config/default/canvas.folder.one.yml',
    'configEntityTypeId: component\nname: Cards\nitems:\n  - sdc.t.card\n',
  );
  const document = await written(run(root, 'canvas'));
  assert.equal(document.source.strategy, 'canvas');
  assert.equal(
    document.problems?.some((p) => p.kind === 'missing-source-sdc' && p.sourceRef !== undefined),
    true,
  );
});

void test('Site Studio: untitled fields, repeaters without limits, shared show conditions, removed references and drop zones all write', async () => {
  const root = drupal(temp());
  put(root, 'docroot/sites/default/settings.php', "<?php\n$settings['site_studio_sync'] = '../config/packages';\n");
  const values = JSON.stringify({
    canvas: [{ uid: 'component-drop-zone' }],
    model: {
      '11111111-1111-1111-1111-111111111111': {
        settings: { machineName: 'heading', type: 'cohTextBox' },
        model: { value: 'Hi' },
      },
      '22222222-2222-2222-2222-222222222222': {
        settings: { machineName: 'items', title: 'Items', type: 'cohArray' },
        model: { value: '' },
      },
      '33333333-3333-3333-3333-333333333333': {
        settings: { machineName: 'inner', title: 'Inner', type: 'cohTextBox' },
        model: { value: { text: 'x' } },
      },
      '44444444-4444-4444-4444-444444444444': {
        settings: { machineName: 'h1', type: 'cohHidden', showCondition: 'a == b' },
        model: { value: {} },
      },
      '55555555-5555-5555-5555-555555555555': {
        settings: { machineName: 'h2', type: 'cohHidden', showCondition: 'a == b' },
        model: { value: { hex: '#fff' } },
      },
      '66666666-6666-6666-6666-666666666666': {
        settings: {
          machineName: 'style',
          title: 'Style',
          type: 'cohSelect',
          options: [{ value: 'coh-style-padding-1', label: 'Pad' }, { label: 'No value' }],
        },
        model: { value: 3 },
      },
    },
    componentForm: [
      {
        uuid: '22222222-2222-2222-2222-222222222222',
        children: [{ uuid: '33333333-3333-3333-3333-333333333333', children: [] }],
      },
    ],
    meta: { fieldHistory: '[field.99999999-9999-9999-9999-999999999999]' },
  });
  put(
    root,
    'config/packages/cohesion_elements.cohesion_component.hero.yml',
    `id: hero\nlabel: Hero\ncategory: cat\njson_values: '${values.replace(/'/g, "''")}'\nstatus: true\n`,
  );
  put(
    root,
    'config/packages/cohesion_elements.cohesion_component.nolabel.yml',
    "id: nolabel\njson_values: '{}'\nstatus: true\n",
  );
  put(
    root,
    'config/packages/cohesion_elements.cohesion_component.bad.yml',
    "id: bad\njson_values: 'not json'\nother: x\n",
  );
  const document = await written(run(root, 'sitestudio', { sitestudioConfig: join(root, 'config/packages') }));
  assert.equal(document.components.find((c) => c.id === 'nolabel')?.label, null);
  const hero = document.components.find((c) => c.id === 'hero');
  assert.equal(hero?.fields.find((f) => f.name === 'heading')?.label, null);
});
