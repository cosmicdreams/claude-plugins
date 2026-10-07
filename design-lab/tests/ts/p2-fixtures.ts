import type { MeasuredNode, Spec } from '../../src/generated/spec.ts';
export function node(path = '/div[0]', x = 0, y = 0, width = 100, height = 50, computed: Record<string, string> = {}, extra: Partial<MeasuredNode> = {}): MeasuredNode {
  return { path, tag: 'div', classes: [], id: null, attributes: {}, text: null, box: { x, y, width, height }, computed: { display: 'block', backgroundColor: 'transparent', position: 'static', visibility: 'visible', opacity: '1', ...computed }, declared: {}, before: null, after: null, svg: null, image: null, inlineText: null, ...extra };
}
export function spec(by: Record<string, MeasuredNode[]>, component = 'X'): Spec {
  return { component, machineName: component.toLowerCase(), source: null, path: '/x', verificationUrl: 'https://x.test/x', linkUrl: 'https://x.test/x', rootSelector: '#x',
    measurements: Object.fromEntries(Object.entries(by).map(([bp, nodes]) => [bp + ':default', { rootBox: { width: nodes[0]!.box.width, height: nodes[0]!.box.height }, nodes }])) };
}
