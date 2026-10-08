import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveOptions, treat, planComponent } from '../../src/plan.ts';
import { build, num, codeName, consolidateSingleModeCollections } from '../../src/plan-variables.ts';
import type { VariablePlan } from '../../src/plan-variables.ts';
import type { Components } from '../../src/generated/components.ts';
const component = (extra: Record<string, unknown> = {}): Components['components'][number] => ({
  id: 'block:hero',
  label: 'Hero',
  sourceRef: 'bundle.yml',
  fields: [],
  slots: [],
  defects: [],
  usage: { placements: 12, structuralRefs: 0 },
  ...extra,
});
const capture = {
  path: '/about',
  states: ['default'],
  images: [{ file: 'hero.png' }],
};
test('rendering without capture is refused, verified capture authorizes build', () => {
  const c = component();
  assert.match(planComponent(c, { rootClasses: ['hero'] }).refuseReason!, /screenshot/);
  assert.equal(planComponent(c, { rootClasses: ['hero'] }, capture).verdict, 'build');
  assert.equal(planComponent(c, { sdc: [], templates: [], rootClasses: [] }).libraryRole, 'schema-only');
});
test('unknown and partial usage never authorizes retirement', () => {
  for (const status of ['unknown', 'partial', 'unavailable'])
    assert.equal(
      planComponent(component({ usage: { placements: 0, structuralRefs: 0, status } }), { rootClasses: ['hero'] })
        .libraryRole,
      'component',
    );
  assert.equal(planComponent(component({ usage: { placements: 0, structuralRefs: 0 } })).libraryRole, 'retirement');
  assert.equal(
    planComponent(component({ usage: { placements: null, structuralRefs: null } })).libraryRole,
    'schema-only',
  );
});
test('a nested rendered subcomponent is built; a data-only captured part is mapped', () => {
  const c = component({
    containedBy: ['parent'],
    usage: { placements: 0, structuralRefs: 1 },
  });
  assert.equal(planComponent(c, { rootClasses: ['hero'] }, capture, 1).verdict, 'build');
  assert.equal(planComponent(c, { rootClasses: ['hero'] }, capture).verdict, 'map');
});
test('variant policies account for implicit unset, bounded axes, spacing sides and swaps', () => {
  assert.equal(
    effectiveOptions({
      options: [{ value: 'a' }, { value: 'b' }],
      default: null,
    }),
    3,
  );
  assert.equal(
    effectiveOptions({
      options: [{ value: '' }, { value: 'a' }],
      default: null,
    }),
    2,
  );
  assert.deepEqual(treat({ kind: 'enum', options: [] }), [
    'manual',
    1,
    'no options could be extracted - resolve by hand',
  ]);
  assert.equal(
    treat({
      kind: 'enum',
      options: Array.from({ length: 10 }, (_, i) => ({ value: String(i) })),
    })[0],
    'manual',
  );
  assert.match(
    treat({
      kind: 'enum',
      tokenFamily: 'spacing',
      options: [{ value: 'padding-left-small' }, { value: 'padding-right-small' }],
    })[2]!,
    /sides/,
  );
  const p = planComponent(
    component({
      fields: [
        {
          name: 'color',
          label: 'Color',
          kind: 'enum',
          tokenFamily: 'color-scheme',
          options: Array.from({ length: 9 }, (_, i) => ({ value: i })),
        },
        {
          name: 'layout',
          label: 'Layout',
          kind: 'enum',
          tokenFamily: 'layout',
          options: Array.from({ length: 9 }, (_, i) => ({ value: i })),
        },
      ],
      slots: [{ name: 'inner' }],
    }),
    {},
    capture,
  );
  assert.equal(p.variants, 100);
  assert.equal(p.verdict, 'refuse');
  assert.match(p.refuseReason!, /maxVariants/);
  assert.deepEqual(p.properties, [{ field: 'inner', treatment: 'swap' }]);
});
test('unit-aware values and Sass map-get names resolve', () => {
  assert.equal(num('2.25rem'), 36);
  assert.equal(num('1em'), 16);
  assert.equal(num('50%'), null);
  assert.equal(codeName({ codePath: '$spacers[1]' }), 'map-get($spacers, 1)');
  assert.equal(codeName({ codePath: '$broken' }), null);
  const plan = build({
    source: { strategy: 'sass-source' },
    tokens: [
      {
        name: 'spacers-1',
        value: '1rem',
        family: 'spacing',
        layer: 'base',
        codePath: '$spacers[1]',
      },
    ],
  });
  assert.equal(plan.collections['Core']!.variables[0]!.codeName, 'map-get($spacers, 1)');
});
test('unused breakpoint modes collapse into Core', () => {
  const plan: VariablePlan = {
    modes: ['Value'],
    warnings: [],
    collections: {
      Colour: {
        modes: ['Value'],
        variables: [{ name: 'color/a', type: 'COLOR', hex: '#000' }],
      },
      Spacing: {
        modes: ['Value', '@media x'],
        variables: [
          {
            name: 'space/a',
            type: 'FLOAT',
            valuesByMode: { Value: 2, '@media x': 2 },
          },
        ],
      },
      Radius: {
        modes: ['Value'],
        variables: [{ name: 'radius/a', type: 'FLOAT', valuesByMode: { Value: 4 } }],
      },
    },
  };
  consolidateSingleModeCollections(plan);
  assert.deepEqual(Object.keys(plan.collections), ['Core']);
  assert.deepEqual(plan.collections['Core']!.variables.find((v) => v.type === 'FLOAT')!.valuesByMode, { Value: 2 });
});
test('large token inventory consolidates aliases and preserves responsive values', () => {
  const plan = build({
    source: { strategy: 'css-custom-properties' },
    modes: ['Value', '(min-width: 60em)'],
    tokens: [
      ...Array.from({ length: 100 }, (_, i) => ({
        name: `tone-${i}`,
        family: 'color',
        layer: 'base',
        value: '#' + i.toString(16).padStart(6, '0'),
        codeName: `--tone-${i}`,
      })),
      {
        name: 'color-text-default',
        family: 'color',
        layer: 'base',
        value: '#000001',
        codeName: '--color-text-default',
      },
      {
        name: 'text-title',
        family: 'font-size',
        layer: 'base',
        value: '2rem',
        codeName: '--text-title',
        valuesByMode: { Value: '2rem', '(min-width: 60em)': '3rem' },
      },
    ],
  });
  assert.deepEqual(Object.keys(plan.collections), ['Core', 'Type']);
  assert.ok(plan.collections['Core']!.variables.find((v) => v.aliasOf === 'Color/Primitive/tone-1'));
  assert.deepEqual(plan.collections['Type']!.variables[0]!.valuesByMode, {
    Value: 32,
    '(min-width: 60em)': 48,
  });
});
test('independent responsive mode axes remain independent', () => {
  const plan = build({
    modes: ['Light', 'Dark'],
    colors: [],
    _extraCollections: {
      Core: {
        modes: ['Day', 'Night'],
        variables: [{ name: 'theme', type: 'FLOAT', valuesByMode: { Day: 1, Night: 2 } }],
      },
    },
    customStyles: [
      {
        name: 'text',
        property: 'font-size',
        family: 'type',
        valuesByBreakpoint: { Light: '12px', Dark: '14px' },
      },
    ],
  });
  assert.deepEqual(plan.collections['Core']!.modes, ['Day', 'Night']);
  assert.deepEqual(plan.collections['Type']!.modes, ['Light', 'Dark']);
  assert.equal(plan.collectionStrategy!.kind, 'grouped-by-mode-boundary');
});
test('unknown token schema fails closed', () =>
  assert.throws(() => build({ source: { strategy: 'unrecognized' } }), /unrecognised/));
