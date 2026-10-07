#!/usr/bin/env node
import { isEntrypoint } from '../src/entrypoint.ts';
/** Keep the person's runner token out of tool reads and writes. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const ALLOWED = /^\.design-lab\/runner(?:\/|$|(?=[\s"'`;|&)]))/;
const REMAINDER = /^[^\s"'`;|&)]*/;
const member = (names: string): string => String.raw`(?:\.\s*(?:${names})|\[\s*['"](?:${names})['"]\s*\])`;
const SHOWS = new RegExp(String.raw`\b(print|echo|printf|cat|less|more|head|tail|pbcopy|tee|xxd|od|base64|strings)\b|\bconsole\s*${member('log|error|info|warn|debug|dir|dirxml|table|trace|assert')}\s*\(|\bprocess\s*${member('stdout|stderr')}\s*${member('write|end')}\s*\(`);
export const MESSAGE = "design-lab: the runner token in ~/.design-lab is the person's, and Claude never reads, copies or changes it. Give the person this command to run in their own terminal instead: pbcopy < ~/.design-lab/runner-token";
export function touchesToken(input: Record<string, unknown>): boolean {
  for (const field of ['file_path', 'notebook_path', 'path', 'pattern', 'glob', 'command']) {
    const value = input[field]; if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/\.design-lab/g)) {
      const tail = value.slice(match.index), allowed = ALLOWED.exec(tail);
      if (!allowed || REMAINDER.exec(tail.slice(allowed[0].length))![0].includes('..')) return true;
    }
  }
  const command = input['command'];
  return typeof command === 'string' && /runner-token|person_token|personToken/.test(command) && SHOWS.test(command);
}
export function guard(event: string): number {
  let value: any; try { value = JSON.parse(event); } catch { return 0; }
  if (touchesToken(value?.tool_input ?? {})) { console.error(MESSAGE); return 2; } return 0;
}
if (isEntrypoint(import.meta.url)) process.exitCode = guard(readFileSync(0, 'utf8'));
