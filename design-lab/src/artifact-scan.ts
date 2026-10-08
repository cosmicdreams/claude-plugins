import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';
import { homedir } from 'node:os';
import { artifactKinds, validate } from './contracts.ts';
import type { ArtifactKind } from './contracts.ts';
export const defaultRoots = [
  '.design/pncb/2026-10-06',
  'Sites/DEFINITIVEHC/design/2026-10-03',
  'Sites/DEFINITIVEHC/design/2026-10-05',
  'Tools/design-lab-corpus/massport',
  'Tools/design-lab-corpus/kingtec',
  'Tools/design-lab-corpus/americas-credit-unions',
].map((p) => resolve(homedir(), p));
export interface FileResult {
  root: string;
  file: string;
  kind: ArtifactKind;
  entries: number;
  errors: string[];
}
/** Match exact artifact basenames anywhere in a run, plus boundary directories. */
export function kindForPath(path: string): ArtifactKind | undefined {
  const name = basename(path);
  if (name === 'phase-log.jsonl') return 'phase-log-entry';
  if (name.endsWith('.spec.json')) return 'spec';
  if (/\bfigma\/trees\/[^/]+\.json$/.test(path)) return 'tree';
  if (/\bfigma\/results\/[^/]+\.json$/.test(path)) return 'step-result';
  if (/\bfigma\/state\.json$/.test(path)) return 'figma-state';
  if (/\bfigma\/progress\.json$/.test(path)) return 'progress';
  if (name === 'index.json' && /\bcapture[^/]*\/shots\//.test(path)) return undefined; // screenshot manifest, a different artifact
  if (/\bbuilds\/[^/]+\.json$/.test(path)) return 'build-record';
  const kind = name.replace(/\.json$/, '') as ArtifactKind;
  return name.endsWith('.json') && artifactKinds.includes(kind) ? kind : undefined;
}
export function scanArtifacts(roots: readonly string[]): FileResult[] {
  const results: FileResult[] = [];
  for (const root of roots) {
    const visit = (folder: string): void => {
      for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = resolve(folder, entry.name);
        if (entry.isDirectory())
          visit(file); // no symlink traversal or writes
        else if (entry.isFile()) {
          const kind = kindForPath(file);
          if (!kind) continue;
          const result: FileResult = { root, file: relative(root, file), kind, entries: 0, errors: [] };
          try {
            const text = readFileSync(file, 'utf8');
            const lines = kind === 'phase-log-entry' ? text.split(/\r?\n/).filter((l) => l.trim()) : [text];
            for (const [index, line] of lines.entries()) {
              result.entries++;
              try {
                result.errors.push(
                  ...validate(kind, JSON.parse(line) as unknown).map((error) =>
                    kind === 'phase-log-entry' ? `line ${index + 1} ${error}` : error,
                  ),
                );
              } catch (error) {
                result.errors.push(`line ${index + 1}: ${String(error)}`);
              }
            }
          } catch (error) {
            result.errors.push(String(error));
          }
          results.push(result);
        }
      }
    };
    visit(root);
  }
  return results;
}
