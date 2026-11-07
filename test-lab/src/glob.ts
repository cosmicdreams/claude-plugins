// A small glob matcher for profile paths: `**` crosses folders, `*` and `?` stay within one, and `{a,b}`
// picks one alternative. Paths use forward slashes and are relative to the folder the glob is written for.

const cache = new Map<string, RegExp>();

function toRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) throw new Error(`unclosed { in glob ${glob}`);
      out += `(?:${glob.slice(i + 1, end).split(',').map(escape).join('|')})`;
      i = end;
    } else out += escape(c);
  }
  return new RegExp(`^${out}$`);
}

function escape(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function matchesGlob(path: string, glob: string): boolean {
  let re = cache.get(glob);
  if (re === undefined) {
    re = toRegExp(glob);
    cache.set(glob, re);
  }
  return re.test(path.replace(/\\/g, '/').replace(/^\.\//, ''));
}
