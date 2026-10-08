import { required } from '../lookup.ts';
// The baseline's browser scripts, frozen. They are used ONLY to rebuild the setup text that
// legacyHash hashed, so capture records stored before setupKey existed stay valid. The scripts the
// browser runs are the typed functions in twig-scripts.ts.
export const _REVEAL_JS =
  "\n  const reveal = (el) => {\n    let shown = 0;\n    for (let a = el; a && a !== document.body; a = a.parentElement) {\n      if (a.hidden) { a.hidden = false; shown++; }\n      if (getComputedStyle(a).display === 'none') {\n        a.style.setProperty('display', 'block', 'important'); shown++;\n      }\n      if (shown) a.setAttribute('data-design-lab-revealed', '');\n    }\n    return shown;\n  };\n";
export const _TAG_JS =
  "\n(() => {\n  const id = %(id)s, hook = %(hook)s, wanted = %(wanted)s, attr = %(attr)s, mayReveal = %(reveal_on)s;\n  const SKIP = new Set(['STYLE', 'SCRIPT', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);\n  %(reveal)s\n  // The first element each render of the bundle printed: generic wrappers print none of\n  // their own, and an embedded block can lead with a <style> or <script>.\n  const roots = [];\n  const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);\n  let currentHook = null, names = [];\n  for (let c = walker.nextNode(); c; c = walker.nextNode()) {\n    const text = c.nodeValue;\n    const h = text.match(/^ THEME HOOK: '([\\w-]+)' $/);\n    if (h) { currentHook = h[1]; names = []; continue; }\n    if (text.startsWith(' FILE NAME SUGGESTIONS:')) {\n      names = text.match(/[\\w-]+\\.html\\.twig/g) || []; continue;\n    }\n    if (/BEGIN .*OUTPUT from '/.test(text)) {\n      if (currentHook === hook && names.includes(wanted)) {\n        const printed = [];\n        for (let n = c.nextSibling; n; n = n.nextSibling) {\n          if (n.nodeType === Node.COMMENT_NODE && /END .*OUTPUT from '/.test(n.nodeValue)) break;\n          if (n.nodeType === Node.ELEMENT_NODE && !SKIP.has(n.tagName)) printed.push(n);\n        }\n        if (printed.length) roots.push(printed);\n      }\n      currentHook = null; names = [];\n    }\n  }\n  const drawn = (n) => { const box = n.getBoundingClientRect(); return box.width > 0 && box.height > 0; };\n  let tagged = 0, revealed = 0;\n  for (const printed of roots) {\n    const first = printed.find(drawn);\n    if (first) { first.setAttribute(attr, id); tagged++; }\n  }\n  if (!tagged && roots.length && mayReveal) {\n    revealed = reveal(roots[0][0]);\n    const first = roots[0].find(drawn);\n    if (first) { first.setAttribute(attr, id); tagged++; }\n  }\n  return { tagged, revealed };\n})()\n";
export const _SELECTOR_REVEAL_JS =
  '\n(() => {\n  const all = [...document.querySelectorAll(%(selector)s)];\n  %(reveal)s\n  if (!all.length || all.some((el) => el.getBoundingClientRect().height > 4)) {\n    return { revealed: 0 };\n  }\n  return { revealed: reveal(all[0]) };\n})()\n';

import { suggestion } from './twig.ts';
function format(source: string, values: Record<string, string>): string {
  return source.replace(/%\((\w+)\)s/g, (_, key: string) => required(values[key], `placeholder ${key}`));
}
function legacyTagScript(id: string, attribute: string, reveal: boolean): string {
  const [hook, wanted] = suggestion(id);
  return format(_TAG_JS, {
    id: JSON.stringify(id),
    hook: JSON.stringify(hook),
    wanted: JSON.stringify(wanted),
    attr: JSON.stringify(attribute),
    reveal: _REVEAL_JS,
    reveal_on: String(reveal),
  });
}
function legacyRevealScript(selector: string): string {
  return format(_SELECTOR_REVEAL_JS, { selector: JSON.stringify(selector), reveal: _REVEAL_JS });
}
/** The setup text the baseline scaffold wrote for a component: its own marker or reveal, then its children's markers. */
export function legacyOwnScript(id: string, own: 'template' | 'reveal', selector: string, children: string[]): string {
  const text = own === 'template' ? legacyTagScript(id, 'data-design-lab-root', true) : legacyRevealScript(selector);
  const script = children
    .filter((child) => child.includes(':') && !child.startsWith('sdc.'))
    .map((child) => legacyTagScript(child, 'data-design-lab-child', false).trim() + ';\n')
    .join('');
  return script ? '(() => { const own = ' + text.trim() + '; ' + script + ' return own; })()' : '(' + text.trim() + ')';
}
