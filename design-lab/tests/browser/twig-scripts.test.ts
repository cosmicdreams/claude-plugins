/** The typed in-page scripts behave as the baseline's script text did, on the same pages. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { launchBrowser } from '../../src/capture/browser.ts';
import { ownScript } from '../../src/capture/scaffold.ts';
import { legacyOwnScript } from '../../src/capture/twig-legacy.ts';

const render = (hook: string, file: string, body: string, depth = 'themes/x/templates'): string =>
  `<!-- THEME HOOK: '${hook}' -->\n<!-- FILE NAME SUGGESTIONS:\n   * ${hook}--other.html.twig\n   x ${file}\n-->\n<!-- BEGIN OUTPUT from '${depth}/${file}' -->${body}<!-- END OUTPUT from '${depth}/${file}' -->\n`;
const page = (body: string): string => `<!doctype html><html><body><!-- THEME DEBUG -->${body}</body></html>`;

const cases: Array<{
  name: string;
  html: string;
  id: string;
  kind: string | undefined;
  selector: string;
  children: string[];
}> = [
  {
    name: 'a drawn template root is tagged',
    id: 'paragraph:cards',
    kind: 'template',
    selector: '[data-design-lab-root="paragraph:cards"]',
    children: [],
    html: page(
      render(
        'paragraph',
        'paragraph--cards.html.twig',
        '<style>.a{}</style><div class="a" style="height:20px;width:40px">x</div>',
      ),
    ),
  },
  {
    name: 'two renders are both tagged',
    id: 'paragraph:cards',
    kind: 'template',
    selector: '',
    children: [],
    html: page(
      render('paragraph', 'paragraph--cards.html.twig', '<div style="height:20px">a</div>') +
        render('paragraph', 'paragraph--cards.html.twig', '<div style="height:30px">b</div>'),
    ),
  },
  {
    name: 'a hidden root is revealed through its hidden ancestors',
    id: 'paragraph:cards',
    kind: 'template',
    selector: '',
    children: [],
    html: page(
      '<section hidden><div style="display:none">' +
        render('paragraph', 'paragraph--cards.html.twig', '<p style="height:20px">x</p>') +
        '</div></section>',
    ),
  },
  {
    name: 'no matching render tags nothing',
    id: 'paragraph:missing',
    kind: 'template',
    selector: '',
    children: [],
    html: page(render('paragraph', 'paragraph--cards.html.twig', '<div style="height:20px">x</div>')),
  },
  {
    name: 'children are tagged inside their parent, without revealing',
    id: 'block:hero',
    kind: 'template',
    selector: '',
    children: ['paragraph:child', 'sdc.demo.alpha', 'block:inner'],
    html: page(
      render(
        'block',
        'block--hero.html.twig',
        '<div style="height:50px">' +
          render('paragraph', 'paragraph--child.html.twig', '<i style="display:block;height:5px">c</i>') +
          '<b hidden>' +
          render('block', 'block--inner.html.twig', '<u style="height:5px">h</u>') +
          '</b></div>',
      ),
    ),
  },
  {
    name: 'a selector with a tall match is left alone',
    id: 'sdc.demo.alpha',
    kind: 'class',
    selector: '.alpha',
    children: [],
    html: page('<div class="alpha" style="height:30px">x</div>'),
  },
  {
    name: 'a selector with only hidden matches reveals the first',
    id: 'sdc.demo.alpha',
    kind: 'class',
    selector: '.alpha',
    children: [],
    html: page(
      '<div hidden><div class="alpha" style="display:none">x</div></div><div class="alpha" style="display:none">y</div>',
    ),
  },
  {
    name: 'a selector with no match reveals nothing',
    id: 'sdc.demo.alpha',
    kind: 'class',
    selector: '.absent',
    children: [],
    html: page('<div class="alpha">x</div>'),
  },
];

async function run(browserPage: Page, html: string, script: string): Promise<{ result: unknown; dom: string }> {
  await browserPage.setContent(html);
  const result = await browserPage.evaluate(script);
  return { result, dom: await browserPage.evaluate(() => document.body.innerHTML) };
}

test('typed browser scripts match the baseline text on the same pages', async () => {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } }),
      browserPage = await context.newPage();
    for (const c of cases) {
      const own = c.kind === 'template' ? 'template' : 'reveal';
      const before = await run(browserPage, c.html, legacyOwnScript(c.id, own, c.selector, c.children));
      const after = await run(browserPage, c.html, ownScript(c.id, c.kind, c.selector, c.children));
      assert.deepEqual(after.result, before.result, `${c.name}: result`);
      assert.equal(after.dom, before.dom, `${c.name}: page`);
    }
    // The cases above must actually exercise tagging and revealing, not agree on nothing.
    const tagged = await run(browserPage, cases[0]!.html, ownScript('paragraph:cards', 'template', '', []));
    assert.deepEqual(tagged.result, { tagged: 1, revealed: 0 });
    assert.match(tagged.dom, /data-design-lab-root="paragraph:cards"/);
    const revealed = await run(browserPage, cases[2]!.html, ownScript('paragraph:cards', 'template', '', []));
    assert.deepEqual(revealed.result, { tagged: 1, revealed: 2 });
    assert.match(revealed.dom, /data-design-lab-revealed/);
    const kids = await run(
      browserPage,
      cases[4]!.html,
      ownScript('block:hero', 'template', '', ['paragraph:child', 'sdc.demo.alpha', 'block:inner']),
    );
    assert.match(kids.dom, /data-design-lab-child="paragraph:child"/);
    assert.doesNotMatch(kids.dom, /data-design-lab-child="block:inner"/);
    await context.close();
  } finally {
    await browser.close();
  }
});
