// Replace PAGE_ID, then run once per page through parallel read-only use_figma calls.
const page = await figma.getNodeByIdAsync('PAGE_ID');
if (!page || page.type !== 'PAGE') throw new Error('PAGE_ID did not resolve to a page');
await figma.setCurrentPageAsync(page);
const CONTAINER = new Set(['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET', 'SECTION']);
const DEFAULT_LAYER = /^(Frame|Group|Rectangle|Ellipse|Text|Vector|Line|Polygon|Star|Component|Slice)( \d+)?$/;
const components = page.findAllWithCriteria({types: ['COMPONENT_SET', 'COMPONENT']})
  .filter(node => node.type === 'COMPONENT_SET' || node.parent.type !== 'COMPONENT_SET')
  .map(node => {
    const descendants = node.findAll(() => true);
    const texts = descendants.filter(child => child.type === 'TEXT');
    return {
      id: node.id,
      name: node.name,
      page: page.name,
      pageId: page.id,
      description: node.description,
      docLinks: (node.documentationLinks || []).length,
      type: node.type,
      variantCount: node.type === 'COMPONENT_SET' ? node.children.length : 1,
      boundVariableCount: [node, ...descendants].filter(child =>
        child.boundVariables && Object.keys(child.boundVariables).length > 0).length,
      rootHasImageFill: Array.isArray(node.fills) &&
        node.fills.some(fill => fill.type === 'IMAGE'),
      imageCount: [node, ...descendants].filter(child => Array.isArray(child.fills) &&
        child.fills.some(fill => fill.type === 'IMAGE')).length,
      nestedInstanceCount: descendants.filter(child => child.type === 'INSTANCE').length,
      componentProperties: Object.entries(node.componentPropertyDefinitions || {})
        .map(([name, definition]) => ({name, type: definition.type})),
      visibleTextCount: texts.length,
      schemaLabelCount: texts.filter(child =>
        /^(field|caption|placeholder|required|optional|constraint|default)\s*:/i
          .test(child.characters.trim())).length,
    };
  });
const cards = page.findAll(node => {
  if (node.type !== 'FRAME') return false;
  if (/ — documentation$/.test(node.name)) return true;
  const descendants = node.findAll(() => true);
  const names = descendants.map(child => child.name).join('\n');
  const text = descendants.filter(child => child.type === 'TEXT')
    .map(child => child.characters).join('\n');
  return /anatomy/i.test(names + '\n' + text) &&
    /breakpoint|production breakpoints/i.test(names + '\n' + text);
}).map(node => {
  const children = CONTAINER.has(node.type) ? node.findAll(() => true) : [];
  const text = children.filter(child => child.type === 'TEXT')
    .map(child => child.characters).join('\n');
  const names = children.map(child => child.name).join('\n');
  const sections = [];
  if (/component name|head/i.test(names)) sections.push('Head');
  if (/when to use/i.test(names + '\n' + text)) sections.push('When to use');
  if (/anatomy/i.test(names + '\n' + text)) sections.push('Anatomy');
  if (/relationship|source truth/i.test(names + '\n' + text)) sections.push('Relationships');
  if (/breakpoint|production breakpoints/i.test(names + '\n' + text))
    sections.push('Breakpoint evidence');
  if (/configuration|native component/i.test(names + '\n' + text))
    sections.push('Configuration');
  if (/live path|example/i.test(names + '\n' + text)) sections.push('Example');
  const breakpointImages = children.filter(child => Array.isArray(child.fills) &&
    child.fills.some(fill => fill.type === 'IMAGE') &&
    /screenshot|shot/i.test(child.name));
  return {
    name: node.name,
    pageId: page.id,
    defaultNamedLayers: children.filter(child => DEFAULT_LAYER.test(child.name)).length,
    sections,
    hasPreviewImage: breakpointImages.length >= 3,
    breakpointScreenshotCount: breakpointImages.length,
    breakpointLabels: children.filter(child => child.type === 'TEXT' &&
      /(desktop|tablet|mobile).*(px|×|x)/i.test(child.characters))
      .map(child => child.characters),
    rejectedHeadingCount: (text.match(/How it renders|Source fidelity|Source defects|Across breakpoints/gi) || []).length,
    rootRelativeExampleCount: (text.match(/(?:^|\s)\/[a-z0-9][a-z0-9/_-]*/gi) || []).length,
    urlLinkCount: children.filter(child => child.type === 'TEXT' && child.hyperlink &&
      child.hyperlink.type === 'URL').length,
  };
});
const breakpointFrames = page.findAll(node => node.type === 'FRAME' && /^(shot|scale):/.test(node.name))
  .map(node => ({
    name: node.name,
    width: Math.round(node.width),
    height: Math.round(node.height),
    hasImage: Array.isArray(node.fills) && node.fills.some(fill => fill.type === 'IMAGE'),
    labelWidth: (() => {
      const text = node.parent?.findAll(child => child.type === 'TEXT')
        .map(child => child.characters).join(' ');
      const match = text?.match(/(\d+)\s*[×x]\s*\d+\s*px/);
      return match ? Number(match[1]) : null;
    })(),
  }));
return {page: {id: page.id, name: page.name, children: page.children.length},
        components, cards, breakpointFrames};
