#!/usr/bin/env node
/** Submit one live DOM subtree to Figma's html-to-design capture endpoint.
 *
 * Intended for local evidence work when the application cannot safely be edited to add the
 * capture script. The capture id and endpoint are issued by generate_figma_design.
 */
import { resolve } from 'node:path';

const arg = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
};
const optionalArg = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
};

let chromium;
try {
  const { createRequire } = await import('node:module');
  ({ chromium } = createRequire(resolve(process.cwd(), 'noop.mjs'))('playwright'));
} catch {
  throw new Error('playwright is not resolvable from the current directory');
}

const url = arg('--url');
const captureId = arg('--capture-id');
const endpoint = arg('--endpoint');
const selector = arg('--selector');
const setup = optionalArg('--setup');
const executablePath = process.env.DESIGN_LAB_BROWSER_EXECUTABLE;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({ignoreHTTPSErrors: true,
  viewport: {width: Number(process.env.DESIGN_LAB_WIDTH || 1280), height: 1200}});
const page = await context.newPage();
await page.route('**/*', async route => {
  const response = await route.fetch();
  const headers = {...response.headers()};
  delete headers['content-security-policy'];
  delete headers['content-security-policy-report-only'];
  await route.fulfill({response, headers});
});
await page.goto(url, {waitUntil: 'load', timeout: 60000});
await page.evaluate(() => document.fonts.ready);
if (setup) {
  await page.evaluate(source => new Function(source)(), setup);
  await page.waitForTimeout(800);
}
const response = await context.request.get('https://mcp.figma.com/mcp/html-to-design/capture.js');
const source = await response.text();
await page.evaluate(script => {
  const element = document.createElement('script');
  element.textContent = script;
  document.head.appendChild(element);
}, source);
await page.waitForTimeout(500);
const result = await page.evaluate(({id, target, root}) =>
  window.figma.captureForDesign({captureId: id, endpoint: target, selector: root}),
  {id: captureId, target: endpoint, root: selector});
console.log(JSON.stringify(result));
await browser.close();
