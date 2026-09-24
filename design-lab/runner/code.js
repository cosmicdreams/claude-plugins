// design-lab runner: executes figma_build.py steps in the open file, with no model in between.
//
// scripts/figma_runner.py serves the steps on localhost. This loop asks for the next step,
// runs it here, posts the result, and repeats until the build is done or a step fails. The
// server picks the build whose file key matches this file, so the same plugin drives every
// run. A failed step is never recorded; running the plugin again resumes from it.
//
// Every request carries the token the server printed when it started. The plugin asks for it
// the first time and whenever the server refuses it, and keeps it in clientStorage.
const SERVER = 'http://localhost:8765';
const TOKEN_KEY = 'design-lab-runner-token';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let token = '';

function url(path) {
  return `${SERVER}${path}${path.includes('?') ? '&' : '?'}fileKey=${encodeURIComponent(figma.fileKey)}&token=${encodeURIComponent(token)}`;
}

async function call(path, body) {
  // text/plain keeps the POST a simple request, so no preflight check is needed.
  const init = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) };
  const res = await fetch(url(path), init);
  const text = await res.text();
  if (res.status !== 200) throw Object.assign(new Error(text), { status: res.status });
  return JSON.parse(text);
}

async function askToken(reason) {
  figma.showUI(`<form id="f" style="font:12px sans-serif;margin:12px">
    <p>${reason} Paste the runner token figma_runner.py printed when it started.</p>
    <input id="t" style="width:100%;box-sizing:border-box" autofocus>
    <p><button>Connect</button></p></form>
    <script>f.onsubmit = (e) => { e.preventDefault(); parent.postMessage({ pluginMessage: t.value.trim() }, '*'); };</script>`,
  { width: 320, height: 180 });
  const value = await new Promise((resolve) => { figma.ui.onmessage = resolve; });
  figma.ui.close();
  await figma.clientStorage.setAsync(TOKEN_KEY, value);
  return value;
}

// Each image is tried on its own so every failure is named; any failure then fails the step,
// which is reported to /error and not recorded.
async function upload(step) {
  const statuses = [];
  const failures = [];
  for (let i = 0; i < step.nodeIds.length; i++) {
    try {
      const res = await fetch(url(`/file?step=${encodeURIComponent(step.step)}&i=${i}`));
      if (res.status !== 200) throw new Error(`file ${i}: HTTP ${res.status} ${await res.text()}`);
      const node = await figma.getNodeByIdAsync(step.nodeIds[i]);
      if (!node) throw new Error(`file ${i}: node ${step.nodeIds[i]} not found`);
      const image = figma.createImage(new Uint8Array(await res.arrayBuffer()));
      node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: step.scaleMode }];
      statuses.push(200);
    } catch (e) {
      statuses.push(0);
      failures.push(String(e && e.message ? e.message : e));
    }
  }
  if (failures.length) throw new Error(`${failures.length} of ${statuses.length} uploads failed: ${failures.join('; ')}`);
  return { statuses };
}

async function screenshot(step) {
  const node = await figma.getNodeByIdAsync(step.nodeId);
  if (!node) throw new Error(`${step.step}: node ${step.nodeId} not found`);
  const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
  return { png: figma.base64Encode(bytes) };
}

async function firstStep() {
  token = (await figma.clientStorage.getAsync(TOKEN_KEY)) || '';
  if (!token) token = await askToken('No runner token is saved.');
  for (;;) {
    try {
      return await call('/next');
    } catch (e) {
      if (e.status !== 401) throw e;
      token = await askToken('The server refused the saved token; a restarted server prints a new one.');
    }
  }
}

async function run() {
  if (!figma.fileKey) throw new Error('this file has no key; save it to your Figma account first');
  let count = 0;
  let step = await firstStep();
  for (;;) {
    if (step.kind === 'done') return `design-lab: build complete (${count} steps this session)`;
    figma.notify(step.kind === 'dump' ? `design-lab export: ${step.step}` : `design-lab ${step.done + 1}/${step.total}: ${step.step}`, { timeout: 4000 });
    let result;
    try {
      if (step.kind === 'use_figma' || step.kind === 'dump') result = await new AsyncFunction(step.code)();
      else if (step.kind === 'upload') result = await upload(step);
      else if (step.kind === 'screenshot') result = await screenshot(step);
      else throw new Error(`unknown step kind ${step.kind}`);
    } catch (e) {
      const message = `${step.step}: ${e && e.stack ? e.stack : e}`;
      await call('/error', { step: step.step, message }).catch(() => {});
      throw new Error(message);
    }
    await call(`/record?step=${encodeURIComponent(step.step)}`, result === undefined ? {} : result);
    count++;
    step = await call('/next');
  }
}

run().then(
  (msg) => figma.closePlugin(msg),
  (e) => figma.closePlugin(`design-lab stopped: ${String(e && e.message ? e.message : e).slice(0, 300)}`),
);
