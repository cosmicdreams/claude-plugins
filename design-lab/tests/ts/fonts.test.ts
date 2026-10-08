import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  availableFamily,
  cssMatch,
  declared,
  faceStyle,
  isIcon,
  kitsFor,
  main,
  plan,
  rangesOf,
  summaryLines,
  unescape,
  weightOf,
  type FontOptions,
} from '../../src/fonts.ts';

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'design-lab-fonts-')),
    repo = join(root, 'repo'),
    run = join(root, 'run'),
    theme = join(repo, 'docroot/themes/custom/site');
  mkdirSync(join(theme, 'fonts/suisse'), { recursive: true });
  mkdirSync(join(theme, 'fonts/open'), { recursive: true });
  mkdirSync(join(theme, 'css'), { recursive: true });
  mkdirSync(join(run, 'capture/measurements'), { recursive: true });
  for (const name of ['SuisseIntl-Light', 'SuisseIntl-Regular', 'SuisseIntl-RegularItalic', 'SuisseIntl-Semibold'])
    writeFileSync(join(theme, `fonts/suisse/${name}.woff2`), 'font');
  writeFileSync(join(theme, 'fonts/open/Assistant.ttf'), 'font');
  writeFileSync(join(theme, 'fonts/open/OFL.txt'), 'SIL Open Font License, Version 1.1');
  writeFileSync(
    join(theme, 'css/fonts.css'),
    `
@font-face { font-family: "Suisse Int'l"; src: url(../fonts/suisse/SuisseIntl-Light.woff2) format("woff2"); font-weight: 300; }
@font-face { font-family: "Suisse Int'l"; src: url(../fonts/suisse/SuisseIntl-Regular.woff2); font-weight: 400; }
@font-face { font-family: "Suisse Int'l"; src: url(../fonts/suisse/SuisseIntl-RegularItalic.woff2); font-weight: 400; font-style: italic; }
@font-face { font-family: "Suisse Int'l"; src: url(../fonts/suisse/SuisseIntl-Semibold.woff2); font-weight: 500; }
@font-face { font-family: Assistant; src: url(../fonts/open/Assistant.ttf); font-weight: 200 800; }
`,
  );
  writeFileSync(
    join(theme, 'templates.twig'),
    '<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;700&amp;family=Work+Sans:wght@700" rel="stylesheet">',
  );
  writeFileSync(join(theme, 'site.info.yml'), "libraries:\n  - '//use.typekit.net/abc1234.css'\n");
  const node = (fontFamily: string, fontWeight = '400', fontStyle = 'normal', text = 'Words') => ({
    text,
    computed: { fontFamily, fontWeight, fontStyle },
  });
  const saveNodes = (...nodes: object[]) =>
    writeFileSync(
      join(run, 'capture/measurements/card.spec.json'),
      JSON.stringify({ measurements: { 'desktop:default': { nodes } } }),
    );
  saveNodes(
    node('"Suisse Int\'l", sans-serif', '500'),
    node('"Suisse Int\'l", sans-serif', '700'),
    node('"Suisse Int\'l", sans-serif', '400', 'italic'),
    node('Poppins, Arial, sans-serif'),
    node('Figtree, sans-serif', '700'),
    node('freight-text-pro, serif', '400', 'italic'),
    node('Assistant, sans-serif', '450'),
    node('icomoon', '400', 'normal', '\ue900'),
  );
  const kit = {
    'Freight Text Pro': { cssNames: ['freight-text-pro'], slug: 'freight-text', variations: ['n4', 'i4'] },
  };
  const makePlan = (figma: Record<string, string[]> | null, kitReadable = true, extra: Partial<FontOptions> = {}) =>
    plan({
      run,
      repo,
      figma,
      fetchAdobeKit: async (id) => (id === 'abc1234' ? (kitReadable ? kit : null) : {}),
      ...extra,
    });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, repo, run, theme, makePlan, saveNodes, kit };
}
const FIGMA = {
  Inter: ['Regular', 'Italic', 'Medium', 'SemiBold', 'Bold'],
  Arial: ['Regular', 'Bold'],
  Figtree: ['Regular', 'Bold'],
  'Source Serif 4': ['Regular', 'Italic'],
  Assistant: ['Regular', 'Bold'],
  Helvetica: ['Regular'],
};

test('planner selects served families, skips undeclared CSS names, and records stack build behavior', async (t) => {
  const f = fixture(t),
    doc = await f.makePlan(null),
    by = Object.fromEntries(doc.families.map((x) => [x.family, x]));
  assert.deepEqual(
    Object.fromEntries(
      ["Suisse Int'l", 'Arial', 'Figtree', 'Freight Text Pro', 'Assistant'].map((name) => [name, by[name]?.source]),
    ),
    {
      "Suisse Int'l": 'self-hosted',
      Arial: 'system',
      Figtree: 'google',
      'Freight Text Pro': 'adobe',
      Assistant: 'self-hosted',
    },
  );
  assert.deepEqual(
    doc.unrendered.map((x) => x.family),
    ['Poppins'],
  );
  assert.deepEqual(doc.icons, ['icomoon']);
  assert.deepEqual(doc.build.stacks['Poppins, Arial, sans-serif'], { family: 'Arial' });
  assert.equal(doc.figmaChecked, false);
});
test('served file names determine CSS face matching, including variable and italic faces', async (t) => {
  const f = fixture(t),
    doc = await f.makePlan(null),
    faces = doc.build.families['suisseintl']!.faces;
  assert.equal(faces['500|0'], 'SemiBold');
  assert.equal(faces['700|0'], 'SemiBold');
  assert.equal(faces['400|1'], 'Italic');
  const ordinary = [
    { weight: 300, weightMax: 300, italic: false, style: 'Light' },
    { weight: 450, weightMax: 450, italic: false, style: 'Book' },
    { weight: 500, weightMax: 500, italic: false, style: 'Medium' },
  ];
  assert.equal(cssMatch(ordinary, 400, false)?.style, 'Book');
  assert.equal(cssMatch(ordinary, 425, false)?.style, 'Book');
  assert.equal(cssMatch(ordinary, 350, false)?.style, 'Light');
  assert.equal(
    cssMatch([{ weight: 200, weightMax: 800, italic: false, style: 'Regular', variable: true }], 450, false)?.weightMax,
    800,
  );
  assert.equal(weightOf('400garbage'), 400);
  assert.equal(weightOf('700 garbage'), 700);
  assert.equal(weightOf('450.5'), 450);
  assert.equal(weightOf('451.5'), 452);
  assert.equal(faceStyle('', 250, false), 'ExtraLight');
});
test('missing families receive genre-aware stand-ins, useful routes, and a concise summary', async (t) => {
  const f = fixture(t),
    doc = await f.makePlan(FIGMA),
    by = Object.fromEntries(doc.families.map((x) => [x.family, x]));
  assert.deepEqual(
    [
      by["Suisse Int'l"]?.available,
      by["Suisse Int'l"]?.standIn?.family,
      by["Suisse Int'l"]?.route?.kind,
      by["Suisse Int'l"]?.route?.foundry,
    ],
    [false, 'Inter', 'commercial', 'Swiss Typefaces'],
  );
  assert.deepEqual(
    [by['Freight Text Pro']?.standIn?.family, by['Freight Text Pro']?.route?.kind],
    ['Source Serif 4', 'adobe-fonts'],
  );
  assert.ok(
    (by['Freight Text Pro']?.route?.steps.join(' ') ?? '').includes('https://fonts.adobe.com/fonts/freight-text'),
  );
  assert.equal(by['Figtree']?.available, true);
  assert.equal(by['Assistant']?.available, true);
  const summary = summaryLines(doc).join('\n');
  assert.ok(summary.includes('the build uses Inter instead, by default'));
  assert.ok(summary.includes('Styles the site uses: Italic, SemiBold'));
  assert.ok(summary.includes('do not install them unless the licence says you may'));
});
test('macOS names omitted by Figma have no installation route and may use their listed relative name', async (t) => {
  const f = fixture(t),
    figma: Record<string, string[]> = { ...FIGMA };
  delete figma['Arial'];
  const arial = (await f.makePlan(figma)).families.find((x) => x.family === 'Arial')!;
  assert.deepEqual([arial.standIn?.family, arial.route?.kind, arial.route?.steps], ['Arimo', 'figma-omits', []]);
  assert.ok(
    summaryLines(await f.makePlan(figma))
      .find((s) => s.startsWith('- Arial'))
      ?.endsWith('instead, by default.'),
  );
  f.saveNodes({ text: 'type', computed: { fontFamily: 'monospace', fontWeight: '400', fontStyle: 'normal' } });
  const withRelative = await plan({
    run: f.run,
    repo: f.repo,
    figma: { ...FIGMA, 'Courier New': ['Regular', 'Bold'] },
    fetchAdobeKit: async () => ({}),
  });
  assert.equal(withRelative.families[0]?.standIn?.family, 'Courier New');
  assert.equal(withRelative.build.families['courier']?.family, 'Courier New');
  const without = await plan({ run: f.run, repo: f.repo, figma: FIGMA, fetchAdobeKit: async () => ({}) });
  assert.equal(without.families[0]?.standIn?.family, 'Cousine');
});
test('system family trial names and open-licence sources are resolved', async (t) => {
  const f = fixture(t),
    trial = { ...FIGMA, 'Suisse Intl Trial': ['Regular', 'Semibold'] },
    doc = await f.makePlan(trial),
    suisse = doc.families.find((x) => x.family === "Suisse Int'l")!;
  assert.equal(suisse.available, true);
  assert.equal(suisse.figmaFamily, 'Suisse Intl Trial');
  assert.equal(suisse.standIn, undefined);
  const figma: Record<string, string[]> = { ...FIGMA };
  delete figma['Assistant'];
  const assistant = (await f.makePlan(figma)).families.find((x) => x.family === 'Assistant')!;
  assert.deepEqual([assistant.route?.kind, assistant.route?.licence], ['open-licence', 'OFL']);
  assert.equal(availableFamily('Brand', { 'Brand Web': [] }), 'Brand Web');
  assert.equal(faceStyle('Brand-Semibold.woff2', 500, false), 'SemiBold');
});
test('Google references inside escaped configuration and remote CDN face names are discovered', async (t) => {
  const f = fixture(t),
    config = join(f.repo, 'config/sitestudio');
  mkdirSync(config, { recursive: true });
  writeFileSync(
    join(config, 'font.yml'),
    'json_values: \'{"url":"https:\\/\\/fonts.googleapis.com\\/css2?family=Noto+Serif&display=swap"}\'\n',
  );
  writeFileSync(
    join(f.theme, 'css/cdn.css'),
    '@font-face { font-family: Brand; src: url("https://cdn.example/fonts/Brand-Semibold.woff2?v=2"); font-weight: 500; }',
  );
  f.saveNodes(
    { text: 'serif', computed: { fontFamily: 'Noto Serif, serif', fontWeight: '400', fontStyle: 'normal' } },
    { text: 'bold', computed: { fontFamily: 'Brand, sans-serif', fontWeight: '500', fontStyle: 'normal' } },
  );
  const sources = declared(f.repo, config);
  assert.ok(sources.google.includes('Noto Serif'));
  assert.equal(sources.faces['brand']?.[0]?.style, 'SemiBold');
  const doc = await f.makePlan(null, true, { sitestudio: config });
  assert.equal(doc.families.find((x) => x.family === 'Noto Serif')?.source, 'google');
});
test('an unreachable Adobe kit preserves possible families and reports the cache state', async (t) => {
  const f = fixture(t),
    doc = await f.makePlan(FIGMA, false),
    freight = doc.families.find((x) => x.cssFamily === 'freight-text-pro')!;
  assert.deepEqual(
    [freight.source, freight.standIn?.family, freight.route?.kind],
    ['adobe', 'Source Serif 4', 'adobe-fonts'],
  );
  assert.ok(!doc.unrendered.some((x) => x.family === 'freight-text-pro'));
  assert.ok(summaryLines(doc).join('\n').includes('could not be read'));
});
test('icon names avoid false positives and unicode ranges fall through the declared stack', async (t) => {
  for (const name of ['icomoon', 'Font Awesome 6 Free', 'site-icons']) assert.equal(isIcon(name), true);
  for (const name of ['Lexicon', 'Fabiola']) assert.equal(isIcon(name), false);
  assert.deepEqual(rangesOf('U+0000-00FF, U+0131'), [
    [0, 255],
    [305, 305],
  ]);
  const f = fixture(t);
  writeFileSync(
    join(f.theme, 'css/latin.css'),
    '@font-face { font-family: Latin; src: url(../fonts/suisse/SuisseIntl-Regular.woff2); unicode-range: U+0000-00FF; }',
  );
  f.saveNodes(
    { text: 'Hello', computed: { fontFamily: 'Latin, Arial, sans-serif', fontWeight: '400', fontStyle: 'normal' } },
    { text: 'Шалом', computed: { fontFamily: 'Latin, Arial, sans-serif', fontWeight: '400', fontStyle: 'normal' } },
  );
  const stack = (await f.makePlan(null)).build.stacks['Latin, Arial, sans-serif'];
  assert.equal(stack?.family, 'Latin');
  assert.equal(stack?.otherwise, 'Arial');
  assert.deepEqual(stack?.ranges, [[0, 255]]);
});
test('open licences must cover every served face and web formats explain conversion', async (t) => {
  const f = fixture(t),
    open = join(f.theme, 'fonts/open');
  writeFileSync(join(open, 'Assistant.woff2'), 'font');
  const css = join(f.theme, 'css/fonts.css');
  writeFileSync(
    css,
    readFileSync(css, 'utf8') +
      '@font-face { font-family: Assistant; src: url(../fonts/open/Assistant.woff2); font-weight: 900; }',
  );
  const figma: Record<string, string[]> = { ...FIGMA };
  delete figma['Assistant'];
  let assistant = (await f.makePlan(figma)).families.find((x) => x.family === 'Assistant')!;
  assert.ok(assistant.route?.steps.join(' ').includes('convert each to TTF first'));
  mkdirSync(join(f.theme, 'fonts/other'));
  writeFileSync(join(f.theme, 'fonts/other/Assistant-Black.woff2'), 'font');
  writeFileSync(
    css,
    readFileSync(css, 'utf8') +
      '@font-face { font-family: Assistant; src: url(../fonts/other/Assistant-Black.woff2); font-weight: 950; }',
  );
  assistant = (await f.makePlan(figma)).families.find((x) => x.family === 'Assistant')!;
  assert.equal(assistant.route?.kind, 'commercial');
});
test('Adobe kit results are cached under the run and unreadable results are retried', async (t) => {
  const f = fixture(t),
    fetched: string[] = [],
    fetcher = async (id: string) => {
      fetched.push(id);
      return { Family: { cssNames: ['family'], variations: [] } };
    };
  await kitsFor(f.run, ['abc'], fetcher);
  await kitsFor(f.run, ['abc'], fetcher);
  assert.deepEqual(fetched, ['abc']);
  assert.ok(existsSync(join(f.run, 'fonts-kits.json')));
  writeFileSync(join(f.run, 'fonts-kits.json'), '{');
  await kitsFor(f.run, ['abc'], fetcher);
  assert.deepEqual(fetched, ['abc', 'abc']);
});
test('configuration decoding follows HTML5 named and numeric character references', () => {
  assert.equal(unescape('A&amp;B &NotEqualTilde; &#128; &#1; &notit;'), 'A&B ≂̸ €  ¬it;');
});
test('CSS discovery keeps baseline regex case behavior and requires source and license files', (t) => {
  const f = fixture(t),
    directoryFont = join(f.theme, 'fonts/open/directory.woff2');
  mkdirSync(directoryFont);
  writeFileSync(
    join(f.theme, 'css/case.css'),
    '@FONT-FACE { font-family: Upper; src: url(Upper.woff2); }\n@font-face { FONT-FAMILY: UpperProperty; src: url(Upper.woff2); }\n@font-face { font-family: Directory; src: url(../fonts/open/directory.woff2); }',
  );
  const sources = declared(f.repo);
  assert.equal(sources.faces['upper'], undefined);
  assert.equal(sources.faces['upperproperty'], undefined);
  assert.equal(sources.faces['directory']?.[0]?.exists, false);
  assert.equal(sources.faces['directory']?.[0]?.licence, null);
});
test('CLI reads project inputs, writes fonts.json, and prints its summary', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'design-lab-fonts-cli-')),
    run = join(root, 'run'),
    repo = join(root, 'repo');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(run, 'capture/measurements'), { recursive: true });
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(run, 'project.json'), JSON.stringify({ repository: { root: repo } }));
  writeFileSync(
    join(run, 'capture/measurements/card.spec.json'),
    JSON.stringify({
      measurements: {
        desktop: {
          nodes: [
            { text: 'Words', computed: { fontFamily: 'Arial, sans-serif', fontWeight: '400', fontStyle: 'normal' } },
          ],
        },
      },
    }),
  );
  assert.equal(await main([run]), 0);
  const saved = JSON.parse(readFileSync(join(run, 'fonts.json'), 'utf8'));
  assert.equal(saved.families[0].family, 'Arial');
  assert.equal(saved.figmaChecked, false);
});
