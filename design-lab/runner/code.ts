import type { RunnerStep, RunnerReply } from "../src/figma/types.ts";
export async function template(ARGS: Record<string, never>) {
// DESIGN_LAB_TEMPLATE_BEGIN
// design-lab runner: executes figma_build.py steps in the open file, with no model in between.
//
// scripts/figma_runner.py serves the steps on localhost. This loop asks for the next step,
// runs it here, posts the result, and repeats until the build is done. The server picks the
// build whose file key matches this file, so the same plugin drives every run. A failed step is
// never recorded; the plugin stays open and waits, and the build resumes from that step once
// the cause is fixed.
//
// The plugin can be started before the build: the server answers `wait` until there are
// steps, and the plugin stays open, says it is connected, and asks again every few seconds.
// At preflight the server sends one `check` step that proves this file is the target, is
// empty and can be written. If the server stops answering (a restart), the plugin keeps
// retrying rather than quitting; a restarted server keeps its token, so nobody pastes it again.
//
// Every request carries the person's runner token (~/.design-lab/runner-token). The plugin asks
// for it the first time on a machine and whenever the server refuses it, and keeps it in
// clientStorage. Every request also carries this runner's version; preflight copies this file
// into ~/.design-lab/runner/ with the plugin's version filled in, and a runner older than the
// plugin is told to restart, which loads the new code.
const SERVER = 'http://localhost:8765';
const TOKEN_KEY = 'design-lab-runner-token';
const RUNNER_VERSION = 'source';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => () => Promise<unknown>;
let token = '';
const session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const RETRY_MS = 5000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A small status panel, so the person can see the runner is alive while it waits.
function status(text: string) {
  if (!figma.ui || !(status as typeof status & { open?: boolean }).open) {
    figma.showUI(`<p id="s" style="font:12px sans-serif;margin:12px"></p>
      <script>onmessage = (e) => { document.getElementById('s').textContent = e.data.pluginMessage; };</script>`,
    { width: 280, height: 60, title: 'design-lab runner' });
    (status as typeof status & { open?: boolean }).open = true;
  }
  figma.ui.postMessage(text);
}

function url(path: string) {
  return `${SERVER}${path}${path.includes('?') ? '&' : '?'}fileKey=${encodeURIComponent(figma.fileKey!)}&token=${encodeURIComponent(token)}&version=${encodeURIComponent(RUNNER_VERSION)}&client=${encodeURIComponent(session)}`;
}

function workPath(path: string, step: RunnerStep) {
  return `${path}${path.includes('?') ? '&' : '?'}step=${encodeURIComponent(step.step!)}&generation=${encodeURIComponent(String(step.generation))}&stepToken=${encodeURIComponent(String(step.stepToken))}`;
}
function heartbeat(step: RunnerStep) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const pulse = async () => {
    if (stopped) return;
    // Independent of call(): a disconnected server must not leave an endless heartbeat retry.
    await fetch(url(workPath('/heartbeat', step))).catch(() => {});
    if (!stopped) timer = setTimeout(pulse, 10000);
  };
  timer = setTimeout(pulse, 10000);
  return () => { stopped = true; clearTimeout(timer); };
}

async function call(path: string, body?: unknown): Promise<RunnerReply> {
  // text/plain keeps the POST a simple request, so no preflight check is needed.
  const init = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) };
  let res;
  for (;;) {
    try {
      res = await fetch(url(path), init);
      break;
    } catch (e) {
      // The server is not answering (restarting, or not started yet): wait and try again.
      status('The design-lab server is not answering. Retrying.');
      await sleep(RETRY_MS);
    }
  }
  const text = await res.text();
  if (res.status === 426) {
    // Outdated: the new code loads only when the runner starts again.
    const message = JSON.parse(text).message;
    status(message);
    throw Object.assign(new Error(message), { status: 426 });
  }
  if (res.status !== 200) throw Object.assign(new Error(text), { status: res.status });
  return JSON.parse(text) as RunnerReply;
}

async function askToken(reason: string): Promise<string> {
  figma.showUI(`<form id="f" style="font:12px sans-serif;margin:12px">
    <p>${reason} Paste your runner token, from ~/.design-lab/runner-token on this machine.</p>
    <input id="t" style="width:100%;box-sizing:border-box" autofocus>
    <p><button>Connect</button></p></form>
    <script>f.onsubmit = (e) => { e.preventDefault(); parent.postMessage({ pluginMessage: t.value.trim() }, '*'); };</script>`,
  { width: 320, height: 180 });
  const value = await new Promise<string>((resolve) => { figma.ui.onmessage = resolve; });
  figma.ui.close();
  (status as typeof status & { open?: boolean }).open = false;
  await figma.clientStorage.setAsync(TOKEN_KEY, value);
  return value;
}

// Each image is tried on its own so every failure is named; any failure then fails the step,
// which is reported to /error and not recorded.
async function upload(step: Extract<RunnerStep, { kind: 'upload' }>) {
  const statuses = [];
  const failures = [];
  for (let i = 0; i < step.nodeIds.length; i++) {
    try {
      const res = await fetch(url(workPath(`/file?i=${i}`, step)));
      if (res.status !== 200) throw new Error(`file ${i}: HTTP ${res.status} ${await res.text()}`);
      const node = await figma.getNodeByIdAsync(step.nodeIds[i]!) as (SceneNode & GeometryMixin) | null;
      if (!node) throw new Error(`file ${i}: node ${step.nodeIds[i]} not found`);
      const image = figma.createImage(new Uint8Array(await res.arrayBuffer()));
      node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: step.scaleMode }];
      statuses.push(200);
    } catch (e) {
      statuses.push(0);
      failures.push(String(e && (e as Error).message ? (e as Error).message : e));
    }
  }
  if (failures.length) throw new Error(`${failures.length} of ${statuses.length} uploads failed: ${failures.join('; ')}`);
  return { statuses };
}

async function screenshot(step: Extract<RunnerStep, { kind: 'screenshot' }>) {
  const node = await figma.getNodeByIdAsync(step.nodeId) as SceneNode | null;
  if (!node) throw new Error(`${step.step}: node ${step.nodeId} not found`);
  const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
  return { png: figma.base64Encode(bytes) };
}

async function firstStep() {
  token = (await figma.clientStorage.getAsync(TOKEN_KEY) as string) || '';
  if (!token) token = await askToken('No runner token is saved.');
  for (;;) {
    try {
      return await call('/next');
    } catch (e) {
      if ((e as Error & { status?: number }).status !== 401) throw e;
      token = await askToken('The server refused the saved token.');
    }
  }
}

async function run() {
  if (!figma.fileKey) throw new Error('this file has no key; save it to your Figma account first');
  let count = 0;
  let step = await firstStep();
  for (;;) {
    if (step.kind === 'done') return `design-lab: build complete (${count} steps this session)`;
    if (step.kind === 'wait') {
      status(step.message || 'Connected. Waiting for the build to start.');
      await sleep(step.retryMs || RETRY_MS);
      step = await call('/next');
      continue;
    }
    status(step.kind === 'check' ? 'Connected. Checking this file for preflight.'
      : step.kind === 'dump' ? `Exporting ${step.step}`
        : `Building ${step.done! + 1} of ${step.total}: ${step.step}`);
    const cacheId = (step.buildId || 'preflight') as string;
    try { if (typeof globalThis !== 'undefined' && (!globalThis.__designLabBuildCache || globalThis.__designLabBuildCache.buildId !== cacheId)) {
      globalThis.__designLabBuildCache = { buildId: cacheId, loadedFonts: new Map() };
    } } catch { /* A sandbox without persistent globals uses the template-local cache. */ }
    const started = Date.now();
    const stopHeartbeat = heartbeat(step);
    let result;
    try {
      if (step.kind === 'use_figma' || step.kind === 'dump' || step.kind === 'check') result = await new AsyncFunction(step.code!)();
      else if (step.kind === 'upload') result = await upload(step);
      else if (step.kind === 'screenshot') result = await screenshot(step);
      else throw new Error(`unknown step kind ${step.kind}`);
    } catch (e) {
      // The sandbox's stack has no message line, so both are sent: the message says what failed.
      const detail = e && (e as Error).message ? (e as Error).message : String(e);
      const message = `${step.step}: ${detail}${e && (e as Error).stack ? `\n${(e as Error).stack}` : ''}`;
      stopHeartbeat();
      await call(workPath('/error', step), { step: step.step, message }).catch(() => {});
      // Preflight reports its own failure to the person; a check is never retried in place.
      if (step.kind === 'check') throw new Error(message);
      // A failed step is not recorded. The server answers `wait` until a fix lands (a new
      // init or a restarted server), so a fix needs nobody in Figma.
      status(`Stopped at ${step.step}: ${detail.slice(0, 160)}. Waiting for a fix.`);
      step = await call('/next');
      continue;
    }
    try { await call(workPath('/record', step), {
      __designLabTiming: { durationMs: Date.now() - started },
      result: result === undefined ? {} : result,
    }); } catch (error) {
      if ((error as Error & {status?:number}).status !== 409) throw error;
      status('The build changed. Asking for current work.');
    } finally { stopHeartbeat(); }
    count++;
    step = await call('/next');
  }
}

run().then(
  (msg) => figma.closePlugin(msg),
  (e) => figma.closePlugin(`design-lab stopped: ${String(e && (e as Error).message ? (e as Error).message : e).slice(0, 300)}`),
);

// DESIGN_LAB_TEMPLATE_END
}
