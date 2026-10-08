/** Replay saved Figma responses over HTTP; no Figma actions and no baseline interpreter. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { personToken, fitFigmaImage, pluginVersion } from '../../src/figma-runner.ts';
import { assertPixels, EDGE, JPEG } from './pixel-compare.ts';
const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    transcript: { type: 'string' },
    source: { type: 'string' },
    port: { type: 'string' },
  },
});
for (const flag of ['project', 'transcript', 'source', 'port'] as const)
  assert.ok(values[flag], `--${flag} is required`);
const project = resolve(values.project!),
  source = resolve(values.source!),
  data = JSON.parse(readFileSync(values.transcript!, 'utf8')),
  rows = new Map<string, any>(data.transcript.map((row: any) => [row.step.step, row])),
  key = JSON.parse(readFileSync(resolve(project, 'figma/state.json'), 'utf8')).fileKey;
const token = personToken(); // stays inside this process; never printed
let work: Record<string, string> = {},
  served = 0,
  dumps = 0,
  uploads = 0,
  screenshots = 0,
  files = 0;
const request = async (path: string, extra: Record<string, string> = {}, body?: unknown) => {
  const query = new URLSearchParams({
    fileKey: key,
    version: pluginVersion(),
    token,
    client: 'plain-copy-smoke',
    ...work,
    ...extra,
  });
  const response = await fetch(`http://127.0.0.1:${values.port}${path}?${query}`, {
    headers: { Origin: 'null', 'Content-Type': 'text/plain' },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  assert.equal(response.status, 200, `${path}: ${response.status}`);
  return response;
};
const start = performance.now();
for (let i = 0; i < 600; i++) {
  work = {};
  const step = (await (await request('/next')).json()) as any;
  if (step.kind === 'done') {
    console.log(
      JSON.stringify({
        done: true,
        served,
        dumps,
        uploads,
        screenshots,
        files,
        seconds: (performance.now() - start) / 1000,
      }),
    );
    break;
  }
  assert.notEqual(step.kind, 'wait');
  assert.ok(step.step);
  served++;
  if (step.generation && step.stepToken)
    work = { generation: String(step.generation), stepToken: String(step.stepToken) };
  let result: any;
  if (step.kind === 'dump') {
    const name = step.step.startsWith('dump:')
      ? `figma/dump/${step.step.slice(5).replaceAll('/', '-')}.json`
      : step.step === 'verify:root'
        ? 'figma/verify/root.json'
        : step.step === 'verify:getting-started'
          ? 'figma/verify/getting-started.json'
          : `figma/verify/page-${step.step.slice('verify:page:'.length).replaceAll('/', '-')}.json`;
    result = JSON.parse(readFileSync(resolve(source, name), 'utf8'));
    dumps++;
  } else {
    const row = rows.get(step.step);
    assert.ok(row, 'recorded result for ' + step.step);
    result = structuredClone(row.input);
    if (step.kind === 'screenshot') {
      result = { png: readFileSync(row.input.file).toString('base64') };
      screenshots++;
    }
    if (step.kind === 'upload') {
      uploads++;
      for (let n = 0; n < step.nodeIds.length; n++) {
        const reply = await request('/file', { step: step.step, i: String(n) }),
          actual = Buffer.from(await reply.arrayBuffer()),
          expected = await fitFigmaImage(row.step.files[n].file);
        await assertPixels(
          actual,
          expected,
          `${step.step} file ${n}`,
          /\.jpe?g$/i.test(row.step.files[n].file) ? JPEG : EDGE,
        );
        files++;
      }
    }
  }
  const recorded = (await (await request('/record', { step: step.step }, result)).json()) as any;
  assert.equal(recorded.recorded, step.step);
  if (i === 599) throw new Error('HTTP replay did not reach done');
}
