// Replace PAGE_ID, then run once per page through parallel read-only use_figma calls.
const page = await figma.getNodeByIdAsync('PAGE_ID');
if (!page || page.type !== 'PAGE') throw new Error('PAGE_ID did not resolve to a page');
await figma.setCurrentPageAsync(page);
const DEFAULT_LAYER = /^(Frame|Group|Rectangle|Ellipse|Text|Vector|Line|Polygon|Star|Component|Slice)( \d+)?$/;
const breakpointCollection = (await figma.variables.getLocalVariableCollectionsAsync())
  .find(item => item.name === 'Breakpoint');
const breakpointVariableIds = new Set(breakpointCollection?.variableIds || []);
const varyingVariableIds = new Set();
const variableNames = new Map();
for (const id of breakpointVariableIds) {
  const variable = await figma.variables.getVariableByIdAsync(id);
  if (variable) variableNames.set(id, variable.name);
  if (variable && new Set(Object.values(variable.valuesByMode || {}).map(JSON.stringify)).size > 1)
    varyingVariableIds.add(id);
}
function boundToBreakpoint(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.id && breakpointVariableIds.has(value.id)) return true;
  return Object.values(value).some(boundToBreakpoint);
}
function boundToVarying(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.id && varyingVariableIds.has(value.id)) return true;
  return Object.values(value).some(boundToVarying);
}
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
      variantNames: node.type === 'COMPONENT_SET' ? node.children.map(child => child.name) : [],
      variantCount: node.type === 'COMPONENT_SET' ? node.children.length : 1,
      boundVariableCount: [node, ...descendants].filter(child =>
        child.boundVariables && Object.keys(child.boundVariables).length > 0).length,
      breakpointBoundCount: [node, ...descendants].filter(child =>
        boundToBreakpoint(child.boundVariables)).length,
      variesByWidth: [node, ...descendants].some(child =>
        boundToVarying(child.boundVariables)),
      responsiveVariableCount: (breakpointCollection?.variableIds || []).filter(id => {
        const stem = node.name.split(' — ')[0].split('.').pop();
        return variableNames.get(id)?.startsWith(`${stem}/`);
      }).length,
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
const cards = page.findAll(node => node.type === 'FRAME' &&
  node.getSharedPluginData('designlab', 'component') &&
  node.name.includes(' · ')).map(block => {
  const machine = block.getSharedPluginData('designlab', 'component');
  const node = block.findOne(child => child.type === 'FRAME' &&
    child.name === `Documentation · ${machine}`);
  const children = node ? node.findAll(() => true) : [];
  const text = children.filter(child => child.type === 'TEXT')
    .map(child => child.characters).join('\n');
  const sections = node ? node.children.map(child => child.name) : [];
  const captures = block.findAll(child => child.type === 'RECTANGLE' &&
    /^Capture · /.test(child.name));
  const breakpointImages = captures.filter(child => Array.isArray(child.fills) &&
    child.fills.some(fill => fill.type === 'IMAGE'));
  const specimen = block.findOne(child => child.type === 'FRAME' && child.name === 'Specimen');
  const shown = specimen?.findOne(child => child.type === 'FRAME' &&
    child.name === 'Component at each width');
  const breakpointNodes = shown ? shown.children.map(child => ({
    id: child.id, name: child.name, type: child.type, width: Math.round(child.width),
    mainComponentId: child.type === 'INSTANCE' ? child.mainComponent?.id || null : null,
    explicitModes: child.explicitVariableModes || {},
  })) : [];
  return {
    id: node?.id || null,
    name: node?.name || '',
    blockId: block.id,
    blockName: block.name,
    component: machine,
    order: block.getSharedPluginData('designlab', 'order'),
    pageId: page.id,
    defaultNamedLayers: block.findAll(child => DEFAULT_LAYER.test(child.name)).length,
    sections,
    hasPreviewImage: breakpointImages.length >= 3,
    breakpointScreenshotCount: breakpointImages.length,
    captureLabels: captures.map(child => child.name.replace(/^Capture · /, '')),
    breakpointLabels: block.findAll(child => child.type === 'TEXT' &&
      /(desktop|tablet|mobile).*px/i.test(child.characters)).map(child => child.characters),
    breakpointNodes,
    rejectedHeadingCount: 0,
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
const exampleInvalidNodes = [];
if (page.name === 'Examples') {
  function inspect(node) {
    if (!['FRAME', 'TEXT', 'INSTANCE'].includes(node.type))
      exampleInvalidNodes.push({name: node.name, type: node.type});
    if (node.type !== 'INSTANCE' && 'children' in node)
      node.children.forEach(inspect);
  }
  page.children.forEach(inspect);
}
return {page: {id: page.id, name: page.name, children: page.children.length},
        components, cards, breakpointFrames,
        exampleInvalidNodes,
        breakpointCollection: breakpointCollection ? {id: breakpointCollection.id, name: breakpointCollection.name,
          modes: breakpointCollection.modes.map(mode => ({id: mode.modeId, name: mode.name}))} : null};
