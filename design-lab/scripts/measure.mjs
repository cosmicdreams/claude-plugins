/**
 * Component specification extractor.
 *
 * Renders a component on the local site and emits a machine-readable JSON
 * specification — box model, typography, fills, borders, pseudo-elements —
 * for every node in the component subtree, at every requested viewport width
 * and in every requested interaction state.
 *
 * The output is the handoff artifact consumed by the Figma build step. It is
 * deliberately free of screenshots: everything here can become a native Figma
 * node with bound variables.
 *
 * Usage:
 *   node extract.mjs --config components/<name>.json [--out ../../reports/figma-spec]
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
};

const configPath = resolve(arg('--config'));
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const outDir = resolve(arg('--out', new URL('../../reports/figma-spec', import.meta.url).pathname));

const VIEWPORTS = config.viewports ?? [
  { name: 'desktop', width: 1400, height: 1200 },
  { name: 'tablet', width: 800, height: 1200 },
  { name: 'mobile', width: 375, height: 1200 },
];

/* Properties worth carrying into Figma. Anything not here has no Figma analogue
   or is always inherited from a parent that already records it. */
const PROPS = [
  'display', 'position', 'boxSizing', 'overflow',
  'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf',
  'gap', 'rowGap', 'columnGap', 'flexGrow', 'flexShrink', 'flexBasis',
  'gridTemplateColumns', 'gridTemplateRows',
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'textAlign', 'textTransform', 'textDecorationLine',
  'color', 'backgroundColor', 'backgroundImage', 'backgroundSize',
  'backgroundPosition', 'backgroundRepeat',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomLeftRadius', 'borderBottomRightRadius',
  'boxShadow', 'opacity', 'transform', 'transition', 'zIndex',
  'listStyleType', 'objectFit', 'aspectRatio', 'visibility',
];

/* Runs inside the page. Walks the component subtree and records every node. */
function walk(rootSelector, propList, pick_) {
  const { anchorText, mustContain, nth } = pick_ || {};
  const root = (() => {
    /* Several pages hold both empty and populated instances of the same
       component, and several components share a root class. Filter by real
       height first, then by the disambiguators the config supplies. */
    let candidates = [...document.querySelectorAll(rootSelector)]
      .filter((el) => el.getBoundingClientRect().height > 4);
    if (anchorText) candidates = candidates.filter((el) => el.textContent.includes(anchorText));
    if (mustContain) candidates = candidates.filter((el) => el.querySelector(mustContain));
    return candidates[nth ?? 0] ?? null;
  })();
  if (!root) {
    return {
      error: `no element matched ${rootSelector}`,
      totalMatches: document.querySelectorAll(rootSelector).length,
    };
  }

  const rootBox = root.getBoundingClientRect();
  const pick = (style) => {
    const out = {};
    for (const p of propList) out[p] = style.getPropertyValue(
      p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
    );
    return out;
  };
  const pseudo = (el, which) => {
    const s = getComputedStyle(el, which);
    if (s.content === 'none' || s.content === 'normal') return null;
    const p = pick(s);
    p.content = s.content;
    return p;
  };

  /* The properties that map to a Figma variable. Only these need a declared value; the
     rest are geometry that no token governs. */
  const TOKEN_PROPS = [
    'color', 'background-color', 'font-size', 'line-height', 'font-family', 'font-weight',
    'letter-spacing', 'gap', 'row-gap', 'column-gap',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-left-radius', 'border-bottom-right-radius',
  ];

  /* getComputedStyle resolves var(--bs-purple) and #342649 to the same rgb() string, so a
     computed value cannot tell a token from a literal. The library has to mirror what the
     code actually declares — see references/library-standard.md section 1 — so read the raw
     declaration off the matching rules instead.

     Cascade order is approximated by document order plus matching media queries, NOT by
     specificity. That is good enough for the only question asked of it — does the code
     reference a custom property for this property, and which one — and it is stated here
     rather than implied, because a later low-specificity rule can win in this model and
     lose in the browser. Inline style always wins, which is exact. */
  const declaredFor = (el) => {
    const out = {};
    const take = (decl) => {
      for (const p of TOKEN_PROPS) {
        const v = decl.getPropertyValue(p);
        if (v) out[p] = v.trim();
      }
    };
    const scan = (rules, depth) => {
      if (depth > 4) return;
      for (const rule of rules) {
        if (rule.type === CSSRule.MEDIA_RULE || rule.conditionText !== undefined) {
          let applies = true;
          try { applies = !rule.conditionText || matchMedia(rule.conditionText).matches; }
          catch { applies = false; }
          if (applies && rule.cssRules) scan(rule.cssRules, depth + 1);
          continue;
        }
        if (!rule.selectorText) continue;
        let hit = false;
        try { hit = el.matches(rule.selectorText); } catch { hit = false; }
        if (hit) take(rule.style);
      }
    };
    for (const sheet of document.styleSheets) {
      /* Cross-origin sheets throw on .cssRules. A stylesheet we cannot read is a gap in the
         answer, so record it rather than silently returning fewer declarations. */
      let rules = null;
      try { rules = sheet.cssRules; } catch { out['__unreadableSheet'] = true; continue; }
      if (rules) scan(rules, 0);
    }
    if (el.style && el.style.length) take(el.style);
    return out;
  };

  const nodes = [];
  let counter = 0;
  const visit = (el, parentPath) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const path = `${parentPath}/${el.tagName.toLowerCase()}[${counter++}]`;

    /* Direct text content only — text owned by a child belongs to the child. */
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent.trim())
      .filter(Boolean)
      .join(' ');

    nodes.push({
      path,
      tag: el.tagName.toLowerCase(),
      classes: [...el.classList],
      id: el.id || null,
      attributes: Object.fromEntries(
        [...el.attributes]
          .filter((a) => a.name.startsWith('aria-') || ['role', 'type', 'href', 'src', 'alt', 'for'].includes(a.name))
          .map((a) => [a.name, a.value])
      ),
      text: ownText || null,
      /* Coordinates relative to the component root, which is what Figma wants. */
      box: {
        x: +(box.x - rootBox.x).toFixed(2),
        y: +(box.y - rootBox.y).toFixed(2),
        width: +box.width.toFixed(2),
        height: +box.height.toFixed(2),
      },
      computed: pick(style),
      /* What the code declares, not what the browser resolved. A value containing var()
         means the source binds a token and the Figma node must bind the matching variable;
         anything else means the source hardcodes and the Figma node must hardcode too. */
      declared: declaredFor(el),
      before: pseudo(el, '::before'),
      after: pseudo(el, '::after'),
    });

    for (const child of el.children) visit(child, path);
  };
  visit(root, '');

  return {
    rootBox: { width: +rootBox.width.toFixed(2), height: +rootBox.height.toFixed(2) },
    nodes,
  };
}

const browser = await chromium.launch();
const spec = {
  component: config.component,
  machineName: config.machineName ?? null,
  source: config.source ?? null,
  url: config.url,
  rootSelector: config.rootSelector,
  extractedAt: new Date().toISOString(),
  measurements: {},
};

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    ignoreHTTPSErrors: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(config.url, { waitUntil: 'load', timeout: 60000 });
  /* Some pages hold a long-lived connection open, so networkidle never fires.
     Wait for fonts and a short settle instead. */
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);

  for (const state of config.states ?? [{ name: 'default' }]) {
    if (state.setup) await page.evaluate(state.setup);
    if (state.hover) await page.hover(state.hover);
    /* Let transitions settle before measuring. */
    await page.waitForTimeout(state.settle ?? 500);

    /* The walker is stringified and rebuilt inside the page, which keeps it
       readable here as a normal function instead of an inline template. */
    const result = await page.evaluate(
      ({ src, sel, props, pick_ }) => new Function(`return (${src})`)()(sel, props, pick_),
      {
        src: walk.toString(),
        sel: config.rootSelector,
        props: PROPS,
        pick_: { anchorText: config.anchorText, mustContain: config.mustContain, nth: config.nth },
      }
    );

    spec.measurements[`${vp.name}:${state.name}`] = result;
    if (state.teardown) await page.evaluate(state.teardown);
  }
  await context.close();
}

await browser.close();

mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, `${config.machineName ?? config.component}.spec.json`);
writeFileSync(outPath, JSON.stringify(spec, null, 2));

const total = Object.entries(spec.measurements)
  .map(([k, v]) => `${k}=${v.nodes?.length ?? 'ERROR'}`)
  .join('  ');
console.log(`wrote ${outPath}\nnodes per measurement: ${total}`);
