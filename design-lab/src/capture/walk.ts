import type { MeasuredNode } from '../generated/spec.ts';
import type { Measurement, PickRoot } from './types.ts';
export const PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'boxSizing', 'overflow',
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
  /* An icon drawn as a mask over its background colour (`mask-image: url(arrow.svg)`). */
  'maskImage',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomLeftRadius', 'borderBottomRightRadius',
  'boxShadow', 'opacity', 'transform', 'transition', 'zIndex',
  'listStyleType', 'objectFit', 'objectPosition', 'aspectRatio', 'visibility', 'clip', 'clipPath', 'whiteSpace',
];

/* Runs inside the page. Walks the component subtree and records every node. */
export function walk(rootSelector: string, propList: string[], pick_: PickRoot): Measurement {
  const { anchorText, mustContain, nth } = pick_ || {};
  const root = (() => {
    /* Several pages hold both empty and populated instances of the same
       component, and several components share a root class. Filter by real
       height first, then by the disambiguators the config supplies. */
    let candidates = [...document.querySelectorAll(rootSelector)]
      .filter((el) => el.getBoundingClientRect().height > 4);
    if (anchorText) candidates = candidates.filter((el) => (el.textContent ?? "").includes(anchorText));
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
  const pick = (style: CSSStyleDeclaration): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const p of propList) out[p] = style.getPropertyValue(
      p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
    );
    return out;
  };
  const pseudo = (el: Element, which: string) => {
    const s = getComputedStyle(el, which);
    if (s.content === 'none' || s.content === 'normal') return null;
    const p = pick(s);
    p['content'] = s.content;
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
  const declaredFor = (el: Element) => {
    const out: Record<string, string | boolean> = {};
    const take = (decl: CSSStyleDeclaration) => {
      for (const p of TOKEN_PROPS) {
        const v = decl.getPropertyValue(p);
        if (v) out[p] = v.trim();
      }
    };
    const scan = (rules: CSSRuleList, depth: number) => {
      if (depth > 4) return;
      for (const baseRule of rules) {
        const rule = baseRule as CSSRule & {selectorText?: string; cssRules?: CSSRuleList; conditionText?: string; style?: CSSStyleDeclaration; styleSheet?: CSSStyleSheet; media?: MediaList};
        if (rule.type === CSSRule.MEDIA_RULE || rule.conditionText !== undefined) {
          let applies = true;
          try { applies = !rule.conditionText || matchMedia(rule.conditionText).matches; }
          catch { applies = false; }
          if (applies && rule.cssRules) scan(rule.cssRules, depth + 1);
          continue;
        }
        /* @layer blocks (and other unconditional groups) hold ordinary rules; a theme that
           layers everything otherwise reads as declaring nothing. @import carries a sheet. */
        if (!rule.selectorText && rule.cssRules) { scan(rule.cssRules, depth + 1); continue; }
        if (rule.styleSheet) {
          /* `@import url(x) print` applies only where its media list matches. */
          const media = rule.media && rule.media.mediaText;
          let applies = true;
          try { applies = !media || matchMedia(media).matches; } catch { applies = false; }
          if (applies) {
            try { scan(rule.styleSheet.cssRules, depth + 1); } catch { out['__unreadableSheet'] = true; }
          }
          continue;
        }
        if (!rule.selectorText) continue;
        let hit = false;
        try { hit = el.matches(rule.selectorText); } catch { hit = false; }
        if (hit) take(rule.style!);
      }
    };
    for (const sheet of document.styleSheets) {
      /* Cross-origin sheets throw on .cssRules. A stylesheet we cannot read is a gap in the
         answer, so record it rather than silently returning fewer declarations. */
      let rules = null;
      try { rules = sheet.cssRules; } catch { out['__unreadableSheet'] = true; continue; }
      if (rules) scan(rules, 0);
    }
    if ((el as HTMLElement).style && (el as HTMLElement).style.length) take((el as HTMLElement).style);
    return out;
  };

  const nodes: MeasuredNode[] = [];
  let counter = 0;
  const visit = (el: Element, parentPath: string): void => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const path = `${parentPath}/${el.tagName.toLowerCase()}[${counter++}]`;

    /* Direct text content only — text owned by a child belongs to the child. */
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => (n.textContent ?? "").trim())
      .filter(Boolean)
      .join(' ');

    nodes.push({
      path,
      tag: el.tagName.toLowerCase(),
      classes: [...el.classList],
      id: el.id || null,
      attributes: Object.fromEntries(
        [...el.attributes]
          .filter((a) => a.name.startsWith('aria-') || ['role', 'type', 'href', 'src', 'alt', 'for',
            'data-design-lab-child', 'data-component-id'].includes(a.name))
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
      /* An inline SVG is imported whole as vectors, so its markup is the measurement. */
      /* The browser's own answer to "can a sighted visitor see this?": false inside a closed
         <details>, under content-visibility, display:none, visibility:hidden or opacity 0. */
      rendered: typeof el.checkVisibility === 'function'
        ? el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })
        : null,
      svg: el.tagName.toLowerCase() === 'svg' ? el.outerHTML : null,
      /* The file the browser actually chose from srcset, so the Figma fill is the same image. */
      image: el.tagName.toLowerCase() === 'img'
        ? { src: (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src, naturalWidth: (el as HTMLImageElement).naturalWidth, naturalHeight: (el as HTMLImageElement).naturalHeight }
        : null,
      /* Text interleaved with element children (a link inside a sentence) cannot be split
         into sibling text layers without losing the sentence, so the whole run is kept. */
      inlineText: [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim())
        && [...el.children].length > 0
        ? (el as HTMLElement).innerText.trim()
        : null,
    });

    if (el.tagName.toLowerCase() === 'svg') return;
    for (const child of el.children) visit(child, path);
  };
  visit(root, '');

  return {
    rootBox: { width: +rootBox.width.toFixed(2), height: +rootBox.height.toFixed(2) },
    /* What shows through where the component is transparent: the nearest ancestor with a
       background colour (the page, usually), else the canvas. The live capture includes it, so
       the documentation specimen paints it behind the master; the master stays transparent. */
    backdrop: (() => {
      for (let a = root.parentElement; a; a = a.parentElement) {
        const bg = getComputedStyle(a).backgroundColor;
        if (bg && !/^rgba\(.*,\s*0\)$/.test(bg) && bg !== 'transparent') return bg;
      }
      return 'rgb(255, 255, 255)';
    })(),
    nodes,
  };
}
