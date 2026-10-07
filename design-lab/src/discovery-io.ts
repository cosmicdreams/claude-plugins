import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative as rel, resolve, sep } from "node:path";
import { sharedRequire } from "./runtime.ts";

export type Dict = Record<string, any>;
export const yaml = sharedRequire()("yaml") as {
  parse(text: string, options?: unknown): unknown;
};
export function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
export function relative(root: string, path: string): string {
  return rel(root, path).split(sep).join("/");
}
export function walk(
  root: string,
  options: { skip?: RegExp; maxDepth?: number; followSymlinks?: boolean } = {},
): string[] {
  const out: string[] = [],
    base = resolve(root),
    skip =
      options.skip ??
      /(^|\/)(node_modules|vendor|\.git|\.design-lab|contrib|core)(\/|$)/,
    visited = new Set<string>();
  const visit = (dir: string) => {
    if (skip.test(dir.replaceAll(sep, "/"))) return;
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const path = join(dir, ent.name);
      try {
        if (ent.isDirectory()) visit(path);
        else if (ent.isFile()) out.push(path);
        else if (ent.isSymbolicLink() && options.followSymlinks) {
          const st = statSync(path);
          if (st.isDirectory()) visit(path);
          else if (st.isFile()) out.push(path);
        }
      } catch {
        /* inaccessible source is omitted */
      }
    }
  };
  void options.maxDepth;
  visit(base);
  return out.sort();
}
export function loadYaml(path: string): any {
  const text = readText(path);
  if (!text) return null;
  return yaml.parse(text, {
    schema: "yaml-1.1",
    prettyErrors: false,
    uniqueKeys: false,
  });
}
export function docroot(root: string): string {
  for (const cand of ["docroot", "web", ""]) {
    const p = cand ? join(root, cand) : root;
    if (
      ["modules", "themes"].some((x) => {
        try {
          return statSync(join(p, x)).isDirectory();
        } catch {
          return false;
        }
      })
    )
      return p;
  }
  return root;
}
export function configDirs(
  root: string,
): Array<{ path: string; entityCount: number }> {
  return ["config/sync", "config/default", "config"].flatMap((c) => {
    const p = join(root, c);
    try {
      if (!statSync(p).isDirectory()) return [];
      return [
        {
          path: p,
          entityCount: readdirSync(p).filter((n) => n.endsWith(".yml")).length,
        },
      ];
    } catch {
      return [];
    }
  });
}
export function configSync(root: string): string | null {
  const c = configDirs(root);
  if (!c.length) return null;
  const best = [...c].sort((a, b) => b.entityCount - a.entityCount)[0]!;
  return best.entityCount ? best.path : c[0]!.path;
}
export function findUpFile(root: string, name: string): string | null {
  let p = resolve(root);
  while (true) {
    const candidate = join(p, name);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
    const parent = dirname(p);
    if (parent === p) return null;
    p = parent;
  }
}
