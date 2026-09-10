import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);

/**
 * The environment adapter. Every factory reaches the system under test through
 * this file and no other, which is what makes the "spec rolls its own helper"
 * anti-pattern visible in review: an import from anywhere else is the defect.
 *
 * This one is Drupal. The three rules it instantiates are not:
 *
 *   1. One adapter, centrally located. Not re-declared per spec.
 *   2. Escape every value interpolated into another language. Below that is
 *      PHP; elsewhere it is SQL, a shell word, or JSON. Same rule.
 *   3. Refuse destructive commands that were handed no argument.
 *
 * Port those three. Do not port `drush`.
 */

/** Verbs that wipe a scope when invoked with no argument narrowing them. */
const DESTRUCTIVE = ['entity:delete', 'sql:drop', 'sql:query', 'user:cancel'];

/**
 * Escape a string for interpolation into single-quoted PHP.
 *
 * This is the load-bearing one. Without it a title containing an apostrophe
 * produces a PHP parse error inside the generated snippet, the command exits
 * having done nothing, and the test goes green against content that was never
 * created. A silent pass is worse than any failure.
 */
export function phpString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Invoke drush, refusing an unnarrowed destructive verb.
 *
 * `drush(['entity:delete', 'node'])` deletes every node on the site. That is a
 * plausible thing for a generated cleanup helper to emit when the id it meant
 * to pass came back undefined, so the guard is not paranoia — it is the failure
 * this wrapper exists to convert into an exception.
 */
export async function drush(args: string[]): Promise<string> {
  const [verb, ...rest] = args;

  if (DESTRUCTIVE.includes(verb) && rest.filter((a) => !a.startsWith('-')).length === 0) {
    throw new Error(
      `drush refused "${verb}" with no argument narrowing it. ` +
      `This would act on every entity in scope. If that is genuinely intended, ` +
      `say so at the call site rather than widening this guard.`,
    );
  }

  const {stdout} = await run('ddev', ['drush', ...args], {maxBuffer: 10 * 1024 * 1024});
  return stdout.trim();
}

/**
 * Marks everything a factory creates, so `global-teardown.ts` can sweep content
 * whose test died before its own cleanup ran. Stable within a run, unique
 * across runs, so two suites in parallel do not delete each other's fixtures.
 */
export const RUN_MARKER = process.env.E2E_RUN_MARKER ?? `e2e-${process.pid}`;
