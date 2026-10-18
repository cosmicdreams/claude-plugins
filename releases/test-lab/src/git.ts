// Git, run by argument vector with no shell. Preserve the repository's hooks and write guards.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type GitResult = { ok: boolean; stdout: string; stderr: string; code: number };

export async function git(cwd: string, args: string[], options: { allowFail?: boolean; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<GitResult> {
  try {
    const { stdout, stderr } = await run('git', args, {
      cwd,
      maxBuffer: 256 * 1024 * 1024,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    });
    return { ok: true, stdout, stderr, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number | string };
    const result = { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? String(error), code: typeof e.code === 'number' ? e.code : 1 };
    if (options.allowFail === true) return result;
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr.trim()}`);
  }
}

export async function gitText(cwd: string, args: string[]): Promise<string> {
  return (await git(cwd, args)).stdout.trim();
}

/** The repository's top folder, or null outside one. */
export async function repoTop(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', '--show-toplevel'], { allowFail: true });
  return r.ok ? r.stdout.trim() : null;
}
