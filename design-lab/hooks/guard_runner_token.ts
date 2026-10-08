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

/** Golden-rule's tool.call rewrite precedes classic PreToolUse command hooks. */
function wrappedCommands(command: string): string[] {
  const tokens = words(command),
    decoded: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (
      tokens[index - 1] !== '-I' ||
      !/(?:^|\/)python3$/.test(tokens[index - 2] ?? '') ||
      !/(?:^|\/)golden-rule(?:\/[^/]+)*\/hooks\/sandbox\/run\.py$/.test(tokens[index]!)
    )
      continue;
    const mode = tokens[index + 1],
      payload = tokens[index + 2];
    if ((mode !== '--command' && mode !== '--argv') || !payload) throw new Error('uninspectable golden-rule wrapper');
    // Buffer's base64 decoder is permissive; require an intact, canonical envelope.
    const bytes = Buffer.from(payload, 'base64');
    if (bytes.toString('base64') !== payload || bytes.toString('utf8').includes('\uFFFD'))
      throw new Error('invalid golden-rule payload');
    if (mode === '--command') decoded.push(bytes.toString('utf8'));
    else {
      const argv: unknown = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(argv) || !argv.length || !argv.every((arg) => typeof arg === 'string'))
        throw new Error('invalid golden-rule argv');
      decoded.push(argv.map((arg) => `'${arg.replace(/'/g, `'"'"'`)}'`).join(' '));
    }
  }
  return decoded;
}

export function touchesToken(input: Record<string, unknown>, cwd = process.cwd(), depth = 0): boolean {
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
  if (/runner-token|person_token|personToken/.test(command) && SHOWS.test(command)) return true;
  try {
    const nested = wrappedCommands(command);
    // Fail closed for an opaque known launcher, never for ordinary commands.
    return nested.length > 0 && (depth >= 8 || nested.some((command) => touchesToken({ command }, cwd, depth + 1)));
  } catch {
    return true;
  }
}
export function guard(event: string): number {
  let value: any;
  try {
    value = JSON.parse(event);
  } catch {
    return 0;
  }
  const input = value?.tool_input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 0;
  const cwd = typeof value.cwd === 'string' && isAbsolute(value.cwd) ? value.cwd : process.cwd();
  const scoped =
    ['Grep', 'Glob'].includes(value.tool_name) && input.path === undefined ? { ...input, path: cwd } : input;
  if (touchesToken(scoped, cwd)) {
    console.error(MESSAGE);
    return 2;
  }
  return 0;
}
if (isEntrypoint(import.meta.url)) process.exitCode = guard(readFileSync(0, 'utf8'));
