/** Runs a snippet of the original Python reference and returns its JSON result.
 * The interpreter comes from DESIGN_LAB_PYTHON (for example /tmp/dl-venv/bin/python) and
 * defaults to python3. The snippet receives its input as the JSON object on stdin, with the
 * `scripts` folder already on sys.path. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { oracleScripts,oracleExecutable } from '../equivalence/oracle.ts';

export const PYTHON = oracleExecutable;

const PREAMBLE = `import json, sys
_input = json.load(sys.stdin)
sys.path.insert(0, _input['scripts'])
`;

export function pyJson<T = any>(body: string, input: Record<string, unknown> = {}): T {
  const run = spawnSync(PYTHON, ['-I', '-c', PREAMBLE + body], {
    input: JSON.stringify({ scripts: oracleScripts, ...input }),
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`python reference failed (${PYTHON}): ${run.stderr}`);
  return JSON.parse(run.stdout) as T;
}
