/**
 * Preload (`node --import`) that validates every artifact the process writes, through the real write path.
 * It patches the synchronous `fs` write calls, so atomic temp-and-rename writes, direct writes and appended
 * JSON Lines are all checked, and so are child processes that inherit NODE_OPTIONS. It never throws:
 * each write is recorded to the file named by DESIGN_LAB_WRITE_LOG, one JSON object per line, for
 * `tests/support/run-write-check.ts` to summarise.
 */
import fs from 'node:fs';
import { ServerResponse } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kindForPath } from '../../src/artifact-scan.ts';
import { validate } from '../../src/contracts.ts';

const log = process.env['DESIGN_LAB_WRITE_LOG'];
const root = resolve(fileURLToPath(import.meta.url), '../../..');
/** The plugin's own frames (src/, scripts/) that led to a write; a test fixture written straight from a test has none. */
function frames(): string[] {
  return (new Error().stack ?? '')
    .split('\n')
    .map((line) => /\(?((?:file:\/\/)?\/[^():]+):(\d+):\d+\)?$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => `${m[1]!.replace('file://', '')}:${m[2]}`)
    .filter((f) => f.startsWith(`${root}/`))
    .map((f) => f.slice(root.length + 1));
}
const writers = (): string[] =>
  frames().filter(
    (f) =>
      (f.startsWith('src/') || f.startsWith('scripts/')) &&
      !f.startsWith('src/contracts.ts:') &&
      !f.startsWith('src/build-artifacts.ts:'),
  );
if (log) {
  const { writeFileSync, appendFileSync, renameSync, openSync, writeSync, closeSync, readFileSync } = fs;
  const appended = new Map<number, string>();
  const record = (entry: object): void => {
    try {
      appendFileSync(log, JSON.stringify({ pid: process.pid, ...entry }) + '\n');
    } catch {
      /* the log is best effort */
    }
  };
  const toText = (data: unknown): string | undefined =>
    typeof data === 'string' ? data : data instanceof Uint8Array ? Buffer.from(data).toString('utf8') : undefined;
  const check = (path: string, text: string | undefined): void => {
    if (text === undefined || basename(path).startsWith('.')) return;
    const kind = kindForPath(path);
    if (!kind) return;
    const by = writers();
    if (!by.length) return;
    const lines = kind === 'phase-log-entry' ? text.split(/\r?\n/).filter((line) => line.trim()) : [text];
    for (const line of lines) {
      let errors: string[];
      try {
        errors = validate(kind, JSON.parse(line) as unknown);
      } catch (error) {
        errors = [`not JSON: ${String(error)}`];
      }
      record({
        kind,
        path,
        errors,
        by,
        test: frames().find((f) => f.startsWith('tests/') && !f.startsWith('tests/support/')) ?? null,
      });
    }
  };
  fs.writeFileSync = ((path: unknown, data: unknown, ...rest: unknown[]) => {
    const result = (writeFileSync as (...args: unknown[]) => void)(path, data, ...rest);
    if (typeof path === 'string') check(path, toText(data));
    return result;
  }) as typeof fs.writeFileSync;
  fs.appendFileSync = ((path: unknown, data: unknown, ...rest: unknown[]) => {
    const result = (appendFileSync as (...args: unknown[]) => void)(path, data, ...rest);
    if (typeof path === 'string' && path !== log) check(path, toText(data));
    else if (typeof path === 'number' && appended.has(path)) check(appended.get(path)!, toText(data));
    return result;
  }) as typeof fs.appendFileSync;
  fs.openSync = ((path: unknown, flags?: unknown, ...rest: unknown[]) => {
    const fd = (openSync as (...args: unknown[]) => number)(path, flags, ...rest);
    if (typeof path === 'string' && typeof flags === 'string' && flags.startsWith('a')) appended.set(fd, path);
    return fd;
  }) as typeof fs.openSync;
  fs.writeSync = ((fd: number, data: unknown, ...rest: unknown[]) => {
    const result = (writeSync as (...args: unknown[]) => number)(fd, data, ...rest);
    if (appended.has(fd)) check(appended.get(fd)!, toText(data));
    return result;
  }) as typeof fs.writeSync;
  fs.closeSync = ((fd: number) => {
    appended.delete(fd);
    return closeSync(fd);
  }) as typeof fs.closeSync;
  fs.renameSync = ((from: unknown, to: unknown) => {
    let text: string | undefined;
    if (typeof from === 'string' && typeof to === 'string' && kindForPath(to)) {
      try {
        text = readFileSync(from, 'utf8');
      } catch {
        /* the rename reports it */
      }
    }
    const result = renameSync(from as string, to as string);
    if (typeof to === 'string') check(to, text);
    return result;
  }) as typeof fs.renameSync;
  // Audit successful schema-governed HTTP sends too. Do not log request query strings (they contain tokens).
  const end = ServerResponse.prototype.end;
  ServerResponse.prototype.end = function (this: ServerResponse, ...args: unknown[]) {
    const path = this.req.url?.split('?')[0];
    const kind =
      path === '/next'
        ? 'runner-step'
        : path === '/record'
          ? 'runner-record-response'
          : path === '/error'
            ? 'runner-error-response'
            : undefined;
    const body = toText(args[0]);
    if (kind && this.statusCode === 200 && body !== undefined) {
      let errors: string[];
      try {
        errors = validate(kind, JSON.parse(body) as unknown);
      } catch (error) {
        errors = [`not JSON: ${String(error)}`];
      }
      record({
        kind,
        path: `HTTP ${path}`,
        errors,
        by: writers(),
        test: frames().find((f) => f.startsWith('tests/') && !f.startsWith('tests/support/')) ?? null,
      });
    }
    return (end as (...args: unknown[]) => ServerResponse).apply(this, args);
  } as typeof end;
  syncBuiltinESMExports();
}
