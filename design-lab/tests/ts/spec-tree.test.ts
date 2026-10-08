import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as st from '../../src/spec-to-tree.ts';
import { build } from '../../src/responsive.ts';
import { node, spec } from './p2-fixtures.ts';
import { roundDecimal, roundEven } from '../../src/json.ts';
import { maskUrl } from '../../src/capture/masks.ts';
import { fnv1a, callPayload, stripTemplate } from '../../src/render-payload.ts';
const merge = (nodes: ReturnType<typeof node>[]) => build(spec({ desktop: nodes, mobile: nodes }), 'X', 'x');
const arrow = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 11h12z"/></svg>';
const recolour = (source: string, width = 24, height = 24, color = 'rgb(28, 110, 107)') =>
  st.maskedIconSvg(node('/a', 0, 0, width, height, { backgroundColor: color }, { maskSvg: source }));
void test('baseline half-even geometry and decimal rounding', () => {
  assert.deepEqual([0.5, 1.5, -0.5, -1.5, 2.5].map(roundEven), [0, 2, 0, -2, 2]);
  assert.deepEqual(
    [1.005, 2.675, 0.125, 0.375].map((n) => roundDecimal(n, 2)),
    [1, 2.67, 0.12, 0.38],
  );
});
void test('colors and CSS variables retain source binding', () => {
  assert.deepEqual(st.parseColor('rgb(12, 34, 255)'), { hex: '#0c22ff', opacity: 1 });
  assert.deepEqual(st.parseColor('rgba(255, 0, 16, 0.25)'), { hex: '#ff0010', opacity: 0.25 });
  assert.equal(st.parseColor('rgba(0, 0, 0, 0)'), null);
  assert.equal(st.parseColor('transparent'), null);
  assert.equal(st.cssVar('color: var( --brand-red, red)'), '--brand-red');
  assert.equal(st.cssVar('#ff0000'), null);
  assert.equal(
    st.styleOf(
      node(
        '/div[0]',
        0,
        0,
        20,
        10,
        { backgroundColor: 'rgb(12, 34, 56)' },
        { declared: { 'background-color': 'var(--brand-surface)' } },
      ),
    ).fill?.var,
    '--brand-surface',
  );
});
void test('flex gap and center alignment', () => {
  const l = st.inferLayout(
    node('/div[0]', 0, 0, 100, 30, { display: 'flex', justifyContent: 'center' }),
    [10, 40, 70].map((x, i) => node('/div[0]/span[' + i + ']', x, 0, 20, 10)),
  );
  assert.deepEqual([l.mode, l.gap, l.primaryAlign], ['HORIZONTAL', 10, 'CENTER']);
});
void test('grid rows preserve column and row gaps', () => {
  const l = st.inferLayout(
    node('/div[0]', 0, 0, 50, 28, { display: 'grid' }),
    [
      [0, 0],
      [30, 0],
      [0, 18],
      [30, 18],
    ].map(([x, y], i) => node('/div[0]/span[' + i + ']', x, y, 20, 10)),
  );
  assert.deepEqual([l.mode, l.wrap, l.gap, l.counterGap], ['HORIZONTAL', true, 10, 8]);
});
void test('block margins become padding and unequal spacers', () => {
  const root = node('/div[0]', 0, 0, 100, 100),
    kids = [7, 22, 43].map((y, i) => node('/div[0]/p[' + i + ']', 0, y, 100, 10, {}, { tag: 'p' }));
  const l = st.inferLayout(root, kids);
  assert.equal(l.padding.top, 7);
  assert.deepEqual(l.spacers, [5, 11]);
  assert.deepEqual(
    st
      .build(spec({ desktop: [root, ...kids] }))
      .breakpoints[0]!.tree!.children!.filter((n) => n.name === 'Spacer')
      .map((n) => n.height),
    [5, 11],
  );
});
void test('two-pixel gap tolerance retains operation grouping', () => {
  const l = st.primaryAlign([0, 31.22, 61.22], [21.22, 18, 20], 0, 81.22);
  assert.deepEqual(l, ['MIN', 10]);
});
void test('misaligned children fall back to free placement', () => {
  assert.equal(
    st.inferLayout(node('/div[0]', 0, 0, 100, 40, { display: 'flex' }), [
      node('/a', 0, 0, 20, 10),
      node('/b', 30, 7, 20, 10),
    ]).fellBack,
    true,
  );
});
void test('BEM names and wrapper collapse retain text', () => {
  const root = node('/div[0]', 0, 0, 100, 20, {}, { classes: ['c-stat'] }),
    wrapper = node('/div[0]/div[0]', 0, 0, 100, 20),
    value = node(
      '/div[0]/div[0]/span[0]',
      0,
      0,
      100,
      20,
      {},
      { tag: 'span', classes: ['c-stat__value'], inlineText: '42' },
    );
  const built = st.build(spec({ desktop: [root, wrapper, value] })).breakpoints[0]!.tree!;
  assert.deepEqual(
    built.children!.map((c) => [c.name, c.kind]),
    [['Value', 'text']],
  );
});
void test('semantic layer names never repeat Figma defaults', () => {
  for (const cls of ['c-card__text', 'c-frame', 'c-card__group'])
    assert.ok(
      !['Text', 'Frame', 'Group'].includes(st.nodeName(node('/a', 0, 0, 10, 10, {}, { classes: [cls] }), null)!),
    );
  assert.equal(st.nodeName(node('/a', 0, 0, 10, 10, {}, { tag: 'p' }), null), 'Paragraph');
});
void test('hidden mobile child binds Boolean visibility', () => {
  const root = node('/div[0]', 0, 0, 100, 40),
    child = node('/div[0]/p[1]', 0, 0, 100, 20, {}, { text: 'hello', tag: 'p' });
  const result = build(
    spec({ desktop: [root, child], mobile: [root, { ...child, computed: { ...child.computed, display: 'none' } }] }),
    'X',
    'x',
  );
  const ref = result.tree.children![0]!.visible as { var: string };
  assert.equal(result.variables[ref.var]!.type, 'BOOLEAN');
  assert.deepEqual(result.variables[ref.var]!.values, { Desktop: true, Tablet: true, Mobile: false });
});
void test('zero-size and contents wrappers pass through; hidden ones stay hidden', () => {
  assert.equal(st.passthrough(node('/p', 0, 0, 0, 0, { display: 'inline' })), true);
  assert.equal(st.passthrough(node('/p', 0, 0, 100, 50, { display: 'contents' })), true);
  assert.equal(st.passthrough(node('/p', 0, 0, 0, 0, { display: 'none' })), false);
  assert.equal(st.passthrough(node()), false);
});
void test('clip path geometry stays bounded', () => {
  const circle = st.clipShape('circle(50% at 50% 50%)', 100, 100)!;
  assert.deepEqual(circle, { kind: 'ellipse', cx: 50, cy: 50, rx: 50, ry: 50 });
  assert.deepEqual(st.clipShape('polygon(0% 0%, 100% 0%, 50px 100%)', 200, 80), {
    kind: 'polygon',
    points: [
      [0, 0],
      [200, 0],
      [50, 80],
    ],
  });
  assert.equal(st.clipShape('inset(10px)', 10, 10), null);
  assert.ok(st.shapeSvg(circle, 100, 100, { hex: '#9ED4D6', opacity: 1 }).includes('clip-path="url(#box)"'));
});
const chevron = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M1 1L2 2'/%3E%3C/svg%3E")`;
void test('pseudo images become visible SVG/background layers', () => {
  const link = node(
    '/a',
    0,
    0,
    50,
    50,
    { fontSize: '16px' },
    {
      before: { content: chevron, width: '24px', height: '24px', marginRight: '8px', display: 'inline-block' },
      after: {
        content: '""',
        backgroundImage: 'url("/icons/x.png")',
        width: '10px',
        height: '10px',
        marginLeft: '4px',
      },
    },
  );
  const icon = st.pseudoImage(link, 'before')!;
  assert.deepEqual([icon.width, icon.height, icon.gap], [24, 24, 8]);
  assert.ok(icon.svg!.startsWith('<svg'));
  assert.equal(st.pseudoImage(link, 'after')!.src, '/icons/x.png');
  assert.equal(st.pseudoImage({ ...link, after: { content: '"→"' } }, 'after'), null);
});
void test('a child reordered by width occupies visibility-controlled placements', () => {
  const stack = (width: number, first: boolean) => [
    node('/div[0]', 0, 0, width, 200),
    ...[30, 40, 100].map((h, i) =>
      node(`/div[0]/div[${i + 1}]`, 0, (first ? [100, 130, 0] : [0, 30, 90])[i], width, h, {
        backgroundColor: 'rgb(1, 2, 3)',
      }),
    ),
  ];
  const result = build(spec({ desktop: stack(1400, true), mobile: stack(375, false) }), 'X', 'x'),
    slots = result.tree.children!;
  assert.deepEqual(result.fallbacks, []);
  assert.deepEqual(
    slots.map((s) => s.source.split('#')[0]!.slice(-6)),
    ['div[3]', 'div[1]', 'div[2]', 'div[3]'],
  );
  assert.ok(slots[0]!.visible && slots[3]!.visible);
  assert.equal(slots[1]!.visible, undefined);
  assert.equal(slots[3]!.layout!.padding!.top, 20);
});
void test('empty inline wrappers pass through without distorting image boxes', () => {
  const picture = node('/p', 0, 78, 335, 28, { display: 'inline' }, { tag: 'picture' });
  assert.equal(st.passthrough(picture), true);
  assert.equal(st.passthrough(picture, false), false);
  assert.equal(st.passthrough({ ...picture, text: 'Hi' }), false);
  assert.equal(st.passthrough(node('/a', 0, 0, 50, 20, { display: 'inline', backgroundColor: 'rgb(1, 2, 3)' })), false);
});
void test('pseudo icon rotation occurs within the SVG', () => {
  assert.equal(st.rotation('matrix(-1, 0, 0, -1, 0, 0)'), 180);
  assert.equal(st.rotation('none'), 0);
  const result = st.pseudoImage(
    node(
      '/a',
      0,
      0,
      50,
      50,
      {},
      { before: { content: chevron, width: '24px', height: '24px', transform: 'matrix(-1, 0, 0, -1, 0, 0)' } },
    ),
    'before',
  );
  assert.ok(result?.svg?.includes('<g transform="rotate(180.0 12.0 12.0)">'));
});
void test('positioned children and pseudo boxes retain absolute stacking order', () => {
  const root = node(
    '/div[0]',
    0,
    0,
    400,
    300,
    { position: 'relative' },
    {
      before: {
        content: '""',
        backgroundColor: 'rgb(52, 38, 73)',
        position: 'absolute',
        width: '400px',
        height: '260px',
        top: '40px',
        left: '0px',
        zIndex: '1',
      },
    },
  );
  const result = merge([
    root,
    node('/div[0]/div[1]', 200, 0, 180, 120, {
      position: 'absolute',
      zIndex: '10',
      backgroundColor: 'rgb(250, 250, 250)',
    }),
    node('/div[0]/div[2]', 0, 40, 400, 260, { position: 'relative', zIndex: '5', backgroundColor: 'rgb(9, 9, 9)' }),
  ]).tree;
  assert.equal(result.children![0]!.name, 'Decoration');
  assert.ok(result.children![0]!.absolute && result.children!.at(-1)!.absolute);
  assert.equal(result.children!.at(-1)!.source, '/div[0]/div[1]');
  assert.deepEqual([result.children![0]!.x, result.children![0]!.y], [0, 40]);
});
void test('reversed rows use drawn order at all widths', () => {
  const row = (width: number) => [
    node('/div[0]', 0, 0, width, 100),
    node('/div[0]/div[1]', 160, 0, width - 160, 100, { backgroundColor: 'rgb(1, 1, 1)' }),
    node('/div[0]/div[2]', 0, 0, 145, 100, { backgroundColor: 'rgb(2, 2, 2)' }),
  ];
  const result = build(spec({ desktop: row(800), mobile: row(335) }), 'X', 'x');
  assert.deepEqual(result.fallbacks, []);
  assert.deepEqual(
    result.tree.children!.map((c) => c.source.split('#')[0]!.slice(-6)),
    ['div[2]', 'div[1]'],
  );
});
void test('translation requires free placement; pure rotations do not', () => {
  assert.equal(st.translated(node('/x', 0, 0, 10, 10, { transform: 'matrix(1, 0, 0, 1, -2820, 0)' })), true);
  for (const transform of ['matrix(-1, 0, 0, -1, 0, 0)', 'none'])
    assert.equal(st.translated(node('/x', 0, 0, 10, 10, { transform })), false);
});
void test('translated decoration is cropped to the component behind content', () => {
  const root = node(
    '/div[0]',
    0,
    0,
    1160,
    400,
    { position: 'relative' },
    {
      before: {
        content: '""',
        backgroundColor: 'rgb(52, 38, 73)',
        position: 'absolute',
        left: '580px',
        top: '0px',
        width: '1400px',
        height: '400px',
        zIndex: '0',
        transform: 'matrix(1, 0, 0, 1, -700, 0)',
      },
    },
  );
  const result = merge([
    root,
    node('/div[0]/div[1]', 50, 0, 1110, 400, { position: 'relative', backgroundColor: 'rgb(158, 212, 213)' }),
  ]).tree;
  assert.deepEqual(
    [result.children![0]!.name, result.children![0]!.x, result.children![0]!.width],
    ['Decoration', 0, 1160],
  );
  assert.equal(result.children![1]!.source, '/div[0]/div[1]');
});
void test('overflow windows clip wide carousel tracks', () => {
  const result = merge([
    node('/div[0]', 0, 0, 375, 340),
    node('/div[0]/div[1]', 0, 0, 375, 300, { overflow: 'hidden', backgroundColor: 'rgb(9, 9, 9)' }),
    node('/div[0]/div[1]/div[2]', 0, 0, 19094, 270, { backgroundColor: 'rgb(1, 1, 1)' }),
    node('/div[0]/div[3]', 0, 300, 375, 40, { overflow: 'visible', backgroundColor: 'rgb(2, 2, 2)' }),
  ]).tree;
  assert.ok(result.children!.find((n) => n.source === '/div[0]/div[1]')!.clip);
  assert.equal(result.children!.find((n) => n.source === '/div[0]/div[3]')!.clip, undefined);
  assert.ok(st.clips({ overflow: 'visible hidden' }));
  assert.ok(st.clips({ overflow: 'auto' }));
  assert.equal(st.clips({ overflow: 'visible' }), false);
});
for (const [name, run] of [
  [
    'background colour',
    () => {
      assert.ok(recolour(arrow)!.includes('fill="#1c6e6b"'));
    },
  ],
  [
    'none and opacity',
    () => {
      const s = recolour(
        '<svg viewBox="0 0 2 2"><path fill="#000" stroke="none"/><g style="fill: red"/></svg>',
        2,
        2,
        'rgba(255, 0, 0, 0.5)',
      )!;
      assert.ok(s.includes('stroke="none"') && s.includes('fill:#ff0000') && s.includes('opacity="0.5"'));
    },
  ],
  [
    'no colour or no mask',
    () => {
      assert.equal(st.maskedIconSvg(node()), null);
      assert.equal(st.maskedIconSvg(node('/a', 0, 0, 2, 2, {}, { maskSvg: arrow })), null);
    },
  ],
  [
    'stylesheet without semicolon',
    () => {
      const s = recolour('<svg viewBox="0 0 24 24"><style>.a{fill:#000}</style><path class="a"/></svg>')!;
      assert.ok(s.includes('.a{fill:#1c6e6b}</style>'));
      assert.ok(s.endsWith('</svg>'));
    },
  ],
  [
    'single quotes and XML',
    () => {
      const s = recolour("<?xml version='1.0'?><!-- <svg> tool --><svg viewBox='0 0 24 24'><path fill='#fff'/></svg>")!;
      assert.ok(s.startsWith('<svg') && !s.includes('#fff'));
    },
  ],
  [
    'HTML login refusal',
    () => {
      assert.equal(recolour('<!DOCTYPE html><html><body><svg><path/></svg>Log in</body></html>'), null);
    },
  ],
  [
    'drawing size preservation',
    () => {
      const s = recolour('<svg width="40" height="20"><path/></svg>')!;
      assert.ok(s.includes('width="24.0" height="24.0"') && s.includes('viewBox="0 0 40 20"'));
    },
  ],
  [
    'BOM and percentage sizes',
    () => {
      const s = recolour('\ufeff<svg width="100%" height="100%"><path/></svg>')!;
      assert.ok(s.startsWith('<svg') && !s.includes('viewBox'));
    },
  ],
  [
    'children and text retain frames',
    () => {
      const n = node('/a', 0, 0, 10, 10, { backgroundColor: 'rgb(0, 0, 0)' }, { maskSvg: arrow });
      assert.equal(st.maskedLeaf(n, true), null);
      assert.equal(st.maskedLeaf({ ...n, text: 'Wave' }, false), null);
      assert.ok(st.maskedLeaf(n, false));
    },
  ],
] as const)
  void test('CSS masks: ' + name, run);
void test('mask URLs handle quoted whitespace, data parentheses and escapes', () => {
  assert.equal(
    maskUrl(`url("data:image/svg+xml;utf8,<svg><g transform='rotate(45)'/></svg>")`),
    "data:image/svg+xml;utf8,<svg><g transform='rotate(45)'/></svg>",
  );
  assert.equal(maskUrl("url('https://x.org/a b.svg')"), 'https://x.org/a b.svg');
  assert.equal(maskUrl('url(https://x.org/a.svg)'), 'https://x.org/a.svg');
  assert.equal(maskUrl('url("a\\"b.svg")'), 'a"b.svg');
  assert.equal(maskUrl('none'), null);
});
void test('FNV checksum matches UTF16 vectors', () => {
  assert.equal(fnv1a('hello'), '4f9f2cab');
  assert.equal(fnv1a('😀'), 'cb31c4b8');
});
void test('transit checksum rejects altered args before rendering', async () => {
  const code = callPayload('pages', { pages: ['one'] }).split('const wanted =')[0]!;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    code: string,
  ) => () => Promise<void>;
  await new AsyncFunction(code)();
  await assert.rejects(new AsyncFunction(code.replace('"one"', '"two"'))(), /altered in transit/);
});
void test('type stripping accepts async function bodies with top-level returns', () => {
  const result = stripTemplate('const n: number = 4;\nreturn n;');
  assert.ok(!result.includes(': number'));
});
void test('one-track grid at every width remains a vertical stack', () => {
  const nodes = (width: number) => [
    node('/div[0]', 0, 0, width, 50, { display: 'grid', gridTemplateColumns: `${width}px` }),
    ...[0, 1, 2].map((i) => node(`/div[0]/div[${i}]`, 0, i * 20, width, 10)),
  ];
  const result = build(spec({ desktop: nodes(300), tablet: nodes(260), mobile: nodes(200) }), 'Grid');
  assert.equal(result.tree.layout!.mode, 'VERTICAL');
  assert.equal(result.tree.layout!.wrap, undefined);
});
void test('multiple tracks at any width retain a wrapping row', () => {
  const nodes = (width: number, columns: number, cw: number) => [
    node('/div[0]', 0, 0, width, 50, {
      display: 'grid',
      gridTemplateColumns: new Array(columns).fill(cw + 'px').join(' '),
    }),
    ...[1, 2, 3].map((i, j) =>
      node(`/div[0]/div[${i}]`, (j % columns) * (cw + 10), Math.floor(j / columns) * 20, cw, 10),
    ),
  ];
  const result = build(
    spec({ desktop: nodes(320, 3, 100), tablet: nodes(260, 3, 80), mobile: nodes(300, 1, 300) }),
    'Grid',
  );
  assert.equal(result.tree.layout!.mode, 'HORIZONTAL');
  assert.equal(result.tree.layout!.wrap, true);
});
void test('unrecorded grid tracks never imply a single column', () => {
  assert.equal(st.gridTracks(node('/a', 0, 0, 20, 10, { display: 'grid' })), null);
  assert.equal(st.gridTracks(node()), 0);
  assert.equal(st.gridTracks(node('/a', 0, 0, 20, 10, { display: 'grid', gridTemplateColumns: '1px 2px' })), 2);
});
void test('SVG root attributes retain replacement metacharacters literally', () => {
  for (const marker of ["$'", '$&', '$$', '$`']) {
    const source = `<svg data-label="${marker}" viewBox="0 0 24 24"><path d="M4 11h12z"/></svg>`,
      out = recolour(source)!;
    assert.equal((out.match(/<\/svg>/g) ?? []).length, 1);
    assert.ok(out.includes(`data-label="${marker}"`));
  }
});
