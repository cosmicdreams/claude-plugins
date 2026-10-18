import { createHash } from 'node:crypto';
import { canonical } from '../../hooks/mod/request-identity.ts';
// The request the mod writes before starting the runner (hooks/mod/operation.ts requestOf), for tests
// that start src/mod-entry.ts directly.
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeRequest(dir: string, cli: string[], deadlineMs: number): void {
  const id = dir.slice(dir.lastIndexOf('/') + 1);
  const arg = (flag: string, fallback: string | null = null) => cli.includes(flag) ? cli[cli.indexOf(flag) + 1]! : fallback;
  const root = (flag: string) => { const path = arg(flag, '/missing')!; return existsSync(path) ? realpathSync(path) : path; };
  const inputs = existsSync(join(dir, 'inputs.json')) ? JSON.parse(readFileSync(join(dir, 'inputs.json'), 'utf8')) : null;
  const context = { operation: cli[0], appRoot: root('--app-root'), suiteRoot: root('--suite-root'), environment: arg('--env', 'local'), work: arg('--work'), noWork: cli.includes('--no-work') };
  const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
  const inputsHash = digest(inputs);
  const requestIdentity = { schema: 1, operationId: id, context, inputsHash, requestHash: digest({ operationId: id, cli, deadlineMs, context, inputsHash }) };
  writeFileSync(join(dir, 'request.json'), `${JSON.stringify({ schema: 2, id, operation: cli[0], deadlineMs, cli, requestIdentity, hasInputs: existsSync(join(dir, 'inputs.json')) })}\n`);
}
