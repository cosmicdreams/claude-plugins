import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);

/**
 * The escape hatch, not the default. Reach for `factories/content.ts` first.
 *
 * A command-line adapter is warranted in exactly two cases:
 *
 *   1. The system under test exposes no write interface you can reach over
 *      HTTP, so there is nothing for Playwright's request context to call.
 *   2. You need an operation the interface deliberately does not expose —
 *      rebuilding caches, reindexing, manipulating state below the application.
 *
 * Everything else belongs in the request-context factory, which is portable,
 * appears in the trace, and does not interpolate values into source code.
 *
 * Two rules apply whenever you do shell out, and they are the transferable
 * part of this file. Port these; do not port `drush`.
 */

/** Verbs that wipe a scope when invoked with no argument narrowing them. */
const DESTRUCTIVE = ['entity:delete', 'sql:drop', 'sql:query', 'user:cancel'];

/**
 * Rule one: escape every value interpolated into another language.
 *
 * This helper exists only because the call below generates PHP source. That is
 * the cost of the escape hatch, and it is the reason it is the escape hatch:
 * without this, a title containing an apostrophe produces a parse error inside
 * the generated snippet, the command exits having done nothing, and the test
 * goes green against content that was never created. A silent pass is worse
 * than any failure.
 *
 * The request-context factory has no equivalent of this function because it has
 * no equivalent of the problem — it sends structured data, so there is nothing
 * to escape.
 */
export function phpString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Rule two: refuse a destructive verb that was handed nothing to narrow it.
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
