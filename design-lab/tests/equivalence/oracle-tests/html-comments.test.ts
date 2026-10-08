import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComponents } from '../../../src/find-rendered-components.ts';
import { parseHtml } from '../../../src/html-parser.ts';
import { pyJson, PYTHON } from './python-oracle.ts';

// Malformed and abrupt comment fixtures. The expected results come from the Python reference
// (html.parser, feed() without close()) run on the same strings, not from hand-written values.
const FIXTURES = [
  '<!--><div data-component-id="demo:card"></div>-->',
  '<!--><div data-component-id="demo:card"></div>',
  '<!---><div data-component-id="demo:card"></div>',
  '<!-->',
  '<!--->',
  '<!-- -- -->',
  '<!-- -- --><div data-component-id="demo:card"></div>',
  '<!--',
  '<!--x',
  '<!--x--><div data-component-id="demo:card"></div>',
  '<!--<div data-component-id="demo:card"></div>--><div data-component-id="demo:b"></div>',
  '<!--a--!><i data-component-id="demo:bang"></i>',
  '<!-- x --><b>y</b>',
  '<!---->' + '<p data-component-id="demo:empty"></p>',
  '<!--x-->-->' + '<p data-component-id="demo:tail"></p>',
  '<!-- a -- b -->\n<section data-component-id="demo:after"></section>',
];

const PY_TAGS = `
import html.parser
from find_rendered_components import parse_components
class Events(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.events = []
    def handle_starttag(self, tag, attrs):
        self.events.append(['start', tag, [list(a) for a in attrs]])
    def handle_startendtag(self, tag, attrs):
        self.events.append(['startend', tag, [list(a) for a in attrs]])
    def handle_endtag(self, tag):
        self.events.append(['end', tag])
results = []
for text in _input['cases']:
    parser = Events(); parser.feed(text)
    results.append({'components': parse_components(text), 'events': parser.events})
print(json.dumps(results))
`;

function tsEvents(text: string): unknown[] {
  const events: unknown[] = [];
  parseHtml(text, {
    starttag: (tag, attrs) => events.push(['start', tag, attrs]),
    startendtag: (tag, attrs) => events.push(['startend', tag, attrs]),
    endtag: (tag) => events.push(['end', tag]),
    data() {},
  });
  return events;
}

test('abrupt and malformed comments match Python html.parser component counts and tag events', (t) => {
  const version = pyJson<string>(`print(json.dumps(sys.version))`);
  if (!version.startsWith('3.14.')) {
    t.skip(`the Python reference must be 3.14 (DESIGN_LAB_PYTHON=${PYTHON}, found ${version})`);
    return;
  }
  const reference = pyJson<Array<{ components: Record<string, number>; events: unknown[] }>>(PY_TAGS, {
    cases: FIXTURES,
  });
  FIXTURES.forEach((text, index) => {
    assert.deepEqual(parseComponents(text), reference[index]!.components, `components for ${JSON.stringify(text)}`);
    assert.deepEqual(tsEvents(text), reference[index]!.events, `tag events for ${JSON.stringify(text)}`);
  });
});

test('abrupt comment fixture renders the component that Python 3.14 reports', () => {
  assert.deepEqual(parseComponents('<!--><div data-component-id="demo:card"></div>-->'), { 'demo:card': 1 });
});
