/** Explicit browser lane; no skip when dependencies/browser are absent. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser, captureConfig } from '../../src/capture/browser.ts';
import { isolated } from '../../src/capture/pool.ts';
import { sharedRequire } from '../../src/runtime.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
async function capture(options: { late?: boolean; blocked?: boolean; optOut?: boolean }) {
  let closes = 0;
  const html = `<style>#component{width:200px;height:100px;background:blue}</style><div id="component">Component</div><script>
window.showConsent=()=>{const banner=document.createElement('aside');banner.className='dg-consent-banner';banner.style='position:fixed;inset:0;background:red;z-index:99999';banner.attachShadow({mode:'open'}).innerHTML='<button class="dg-header-close">Close</button>';banner.shadowRoot.querySelector('button').onclick=()=>{${options.blocked ? 'return;' : ''}localStorage.setItem('closed','yes');fetch('/closed');banner.remove();};document.body.append(banner);};if(!localStorage.getItem('closed'))setTimeout(showConsent,100);</script>`;
  const server = createServer((req, res) => { if (req.url === '/closed') { closes++; res.writeHead(204); res.end(); } else { res.setHeader('Content-Type', 'text/html'); res.end(html); } });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const browser = await launchBrowser(), out = mkdtempSync('/tmp/design-lab-p2-cookie-');
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/page`;
    const rows = await isolated(browser, 30000, scoped => captureConfig(scoped, { component: 'fixture', componentId: 'fixture', machineName: 'fixture', rootSelector: '#component', path: '/page', verificationUrl: url, linkUrl: url, cookiePreferences: options.optOut ? false : { timeout: 300 }, viewports: [{ name: 'Desktop', width: 400, height: 300 }, { name: 'Mobile', width: 375, height: 300 }], states: [{ name: 'default' }, ...options.late ? [{ name: 'late', setup: 'setTimeout(showConsent,100)' }] : []] }, out, 1));
    if (options.blocked) { assert.ok(rows.every(row => row.error)); assert.ok(rows.every(row => !row.file)); }
    else {
      assert.ok(rows.every(row => !row.error), JSON.stringify(rows));
      for (const row of rows) { const pixel = await sharp(resolve(out, row.file!)).removeAlpha().extract({ left: 150, top: 70, width: 1, height: 1 }).raw().toBuffer(); assert.deepEqual([...pixel], options.optOut ? [255, 0, 0] : [0, 0, 255]); }
      assert.equal(closes, options.optOut ? 0 : options.late ? 3 : 1);
    }
  } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); }
}
test('shadow and late panels close through their controls', async () => capture({ late: true }));
test('unclosable panels fail without screenshot', async () => capture({ blocked: true }));
test('cookie component opts out of dismissal', async () => capture({ optOut: true }));
test('saved cookie choice carries into the next breakpoint', async () => capture({}));
