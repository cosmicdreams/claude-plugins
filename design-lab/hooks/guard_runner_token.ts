#!/usr/bin/env node
import { isEntrypoint } from '../src/entrypoint.ts';
/** Keep the person's runner token out of tool reads and writes. */
import { readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
const ALLOWED = /^\.design-lab\/runner(?:\/|$|(?=[\s"'`;|&)]))/;
const REMAINDER = /^[^\s"'`;|&)]*/;
const member = (names: string): string => String.raw`(?:\.\s*(?:${names})|\[\s*['"](?:${names})['"]\s*\])`;
const SHOWS = new RegExp(
  String.raw`\b(print|echo|printf|cat|less|more|head|tail|pbcopy|tee|xxd|od|base64|strings)\b|\bconsole\s*${member('log|error|info|warn|debug|dir|dirxml|table|trace|assert')}\s*\(|\bprocess\s*${member('stdout|stderr')}\s*${member('write|end')}\s*\(`,
);
export const MESSAGE =
  "design-lab: the runner token in ~/.design-lab is the person's, and Claude never reads, copies or changes it. Give the person this command to run in their own terminal instead: pbcopy < ~/.design-lab/runner-token";
// Inspect words without executing shell expansions. Quoted fragments may be concatenated.
function words(command: string): string[] {
  return Array.from(command.matchAll(/(?:[^\s"'`;|&()<>=]+|"[^"]*"|'[^']*')+/g), (match) =>
    match[0].replace(/"([^"]*)"|'([^']*)'/g, (_, double, single) => double ?? single),
  );
}

/** Resolve existing symlinked parents even when the final write target doesn't exist. */
function canonical(path: string, depth = 0): string {
  if (depth > 64) throw new Error('unresolvable path');
  try {
    return realpathSync.native(path);
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    const parent = dirname(path);
    // A dangling symlink can still be the destination of a token write.
    try {
      return canonical(resolve(parent, readlinkSync(path)), depth + 1);
    } catch (linkError) {
      if (!['ENOENT', 'ENOTDIR', 'EINVAL'].includes((linkError as NodeJS.ErrnoException).code ?? '')) throw linkError;
    }
    return parent === path ? path : resolve(canonical(parent, depth + 1), relative(parent, path));
  }
}
const within = (path: string, root: string): boolean => path === root || path.startsWith(root + sep);
// A word past the system's path limits (NAME_MAX 255 bytes per name, PATH_MAX 1,024) names no file.
const bytes = (text: string): number => Buffer.byteLength(text);
const couldBePath = (path: string): boolean =>
  !path.includes('\0') && bytes(path) <= 1024 && path.split(sep).every((name) => bytes(name) <= 255);
function protectedPath(value: string, cwd: string): boolean {
  const home = process.env['DESIGN_LAB_HOME'] || resolve(homedir(), '.design-lab');
  const expanded = value
    .replace(/^~(?=\/|$)/, homedir())
    .replace(/\$(?:\{(HOME|DESIGN_LAB_HOME)\}|(HOME|DESIGN_LAB_HOME)\b)/g, (_, braced, bare) =>
      (braced ?? bare) === 'HOME' ? homedir() : home,
    );
  // Unknown shell expansions cannot be resolved without executing the command.
  if (expanded.includes('$')) return false;
  const path = resolve(cwd, expanded),
    root = resolve(home),
    runner = resolve(root, 'runner');
  if (within(path, root) && !within(path, runner)) return true;
  // The kernel applies the limits to the word as given, not to the working directory joined to it.
  if (!couldBePath(expanded)) return false;
  const physicalPath = isAbsolute(expanded) ? expanded : `${cwd}/${expanded}`;
  const actual = canonical(physicalPath);
  // An inaccessible home must not turn every unrelated tool call into a denial.
  let actualRoot = root,
    token = resolve(root, 'runner-token');
  try {
    actualRoot = canonical(root);
  } catch {
    /* lexical home checks still apply */
  }
  try {
    token = canonical(token);
  } catch {
    /* lexical token checks still apply */
  }
  const actualRunner = resolve(actualRoot, 'runner');
  // A runner asset symlink must not make the runner exception an escape hatch.
  return actual === token || (within(actual, actualRoot) && !within(actual, actualRunner));
}

export function touchesToken(input: Record<string, unknown>, cwd = process.cwd()): boolean {
  for (const field of ['file_path', 'notebook_path', 'path', 'pattern', 'glob', 'command']) {
    const value = input[field];
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/\.design-lab/g)) {
      const tail = value.slice(match.index),
        allowed = ALLOWED.exec(tail);
      if (!allowed || REMAINDER.exec(tail.slice(allowed[0].length))![0].includes('..')) return true;
    }
    if (['file_path', 'notebook_path', 'path'].includes(field)) {
      try {
        if (protectedPath(value, cwd)) return true;
      } catch {
        return true;
      }
    }
    // Glob suffixes are checked against their enclosing directory as well.
    for (const word of words(value)) {
      const path = word.split(/[?*\[]/, 1)[0] || '.';
      try {
        if (path && protectedPath(path, cwd)) return true;
      } catch {
        return true;
      } // Refuse only the particular path whose identity can't be checked.
    }
  }
  const command = input['command'];
  if (typeof command !== 'string') return false;
  return /runner-token|person_token|personToken/.test(command) && SHOWS.test(command);
}
export function guard(event: string): number {
  let value: unknown;
  try {
    value = JSON.parse(event);
  } catch {
    return 0;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const eventData = value as Record<string, unknown>;
  const input = eventData['tool_input'];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 0;
  const inputRecord = input as Record<string, unknown>;
  const cwd = typeof eventData['cwd'] === 'string' && isAbsolute(eventData['cwd']) ? eventData['cwd'] : process.cwd();
  const scoped =
    ['Grep', 'Glob'].includes(String(eventData['tool_name'])) && inputRecord['path'] === undefined
      ? { ...inputRecord, path: cwd }
      : inputRecord;
  if (touchesToken(scoped, cwd)) {
    console.error(MESSAGE);
    return 2;
  }
  return 0;
}
if (isEntrypoint(import.meta.url)) process.exitCode = guard(readFileSync(0, 'utf8'));
