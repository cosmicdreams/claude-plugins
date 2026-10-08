// Browser scripts, written as typed functions. Each runs in the page, so it may use nothing from this
// module: the arguments carry every value, and `inject` sends the function's own source (Node has
// stripped its types by then) the way browser.ts sends `walk`. The baseline's script text survives
// only in twig-legacy.ts, to rebuild the setup text that old capture records were hashed from.
export interface TagArgs { id: string; hook: string; wanted: string; attr: string; mayReveal: boolean }
export type Reveal = (el: HTMLElement) => number;

/** Show every hidden ancestor of `el` and mark it; returns how many were shown. */
export function revealElement(el: HTMLElement): number {
  let shown = 0;
  for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
    if (a.hidden) { a.hidden = false; shown++; }
    if (getComputedStyle(a).display === 'none') {
      a.style.setProperty('display', 'block', 'important'); shown++;
    }
    if (shown) a.setAttribute('data-design-lab-revealed', '');
  }
  return shown;
}

/** Tag the first drawn element each Twig render of the bundle printed; reveal the first render when none is drawn. */
export function tagRenders({ id, hook, wanted, attr, mayReveal }: TagArgs, reveal: Reveal): { tagged: number; revealed: number } {
  const SKIP = new Set(['STYLE', 'SCRIPT', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);
  // The first element each render of the bundle printed: generic wrappers print none of
  // their own, and an embedded block can lead with a <style> or <script>.
  const roots: HTMLElement[][] = [];
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  let currentHook: string | null = null, names: string[] = [];
  for (let c = walker.nextNode(); c; c = walker.nextNode()) {
    const text = c.nodeValue ?? '';
    const h = text.match(/^ THEME HOOK: '([\w-]+)' $/);
    if (h) { currentHook = h[1] ?? null; names = []; continue; }
    if (text.startsWith(' FILE NAME SUGGESTIONS:')) {
      names = text.match(/[\w-]+\.html\.twig/g) || []; continue;
    }
    if (/BEGIN .*OUTPUT from '/.test(text)) {
      if (currentHook === hook && names.includes(wanted)) {
        const printed: HTMLElement[] = [];
        for (let n = c.nextSibling; n; n = n.nextSibling) {
          if (n.nodeType === Node.COMMENT_NODE && /END .*OUTPUT from '/.test(n.nodeValue ?? '')) break;
          if (n.nodeType === Node.ELEMENT_NODE && !SKIP.has((n as Element).tagName)) printed.push(n as HTMLElement);
        }
        if (printed.length) roots.push(printed);
      }
      currentHook = null; names = [];
    }
  }
  const drawn = (n: HTMLElement): boolean => { const box = n.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  let tagged = 0, revealed = 0;
  for (const printed of roots) {
    const first = printed.find(drawn);
    if (first) { first.setAttribute(attr, id); tagged++; }
  }
  const lead = roots[0];
  if (!tagged && lead && mayReveal) {
    revealed = reveal(lead[0] as HTMLElement);
    const first = lead.find(drawn);
    if (first) { first.setAttribute(attr, id); tagged++; }
  }
  return { tagged, revealed };
}

/** Reveal the first match of `selector` when none of the matches has any height. */
export function revealMatches(selector: string, reveal: Reveal): { revealed: number } {
  const all = [...document.querySelectorAll<HTMLElement>(selector)];
  if (!all.length || all.some((el) => el.getBoundingClientRect().height > 4)) {
    return { revealed: 0 };
  }
  return { revealed: reveal(all[0] as HTMLElement) };
}

/** An expression that calls `fn` in the page with JSON arguments and the reveal helper. */
export function inject(fn: (...args: never[]) => unknown, ...args: unknown[]): string {
  return `(${fn.toString()})(${[...args.map(a => JSON.stringify(a)), `${revealElement.toString()}`].join(', ')})`;
}
