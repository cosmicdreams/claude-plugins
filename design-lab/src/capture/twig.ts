import { inject, tagRenders, revealMatches } from './twig-scripts.ts';
export function enabled(html: string): boolean {
  return html.includes('<!-- THEME DEBUG -->') || /<!-- [^\n]*BEGIN [^\n]*OUTPUT from '[^']+' -->/.test(html);
}
export function suggestion(id: string): [string, string] {
  const colon = id.indexOf(':');
  return colon < 0
    ? [`component__cohesion_${id}`, `component--cohesion-${id.replaceAll('_', '-')}.html.twig`]
    : [id.slice(0, colon), `${id.slice(0, colon)}--${id.slice(colon + 1).replaceAll('_', '-')}.html.twig`];
}
export function count(html: string, id: string): number {
  const [kind, wanted] = suggestion(id);
  let total = 0;
  for (const hook of html.matchAll(/<!-- THEME HOOK: '([\w-]+)' -->/g)) {
    if (hook[1] !== kind) continue;
    const rest = html.slice(hook.index + hook[0].length, hook.index + hook[0].length + 4000);
    const names = /^<!-- FILE NAME SUGGESTIONS:([\s\S]*?)-->/.exec(rest.trimStart());
    if (
      names &&
      /<!-- [^\n]*BEGIN [^\n]*OUTPUT from '[^']+' -->/.test(rest) &&
      Array.from(names[1]!.match(/[\w-]+\.html\.twig/g) ?? []).includes(wanted)
    )
      total++;
  }
  return total;
}
export function rendersWithin(html: string, parent: string, children: string[]) {
  const targets = Object.fromEntries([parent, ...children].map((id) => [id, suggestion(id)]));
  const counts = Object.fromEntries(children.map((id) => [id, 0]));
  const stack: Set<string>[] = [];
  let parentRenders = 0,
    hook: string | undefined,
    names: string[] = [];
  for (const match of html.matchAll(
    /<!-- THEME HOOK: '([\w-]+)' -->|<!-- FILE NAME SUGGESTIONS:([\s\S]*?)-->|<!-- [^\n]*(BEGIN|END) [^\n]*OUTPUT from '([^']+)' -->/g,
  )) {
    if (match[1]) {
      hook = match[1];
      names = [];
    } else if (match[2] !== undefined) names = match[2].match(/[\w-]+\.html\.twig/g) ?? [];
    else if (match[3] === 'BEGIN') {
      const mine = new Set(
        Object.entries(targets)
          .filter(([, [kind, wanted]]) => kind === hook && names.includes(wanted))
          .map(([id]) => id),
      );
      if (mine.has(parent)) parentRenders++;
      if (stack.some((frame) => frame.has(parent)))
        for (const id of mine) if (id !== parent) counts[id] = (counts[id] ?? 0) + 1;
      stack.push(mine);
      hook = undefined;
      names = [];
    } else if (match[3] === 'END') stack.pop();
  }
  return { parentRenders, children: counts };
}
export function tagScript(id: string, attribute = 'data-design-lab-root', reveal = true): string {
  const [hook, wanted] = suggestion(id);
  return inject(tagRenders, { id, hook, wanted, attr: attribute, mayReveal: reveal });
}
export function childTagScripts(ids: string[]): string {
  return ids
    .filter((id) => id.includes(':') && !id.startsWith('sdc.'))
    .map((id) => tagScript(id, 'data-design-lab-child', false).trim() + ';\n')
    .join('');
}
export function revealScript(selector: string): string {
  return inject(revealMatches, selector);
}
export function rootSelector(id: string): string {
  return `[data-design-lab-root="${id}"]`;
}
