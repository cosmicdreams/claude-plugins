#!/usr/bin/env node
/** Keep the person's runner token out of tool reads and writes. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const ALLOWED = /^\.design-lab\/runner(?:\/|$|(?=[\s"'`;|&)]))/;
const REMAINDER = /^[^\s"'`;|&)]*/;
const SHOWS = /\b(print|echo|printf|cat|less|more|head|tail|pbcopy|tee|xxd|od|base64|strings)\b/;
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
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = guard(readFileSync(0, 'utf8'));
