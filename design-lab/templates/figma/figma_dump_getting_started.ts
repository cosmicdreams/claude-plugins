import { DL_API } from "../../src/figma/types.ts";
export async function template(ARGS: Record<string, never>) {
// DESIGN_LAB_TEMPLATE_BEGIN
// Replace PAGE_ID with the Getting Started page id, then run read-only through use_figma.
const page = await figma.getNodeByIdAsync('PAGE_ID');
if (!page || page.type !== 'PAGE') throw new Error('PAGE_ID did not resolve to a page');
await figma.setCurrentPageAsync(page);
const section = (name: string) => {
  const container = page.findAll(node => node.type === 'FRAME' && node.name === name)[0] as FrameNode | undefined;
  return container ? container.findAll(node => node.type === 'TEXT')
    .map(node => (node as TextNode).characters).join('\n') : null;
};
const index = page.findAll(node => /^index$/i.test(node.name) &&
  (node as FrameNode).children?.some(child => child.name === 'Header'))[0] as FrameNode | undefined;
const indexTexts = index ? index.findAll(node => node.type === 'TEXT') as TextNode[] : [];
// table() puts each heading in a cell frame inside the `Header` row, so read the cells of
// the first header row in order. Long, tiered indexes repeat the header for scanability;
// verification cares about column order, not how often it is repeated.
const header = (index ? index.findOne(node => node.name === 'Header' && 'children' in node) : null) as FrameNode | null;
const headings = header ? header.children
  .map(cell => (cell.type === 'TEXT' ? cell : (cell as FrameNode).findOne?.(node => node.type === 'TEXT')))
  .filter(Boolean)
  .map(node => (node as TextNode).characters.trim()) : [];
const links = indexTexts.filter(node => node.hyperlink &&
  ((node.hyperlink as HyperlinkTarget).type === 'NODE' || (node.hyperlink as HyperlinkTarget).type === 'URL'))
  .map(node => ({text: node.characters, type: (node.hyperlink as HyperlinkTarget).type,
                value: (node.hyperlink as HyperlinkTarget).value}));
const root = page.findOne(node => node.getSharedPluginData('designlab', 'role') === 'getting-started') as FrameNode | null;
return {gettingStarted: {
  sections: root ? root.children.map(node => node.name) : [],
  indexRowCount: index ? index.children.filter(node => /^row\b/i.test(node.name)).length : null,
  knownGapsText: section('Known gaps'),
  thresholdsText: section('How this file is organised'),
  indexHeadings: headings,
  indexNodeLinks: links,
}};

// DESIGN_LAB_TEMPLATE_END
}
