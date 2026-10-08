/** Optional reflection fields: dumps inspect every node kind, including page roots. */
export type DumpNode = BaseNode &
  Partial<
    Pick<
      FrameNode,
      | 'x'
      | 'y'
      | 'width'
      | 'height'
      | 'layoutMode'
      | 'paddingTop'
      | 'paddingRight'
      | 'paddingBottom'
      | 'paddingLeft'
      | 'itemSpacing'
      | 'layoutSizingHorizontal'
      | 'layoutSizingVertical'
      | 'fills'
      | 'strokes'
      | 'cornerRadius'
      | 'boundVariables'
    > &
      Pick<ComponentNode, 'componentPropertyDefinitions' | 'variantProperties' | 'description' | 'documentationLinks'> &
      Pick<TextNode, 'characters' | 'fontName' | 'fontSize' | 'lineHeight' | 'textStyleId'> &
      ChildrenMixin
  >;
export interface Binding {
  id?: string;
  type?: string;
  [field: string]: unknown;
}
export interface ResolvedBindings {
  [field: string]: string | null | (string | null)[] | ResolvedBindings;
}
export interface BreakpointNode {
  id: string;
  name: string;
  type: SceneNode['type'];
  width: number;
  mainComponentId: string | null;
  mainComponentSetId?: string | null;
  instance?: InstanceNode | null;
  explicitModes: Record<string, string>;
}
