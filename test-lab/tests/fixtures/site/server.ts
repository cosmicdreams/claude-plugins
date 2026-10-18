// A small generic fixture site for test-lab's own tests. No client code, names or content.
//
//   /            home page with a heading and a link to the accordion page
//   /accordion   an accordion: a serif component title above sans-serif item rows
//   /health      the health page the outage breaker probes
//   /broken      a template error: HTTP 500 while /health still answers

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const page = (title: string, body: string, style = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{font-family:Arial,Helvetica,sans-serif}${style}</style></head><body>${body}</body></html>`;

const PAGES: Record<string, { status: number; html: string }> = {
  '/': { status: 200, html: page('Example home', '<h1>Example home</h1><a href="/accordion">Accordion</a>') },
  '/accordion': {
    status: 200,
    html: page(
      'Accordion example',
      '<section class="accordion"><h2 class="accordion__title">Frequently asked</h2>' +
        '<button class="accordion__item">First question</button><button class="accordion__item">Second question</button></section>',
      '.accordion__title{font-family:Georgia,"Times New Roman",serif}.accordion__item{font-family:Arial,Helvetica,sans-serif}',
    ),
  },
  '/health': { status: 200, html: page('OK', '<p>ok</p>') },
  '/broken': { status: 500, html: page('Error', '<p>The website encountered an unexpected error.</p>') },
};

export type AccordionMutation = '' | 'title' | 'rows' | 'inverse';
export type FixtureSite = { url: string; server: Server; setAccordionMutation: (mutation: AccordionMutation) => void; close: () => Promise<void> };

export async function startSite(port = 0): Promise<FixtureSite> {
  let accordionMutation: AccordionMutation = '';
  const server = createServer((req, res) => {
    const found = PAGES[(req.url ?? '/').split('?')[0] ?? '/'];
    res.writeHead(found?.status ?? 404, { 'content-type': 'text/html; charset=utf-8' });
    let html = found?.html ?? page('Not found', '<p>not found</p>');
    if ((req.url ?? '').split('?')[0] === '/accordion') {
      const title = accordionMutation === 'title' || accordionMutation === 'inverse' ? '.accordion__title{font-family:Arial !important}' : '';
      const rows = accordionMutation === 'rows' || accordionMutation === 'inverse' ? '.accordion__item{font-family:Georgia !important}' : '';
      html = html.replace('</style>', title + rows + '</style>');
    }
    res.end(html);
  });
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
  const { port: bound } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${bound}`,
    server,
    setAccordionMutation: mutation => { accordionMutation = mutation; },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

if (import.meta.main) {
  const site = await startSite(Number(process.env['PORT'] ?? 4180));
  console.log(`fixture site at ${site.url}`);
}
