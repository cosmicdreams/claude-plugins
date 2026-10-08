/** Token normalization and Figma variable planning, equivalent to plan_variables.ts. */
import { sorted } from './json.ts';
import type { PlannedVariable, VariableCollection, VariablePlan as GeneratedPlan } from './generated/variable-plan.ts';

interface Source {
  strategy?: string;
  [key: string]: unknown;
}
interface Token {
  name: string;
  family: string;
  value?: string | null;
  layer?: string;
  codeName?: string | null;
  codePath?: string;
  provenance?: unknown;
  valuesByMode?: Record<string, string>;
}
interface Color {
  name: string;
  hex?: string | null;
  codeName?: string | null;
  tags?: (string | null)[];
  inUse?: boolean;
  provenance?: unknown;
}
interface FontStack {
  name: string;
  stack?: string | null;
  primaryFamily?: string | null;
  codeName?: string | null;
  inUse?: boolean;
}
interface Scss {
  name: string;
  value?: string | number | null;
  codeName?: string | null;
}
interface CustomStyle {
  name: string;
  family: string;
  property: string;
  codeName?: string | null;
  valuesByBreakpoint: Record<string, string | number | null>;
}
export type Variable = PlannedVariable;
export type Collection = VariableCollection;
export type Warning = NonNullable<GeneratedPlan['warnings']>[number];
export interface TokenInput {
  source?: Source;
  modes?: string[];
  tokens?: Token[];
  colors?: Color[];
  fontStacks?: FontStack[];
  scssVariables?: Scss[];
  customStyles?: CustomStyle[];
  modeRationale?: unknown;
  typeScaling?: unknown;
  _semantic?: Variable[];
  _extraCollections?: Record<string, Collection>;
}
export type VariablePlan = Omit<GeneratedPlan, 'collections' | 'modes' | 'warnings'> & {
  modes: string[];
  collections: Record<string, Collection>;
  warnings: Warning[];
};
export const slug = (value: unknown): string =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const pyString = (value: unknown): string =>
  value === null || value === undefined
    ? 'None'
    : typeof value === 'boolean'
      ? value
        ? 'True'
        : 'False'
      : String(value);
export function codeName(token: { codeName?: string | null; codePath?: string }): string | null {
  if (token.codeName) return token.codeName;
  const entry = /^(\$[\w-]+)\[([\w.-]+)\]$/.exec(token.codePath ?? '');
  return entry ? `map-get(${entry[1]}, ${entry[2]})` : null;
}
export function firstCode(rows: { codeName?: string | null }[]): string | null {
  return [...new Set(rows.flatMap((r) => (r.codeName ? [r.codeName] : [])))].sort()[0] ?? null;
}
export function num(value: unknown): number | null {
  const m = /^\s*(-?[\d.]+)\s*(px|rem|em|%)?\s*$/.exec(pyString(value));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) throw new Error(`invalid numeric token: ${pyString(value)}`);
  return m[2] === '%' ? null : ['rem', 'em'].includes(m[2] ?? '') ? n * 16 : n;
}
export function uniquify(variables: Variable[]): Variable[] {
  const counts = new Map<string, number>();
  for (const variable of variables) counts.set(variable.name, (counts.get(variable.name) ?? 0) + 1);
  for (const variable of variables)
    if (counts.get(variable.name)! > 1) {
      const disc = variable.hex || (Object.values(variable.valuesByMode ?? {})[0] ?? '');
      const suffix =
        variable.type === 'FLOAT' && typeof disc === 'number' && Number.isInteger(disc) ? `${disc}.0` : pyString(disc);
      variable.name = `${variable.name}-${slug(suffix)}`;
      variable.nameDisambiguated = true;
    }
  return variables;
}
const primaryFamily = (stack: unknown): string | null =>
  pyString(stack)
    .split(',')[0]!
    .trim()
    .replace(/^['"]+|['"]+$/g, '') || null;
const roleWord =
  /(^|-)(text|bg|background|surface|border|skin|link|fill|shadow|action|on|primary|secondary|tertiary|info|danger|warning|success|muted|subtle)(-|$)/i;
const semanticRoles: [RegExp, string, string[]][] = [
  [/^color-text(-|$)|^color-link/i, 'text', ['TEXT_FILL']],
  [
    /^color-(bg|background)(-|$)|^color-surface|^skin-|^(bg|background|surface)-/i,
    'surface',
    ['FRAME_FILL', 'SHAPE_FILL'],
  ],
  [/^color-border(-|$)/i, 'border', ['STROKE_COLOR']],
  [/^color-brand(-|$)/i, 'action', ['FRAME_FILL', 'SHAPE_FILL']],
];
const familyScopes: Record<string, string[]> = {
  spacing: ['GAP', 'WIDTH_HEIGHT'],
  radius: ['CORNER_RADIUS'],
  'font-size': ['FONT_SIZE'],
  'line-height': ['LINE_HEIGHT'],
  'font-weight': ['FONT_WEIGHT'],
  'letter-spacing': ['LETTER_SPACING'],
};
export function semanticPath(name: string): [string | null, string[] | null] {
  for (const [pattern, group, scopes] of semanticRoles)
    if (pattern.test(name)) {
      let leaf = name.replace(/^(color|skin)-/, '');
      const stripped = leaf.replace(/^(text|bg|background|surface|border|brand|link)-/, '');
      if (stripped && stripped !== leaf) leaf = stripped;
      if ([group, 'bg', 'background', ''].includes(leaf)) leaf = 'default';
      return [`${group}/${slug(leaf)}`, scopes];
    }
  return [null, null];
}
const normHex = (value: unknown): string => {
  const v = pyString(value).trim().toLowerCase();
  return /^#[0-9a-f]{3}$/.test(v) ? '#' + [...v.slice(1)].map((c) => c + c).join('') : v;
};
const shortest = <T>(values: T[], name: (v: T) => string): T =>
  values.toSorted(
    (a, b) => name(a).length - name(b).length || (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0),
  )[0]!;
function fromCssvars(tokens: TokenInput): [TokenInput, Warning[]] {
  const rows = (tokens.tokens ?? []).filter((t) => t.layer === 'base'),
    warnings: Warning[] = [];
  const value = (t: Token): string | null | undefined =>
    t.valuesByMode && 'Value' in t.valuesByMode ? t.valuesByMode['Value'] : t.value;
  const byHex = new Map<string, Token[]>();
  for (const token of rows.filter((t) => t.family === 'color')) {
    const key = normHex(value(token));
    if (!byHex.has(key)) byHex.set(key, []);
    byHex.get(key)!.push(token);
  }
  const lead = (members: Token[]): Token =>
    shortest(
      members.filter((t) => !roleWord.test(t.name)).length ? members.filter((t) => !roleWord.test(t.name)) : members,
      (t) => t.name,
    );
  const palette: Token[] = [],
    aliases: Token[] = [];
  for (const members of byHex.values()) {
    const l = lead(members);
    palette.push(l);
    aliases.push(...members.filter((t) => t !== l));
  }
  const colors = palette.map((t) => ({
    name: t.name,
    hex: value(t) ?? null,
    codeName: codeName(t),
    tags: [],
    inUse: true,
    provenance: t.provenance ?? null,
  }));
  let semantic: Variable[] = [];
  for (const token of aliases) {
    const [p, s] = semanticPath(token.name);
    semantic.push({
      name: p ?? `other/${slug(token.name)}`,
      type: 'COLOR',
      aliasOf: `color/${slug(lead(byHex.get(normHex(value(token)))!).name)}`,
      hex: value(token) ?? null,
      codeName: codeName(token),
      scopes: s ?? ['FRAME_FILL', 'SHAPE_FILL'],
    });
  }
  for (const token of palette)
    if (roleWord.test(token.name)) {
      const [p, s] = semanticPath(token.name);
      if (p)
        semantic.push({
          name: p,
          type: 'COLOR',
          aliasOf: `color/${slug(token.name)}`,
          hex: value(token) ?? null,
          codeName: codeName(token),
          scopes: s!,
        });
    }
  const seen = new Set<string>();
  semantic = semantic.filter((v) => {
    if (seen.has(v.name)) {
      warnings.push({
        kind: 'semantic-path-collision',
        value: v.name,
        detail: `${pyString(v.codeName)} resolves to a role already claimed by another custom property with the same value`,
      });
      return false;
    }
    seen.add(v.name);
    return true;
  });
  const stacks = rows
    .filter((t) => t.family === 'font-family')
    .map((t) => ({
      name: t.name,
      stack: value(t) ?? null,
      primaryFamily: primaryFamily(value(t)),
      codeName: codeName(t),
      inUse: true,
    }));
  const scss = rows
    .filter((t) => t.family === 'spacing')
    .map((t) => ({
      name: t.name,
      value: value(t) ?? null,
      codeName: codeName(t),
    }));
  const custom = rows
    .filter((t) => t.family === 'font-size')
    .map((t) => ({
      name: t.name,
      codeName: codeName(t),
      property: 'font-size',
      family: 'type',
      valuesByBreakpoint: {
        ...(Object.keys(t.valuesByMode ?? {}).length ? t.valuesByMode : { Value: t.value ?? null }),
      },
    }));
  const extra: Record<string, Collection> = {};
  const ratios = rows.filter((t) => t.family === 'line-height' && !!num(value(t)) && num(value(t))! < 4);
  if (ratios.length)
    extra['LeadingRatio'] = {
      modes: ['Value'],
      variables: ratios.map((t) => ({
        name: `leading/${slug(t.name)}`,
        type: 'FLOAT',
        valuesByMode: { Value: num(value(t)) },
        codeName: codeName(t),
        scopes: [],
        unitlessRatio: true,
        description:
          'Ratio, not a length. Multiply by the font size; never bind to lineHeight, which Figma reads as pixels.',
      })),
    };
  const motion = rows.filter((t) => t.family === 'motion');
  if (motion.length)
    extra['Motion'] = {
      modes: ['Value'],
      variables: motion.flatMap((t) => {
        const m = /^\s*(-?[\d.]+)\s*(ms|s)\s*$/.exec(pyString(value(t)));
        return m
          ? [
              {
                name: `motion/${slug(t.name)}`,
                type: 'FLOAT' as const,
                valuesByMode: {
                  Value: Number(m[1]) * (m[2] === 'ms' ? 1 : 1000),
                },
                codeName: codeName(t),
                scopes: [],
                description:
                  'Milliseconds. Figma has no duration scope, so this cannot be bound; it is here so the value has one source.',
              },
            ]
          : [];
      }),
    };
  for (const family of ['radius', 'font-weight', 'letter-spacing']) {
    const vs = rows.filter((t) => t.family === family);
    if (!vs.length) continue;
    const collection = family
      .split('-')
      .map((s) => s[0]!.toUpperCase() + s.slice(1))
      .join('');
    extra[collection] = {
      modes: ['Value'],
      variables: vs.flatMap((t) => {
        const n = num(value(t));
        return n === null
          ? []
          : [
              {
                name: `${family.split('-')[0]}/${slug(t.name)}`,
                type: 'FLOAT',
                valuesByMode: { Value: n },
                codeName: codeName(t),
                scopes: familyScopes[family] ?? [],
              },
            ];
      }),
    };
  }
  const unknown = rows.filter((t) => t.family === 'unknown').map((t) => t.codeName!);
  if (unknown.length)
    warnings.push({
      kind: 'unclassified-custom-property',
      value: unknown.length,
      detail: unknown.sort().slice(0, 12).join(', '),
    });
  return [
    {
      ...(tokens.source !== undefined ? { source: tokens.source } : {}),
      modes: tokens.modes?.length ? tokens.modes : ['Value'],
      modeRationale: tokens.modeRationale,
      typeScaling: tokens.typeScaling,
      colors,
      fontStacks: stacks,
      scssVariables: scss,
      customStyles: custom,
      _semantic: semantic,
      _extraCollections: extra,
    },
    warnings,
  ];
}
function fromSassSource(tokens: TokenInput): [TokenInput, Warning[]] {
  const [canonical, warnings] = fromCssvars(tokens);
  for (const warning of warnings)
    if (warning.kind === 'unclassified-custom-property') {
      warning.kind = 'unclassified-sass-declaration';
      warning.detail = warning.detail!.replaceAll('--', '$');
    }
  const skipped = (tokens.tokens ?? []).filter((t) => t.layer !== 'base').length;
  if (skipped)
    warnings.unshift({
      kind: 'component-layer-excluded',
      value: skipped,
      detail:
        'component-local Sass declarations remain provenance for components; they are not promoted into the global variable palette',
    });
  canonical.modeRationale =
    'source Sass declares each token once; responsive consumption must be measured rather than copied into invented modes';
  const extra = (canonical._extraCollections ??= {});
  for (const [family, collection, prefix] of [
    ['breakpoint', 'Breakpoints', 'breakpoint'],
    ['container-width', 'ContainerWidths', 'container'],
  ] as const) {
    const variables: Variable[] = (tokens.tokens ?? []).flatMap((t) => {
      const n = num(t.value);
      return t.layer === 'base' && t.family === family && n !== null
        ? [
            {
              name: `${prefix}/${slug(t.name)}`,
              type: 'FLOAT',
              valuesByMode: { Value: n },
              codeName: codeName(t),
              scopes: [],
              description: 'Reference dimension; Figma has no matching bindable scope.',
            },
          ]
        : [];
    });
    if (variables.length) extra[collection] = { modes: ['Value'], variables: uniquify(variables) };
  }
  return [canonical, warnings];
}
function fromSourcemap(tokens: TokenInput): [TokenInput, Warning[]] {
  const rows = tokens.tokens ?? [],
    base = rows.filter((t) => t.layer === 'base'),
    warnings: Warning[] = [];
  if (rows.length - base.length)
    warnings.push({
      kind: 'component-layer-excluded',
      value: rows.length - base.length,
      detail: 'component-local Sass variables are not the palette; see references/tokens-and-variables.md',
    });
  const unknown = base
    .filter((t) => t.family === 'unknown')
    .map((t) => t.name)
    .sort();
  if (unknown.length)
    warnings.push({
      kind: 'unresolved-sass-value',
      value: unknown.length,
      detail: `values the resolver could not reduce to a literal: ${unknown
        .slice(0, 12)
        .map((n) => '$' + n)
        .join(', ')}`,
    });
  warnings.push({
    kind: 'semantic-layer-needs-authoring',
    value: 'Semantic',
    detail:
      'Site Studio colours carry tags that state what they are FOR; a Sass variable carries only a name. The semantic layer for this strategy is a naming decision a human makes, not something extraction can derive.',
  });
  return [
    {
      ...(tokens.source !== undefined ? { source: tokens.source } : {}),
      modes: ['Value'],
      modeRationale:
        'a Sass source map declares each variable once; it carries no breakpoint cascade to build modes from',
      typeScaling: tokens.typeScaling,
      colors: base
        .filter((t) => t.family === 'color')
        .map((t) => ({
          name: t.name,
          hex: t.value ?? null,
          codeName: codeName(t),
          tags: [],
          inUse: true,
          provenance: t.provenance ?? null,
        })),
      fontStacks: base
        .filter((t) => t.family === 'font-family')
        .map((t) => ({
          name: t.name,
          stack: t.value ?? null,
          primaryFamily: primaryFamily(t.value),
          codeName: codeName(t),
          inUse: true,
        })),
      scssVariables: base
        .filter((t) => ['spacing', 'number'].includes(t.family))
        .map((t) => ({
          name: t.name,
          value: t.value ?? null,
          codeName: codeName(t),
        })),
      customStyles: [],
    },
    warnings,
  ];
}
export function normalize(tokens: TokenInput): [TokenInput, Warning[]] {
  if ('modes' in tokens && ['colors', 'fontStacks', 'scssVariables', 'customStyles'].some((k) => k in tokens))
    return [tokens, []];
  if (tokens.source?.strategy === 'sass-sourcemap') return fromSourcemap(tokens);
  if (tokens.source?.strategy === 'sass-source') return fromSassSource(tokens);
  if (tokens.source?.strategy === 'css-custom-properties') return fromCssvars(tokens);
  throw new Error(
    `plan_variables: unrecognised tokens.json schema (source.strategy=${JSON.stringify(tokens.source?.strategy ?? null)}). Expected the canonical shape (modes + colors/fontStacks/scssVariables/customStyles) or a strategy with a normaliser. Add one rather than defaulting keys - a partial read reports success while discarding every token.`,
  );
}
function groups(rows: CustomStyle[], order: string[]): [unknown[], CustomStyle[]][] {
  const map = new Map<string, { values: unknown[]; rows: CustomStyle[] }>();
  for (const row of rows) {
    const values = order.map((b) => row.valuesByBreakpoint[b] ?? null);
    if (values.every((v) => num(v) === null)) continue;
    const key = JSON.stringify(values);
    if (!map.has(key)) map.set(key, { values, rows: [] });
    map.get(key)!.rows.push(row);
  }
  return [...map.values()].map((g) => [g.values, g.rows]);
}
export function build(input: TokenInput): VariablePlan {
  const [tokens, prewarnings] = normalize(input),
    order = tokens.modes!;
  const out: VariablePlan = {
    modes: order,
    collections: {},
    warnings: [...prewarnings],
  };
  const prims: Variable[] = [];
  for (const color of tokens.colors ?? []) {
    if (!color.hex) {
      out.warnings.push({
        kind: 'colour-without-hex',
        value: color.name ?? null,
      });
      continue;
    }
    prims.push({
      name: `color/${slug(color.name)}`,
      type: 'COLOR',
      hex: color.hex,
      codeName: color.codeName ?? null,
      tags: color.tags ?? [],
      inUse: color.inUse ?? true,
      scopes: [],
    });
  }
  out.collections['Primitives'] = {
    modes: ['Value'],
    variables: uniquify(prims),
  };
  const sem: Variable[] = [];
  const rules: [string, string[]][] = [
    ['surface/brand', ['brand', 'background']],
    ['surface/dark', ['dark', 'background']],
    ['surface/light', ['light', 'background']],
    ['text/default', ['text', 'dark']],
    ['text/on-dark', ['text', 'light']],
  ];
  if (prims.some((p) => p.tags?.length))
    for (const [name, tags] of rules) {
      const hit = prims.find((p) => p.inUse && tags.every((t) => p.tags?.includes(t)));
      if (hit)
        sem.push({
          name,
          type: 'COLOR',
          aliasOf: hit.name,
          ...(hit.hex !== undefined ? { hex: hit.hex } : {}),
          ...(hit.codeName !== undefined ? { codeName: hit.codeName } : {}),
          scopes: name.startsWith('text/') ? ['TEXT_FILL'] : ['FRAME_FILL', 'SHAPE_FILL'],
        });
      else
        out.warnings.push({
          kind: 'no-semantic-candidate',
          value: name,
          detail: 'no in-use palette colour carries the required tags',
        });
    }
  out.collections['Semantic'] = {
    modes: ['Value'],
    variables: uniquify(tokens._semantic?.length ? tokens._semantic : sem),
  };
  const fams: Variable[] = (tokens.fontStacks ?? []).flatMap((f) =>
    f.primaryFamily
      ? [
          {
            name: `type/family/${slug(f.name)}`,
            type: 'STRING',
            valuesByMode: { Value: f.primaryFamily },
            codeName: f.codeName ?? null,
            stack: f.stack ?? null,
            inUse: f.inUse ?? true,
            scopes: ['FONT_FAMILY'],
          },
        ]
      : [],
  );
  const space: Variable[] = (tokens.scssVariables ?? []).flatMap((v) => {
    const n = num(v.value);
    return n === null
      ? []
      : [
          {
            name: `space/${slug(v.name)}`,
            type: 'FLOAT',
            valuesByMode: Object.fromEntries(order.map((b) => [b, n])),
            codeName: v.codeName ?? null,
            scopes: ['GAP', 'WIDTH_HEIGHT'],
            scales: false,
          },
        ];
  });
  for (const [values, rows] of groups(
    (tokens.customStyles ?? []).filter((r) => r.family === 'spacing'),
    order,
  )) {
    const pref = rows.filter((r) => /padding|margin|spacing|gap/.test(slug(r.codeName || ''))),
      selected = pref.length ? pref : rows,
      numbers = values.map(num);
    space.push({
      name: `space/${slug(shortest(selected, (r) => r.name).name)}`,
      type: 'FLOAT',
      valuesByMode: Object.fromEntries(order.flatMap((b, i) => (numbers[i] === null ? [] : [[b, numbers[i]!]]))),
      codeName: firstCode(selected),
      scopes: ['GAP', 'WIDTH_HEIGHT'],
      scales: new Set(numbers.filter((n) => n !== null)).size > 1,
    });
  }
  out.collections['Spacing'] = { modes: order, variables: uniquify(space) };
  const tv = [...fams];
  for (const [prop, prefix, scopes] of [
    ['font-size', 'type/size', ['FONT_SIZE']],
    ['line-height', 'type/leading', ['LINE_HEIGHT']],
  ] as const)
    for (const [values, rows] of groups(
      (tokens.customStyles ?? []).filter((r) => r.property === prop),
      order,
    )) {
      const nums = values.map(num),
        declared = nums.filter((n): n is number => n !== null),
        ratio = prop === 'line-height' && !!declared.length && Math.max(...declared) < 4;
      tv.push({
        name: `${ratio ? 'type/leading-ratio' : prefix}/${slug(shortest(rows, (r) => r.name).name)}`,
        type: 'FLOAT',
        valuesByMode: Object.fromEntries(order.flatMap((b, i) => (nums[i] === null ? [] : [[b, nums[i]!]]))),
        codeName: firstCode(rows),
        scopes: ratio ? [] : [...scopes],
        unitlessRatio: ratio,
        scales: new Set(declared).size > 1,
      });
    }
  const anyScale = tv.some((v) => v.scales);
  out.collections['Type'] = {
    modes: anyScale ? order : ['Value'],
    modeRationale: anyScale
      ? 'at least one type role scales across breakpoints'
      : 'no type role scales; one mode is correct',
    variables: uniquify(tv),
  };
  Object.assign(out.collections, tokens._extraCollections ?? {});
  consolidateSingleModeCollections(out);
  return out;
}
const groupPrefix: Record<string, [string, string | null]> = {
  Primitives: ['Color/Primitive', 'color'],
  Semantic: ['Color/Semantic', null],
  Spacing: ['Spacing', 'space'],
  Type: ['Typography', 'type'],
  Radius: ['Shape/Radius', 'radius'],
  FontWeight: ['Typography/Weight', 'font'],
  LetterSpacing: ['Typography/Tracking', 'letter'],
  Breakpoints: ['Layout/Breakpoint', 'breakpoint'],
  ContainerWidths: ['Layout/Container', 'container'],
  LeadingRatio: ['Typography/Leading Ratio', 'leading'],
  Motion: ['Motion', 'motion'],
};
export function consolidateSingleModeCollections(out: VariablePlan): void {
  const collections = out.collections;
  for (const collection of Object.values(collections)) {
    if (
      collection.modes.length < 2 ||
      collection.variables.some(
        (v) => new Set(Object.values(v.valuesByMode ?? {}).map((x) => JSON.stringify(sorted(x)))).size > 1,
      )
    )
      continue;
    collection.modes = ['Value'];
    for (const variable of collection.variables)
      if (Object.keys(variable.valuesByMode ?? {}).length)
        variable.valuesByMode = {
          Value: Object.values(variable.valuesByMode!)[0]!,
        };
  }
  if (Object.keys(collections).length <= 1) {
    out.collectionStrategy = {
      kind: 'grouped-single-collection',
      reason: 'one collection is sufficient',
    };
    return;
  }
  const singleNames = Object.keys(collections).filter(
    (name) => JSON.stringify(collections[name]!.modes) === '["Value"]',
  );
  if (singleNames.length < 2) {
    out.collectionStrategy = {
      kind: 'mode-boundaries',
      reason: 'no two collections share the same mode set for safe consolidation',
    };
    return;
  }
  const renamed = new Map<string, string>(),
    rows: Variable[] = [];
  for (const name of singleNames) {
    const [prefix, strip] = groupPrefix[name] ?? [name, null];
    for (const variable of collections[name]!.variables) {
      const old = variable.name,
        leaf = strip && old.startsWith(strip + '/') ? old.slice(strip.length + 1) : old,
        newName = prefix + (leaf ? '/' + leaf : '');
      renamed.set(old, newName);
      rows.push({ ...variable, name: newName, sourceCollection: name });
    }
  }
  for (const variable of rows)
    if (variable.aliasOf && renamed.has(variable.aliasOf)) variable.aliasOf = renamed.get(variable.aliasOf)!;
  const retained = Object.fromEntries(Object.entries(collections).filter(([name]) => !singleNames.includes(name)));
  let core = 'Core';
  while (core in retained) core += ' Invariant';
  out.collections = {
    [core]: {
      modes: ['Value'],
      variables: uniquify(rows),
      modeRationale:
        'single-mode source domains share one publication lifecycle; slash-separated names provide Figma groups',
    },
    ...retained,
  };
  out.collectionStrategy = {
    kind: Object.keys(retained).length ? 'grouped-by-mode-boundary' : 'grouped-single-collection',
    reason: 'single-mode domains use slash-name groups; collections with different responsive modes remain separate',
    sourceCollections: Object.keys(collections),
    retainedModeCollections: Object.keys(retained),
  };
}
