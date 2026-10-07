import type { Binding, BreakpointNode } from "../../src/figma/dump-types.ts";
import { DL_API } from "../../src/figma/types.ts";
export async function template(ARGS: Record<string, never>) {
// DESIGN_LAB_TEMPLATE_BEGIN
// Replace PAGE_ID, then run once per page through parallel read-only use_figma calls.
const page = await figma.getNodeByIdAsync('PAGE_ID');
if (!page || page.type !== 'PAGE') throw new Error('PAGE_ID did not resolve to a page');
await figma.setCurrentPageAsync(page);
const DEFAULT_LAYER = /^(Frame|Group|Rectangle|Ellipse|Text|Vector|Line|Polygon|Star|Component|Slice)( \d+)?$/;
const breakpointCollection = (await DL_API.collections())
  // 'Breakpoint' is the name before 0.15.1.
  // `<Brand> Breakpoint` since 0.22.1; 'Core Breakpoint' and 'Breakpoint' before.
  .find(item => item.modes.some(m => /^Desktop \d+px$/.test(m.name)))
  || (await DL_API.collections()).find(item => /(^| )Breakpoint$/.test(item.name));
const breakpointVariableIds = new Set(breakpointCollection?.variableIds || []);
const varyingVariableIds = new Set<string>();
const geometryVariableIds = new Set<string>();
const variableNames = new Map<string, string>();
for (const id of breakpointVariableIds) {
  const variable = await figma.variables.getVariableByIdAsync(id);
  if (variable) variableNames.set(id, variable.name);
  // Per-component measured geometry has no code name; a folded design token does.
  if (variable && !(variable.codeSyntax && variable.codeSyntax.WEB)) geometryVariableIds.add(id);
  if (variable && new Set(Object.values(variable.valuesByMode || {}).map(JSON.stringify as unknown as (value: VariableValue, index: number, array: VariableValue[]) => string)).size > 1)
    varyingVariableIds.add(id);
}
function boundToBreakpoint(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if ((value as Binding).id && breakpointVariableIds.has((value as Binding).id as string)) return true;
  return Object.values(value).some(boundToBreakpoint);
}
// A design token, not design-lab's own per-component breakpoint geometry (which has no code name).
function boundToToken(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if ((value as Binding).id && (value as Binding).type === 'VARIABLE_ALIAS' && !geometryVariableIds.has((value as Binding).id as string)) return true;
  return Object.values(value).some(boundToToken);
}
function boundToVarying(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if ((value as Binding).id && varyingVariableIds.has((value as Binding).id as string)) return true;
  return Object.values(value).some(boundToVarying);
}
const components = page.findAllWithCriteria({types: ['COMPONENT_SET', 'COMPONENT']})
  .filter(node => node.type === 'COMPONENT_SET' || node.parent!.type !== 'COMPONENT_SET')
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
      tokenBoundCount: [node, ...descendants].filter(child =>
        boundToToken(child.boundVariables)).length,
      breakpointBoundCount: [node, ...descendants].filter(child =>
        boundToBreakpoint(child.boundVariables)).length,
      variesByWidth: [node, ...descendants].some(child =>
        boundToVarying(child.boundVariables)),
      responsiveVariableCount: (breakpointCollection?.variableIds || []).filter(id => {
        const stem = node.name.split(' — ')[0]!.split('.').pop();
        return variableNames.get(id)?.startsWith(`${stem}/`);
      }).length,
      rootHasImageFill: Array.isArray(node.fills) &&
        node.fills.some(fill => fill.type === 'IMAGE'),
      imageCount: [node, ...descendants].filter(child => Array.isArray((child as GeometryMixin).fills) &&
        ((child as GeometryMixin).fills as readonly Paint[]).some(fill => fill.type === 'IMAGE')).length,
      nestedInstanceCount: descendants.filter(child => child.type === 'INSTANCE').length,
      componentProperties: Object.entries(node.componentPropertyDefinitions || {})
        .map(([name, definition]) => ({name, type: definition.type})),
      visibleTextCount: texts.length,
      schemaLabelCount: texts.filter(child =>
        /^(field|caption|placeholder|required|optional|constraint|default)\s*:/i
          .test((child as TextNode).characters.trim())).length,
    };
  });
const cards = (page.findAll(node => (node.type === 'FRAME' &&
  node.getSharedPluginData('designlab', 'component') &&
  node.name.includes(' · ')) as boolean) as (SceneNode & ChildrenMixin)[]).map((block: SceneNode & ChildrenMixin) => {
  const machine = block.getSharedPluginData('designlab', 'component');
  const node = block.findOne(child => child.type === 'FRAME' &&
    child.name === `Documentation · ${machine}`) as FrameNode | null;
  const children = node ? node.findAll(() => true) : [];
  const text = children.filter(child => child.type === 'TEXT')
    .map(child => (child as TextNode).characters).join('\n');
  const sections = node ? node.children.map(child => child.name) : [];
  const captures = block.findAll(child => child.type === 'RECTANGLE' &&
    /^Capture · /.test(child.name));
  const breakpointImages = captures.filter(child => Array.isArray((child as GeometryMixin).fills) &&
    ((child as GeometryMixin).fills as readonly Paint[]).some(fill => fill.type === 'IMAGE'));
  const specimen = block.findOne(child => child.type === 'FRAME' && child.name === 'Specimen') as FrameNode | null;
  const shown = specimen?.findOne(child => child.type === 'FRAME' &&
    child.name === 'Component at each width') as FrameNode | null;
  const breakpointNodes: BreakpointNode[] = shown ? shown.children.map(child => ({
    id: child.id, name: child.name, type: child.type, width: Math.round((child as LayoutMixin).width),
    mainComponentId: null,
    instance: child.type === 'INSTANCE' ? child : null,
    explicitModes: (child as SceneNode & { explicitVariableModes?: Record<string,string> }).explicitVariableModes || {},
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
      /(desktop|tablet|mobile).*px/i.test((child as TextNode).characters)).map(child => (child as TextNode).characters),
    breakpointNodes,
    rejectedHeadingCount: 0,
    // `/`, the home page, counts: a component in the site's chrome has it as its example.
    rootRelativeExampleCount: (text.match(/(?:^|\s)\/[a-z0-9][a-z0-9/_-]*|example\W*\/(?=[\s.,;)]|$)/gi) || []).length,
    urlLinkCount: children.filter(child => child.type === 'TEXT' && (child as TextNode).hyperlink &&
      ((child as TextNode).hyperlink as HyperlinkTarget).type === 'URL').length,
  };
});
const breakpointFrames = (page.findAll(node => node.type === 'FRAME' && /^(shot|scale):/.test(node.name)) as (SceneNode & LayoutMixin & GeometryMixin)[])
  .map((node: SceneNode & LayoutMixin & GeometryMixin) => ({
    name: node.name,
    width: Math.round(node.width),
    height: Math.round(node.height),
    hasImage: Array.isArray(node.fills) && node.fills.some(fill => fill.type === 'IMAGE'),
    labelWidth: (() => {
      const text = (node.parent as (BaseNode & ChildrenMixin) | null)?.findAll(child => child.type === 'TEXT')
        .map(child => (child as TextNode).characters).join(' ');
      const match = text?.match(/(\d+)\s*[×x]\s*\d+\s*px/);
      return match ? Number(match[1]) : null;
    })(),
  }));
const exampleInvalidNodes: { name: string; type: SceneNode["type"] }[] = [];
if (page.name === 'Examples') {
  function inspect(node: SceneNode) {
    if (!['FRAME', 'TEXT', 'INSTANCE'].includes(node.type))
      exampleInvalidNodes.push({name: node.name, type: node.type});
    if (node.type !== 'INSTANCE' && 'children' in node)
      node.children.forEach(inspect);
  }
  page.children.forEach(inspect);
}
// Dynamic-page document access (the runner) forbids the synchronous `mainComponent`.
for (const card of cards) {
  for (const item of card.breakpointNodes) {
    if (item.instance) {
      const main = await item.instance.getMainComponentAsync();
      item.mainComponentId = main?.id || null;
      item.mainComponentSetId = main?.parent?.type === 'COMPONENT_SET' ? main.parent.id : null;
    }
    delete item.instance;
  }
}
return {page: {id: page.id, name: page.name, children: page.children.length},
        components, cards, breakpointFrames,
        exampleInvalidNodes,
        breakpointCollection: breakpointCollection ? {id: breakpointCollection.id, name: breakpointCollection.name,
          modes: breakpointCollection.modes.map(mode => ({id: mode.modeId, name: mode.name}))} : null};

// DESIGN_LAB_TEMPLATE_END
}
