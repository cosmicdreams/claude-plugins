// Path arithmetic for finding the person's runs; the lookups that read files live in register.tsx,
// since a mod's engine calls stay in the file that registers its hooks.

export const MARKERS = ['plans', 'analysis-reports', 'design'];

/** Every folder from `path` up to the root, nearest first. */
export function ancestors(path: string): string[] {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  return parts.map((_, i) => `/${parts.slice(0, parts.length - i).join('/')}`);
}

export function base(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

export function parent(path: string): string {
  return path.replace(/\/[^/]+\/?$/, '') || '/';
}
