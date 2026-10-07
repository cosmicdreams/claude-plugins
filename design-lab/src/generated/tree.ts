// Generated from schemas/tree.schema.json. Do not edit.

/**
 * Discriminated nodes. Historical auto-sized text labels may omit width/height; frame children/layout and paint bindings remain optional. A frame may carry instanceOf to request native nesting with its measured fallback.
 */
export type TreeNode = FrameNode | TextNode | ImageNode | SvgNode | InstanceNode;

export interface Tree {
  component: string;
  machineName: string;
  label: string;
  measured: string[];
  modes: string[];
  fallbacks: string[];
  notes: string[];
  widths: {
    [k: string]: number;
  };
  variables: {
    [k: string]: {
      type: "FLOAT" | "BOOLEAN" | "COLOR" | "STRING";
      values: {
        [k: string]:
          | number
          | boolean
          | string
          | {
              r: number;
              g: number;
              b: number;
              a?: number;
            };
      };
    };
  };
  tree: TreeNode;
  alternates?: {
    label: string;
    parent?: string;
    variables: {
      [k: string]: {
        type: "FLOAT" | "BOOLEAN" | "COLOR" | "STRING";
        values: {
          [k: string]:
            | number
            | boolean
            | string
            | {
                r: number;
                g: number;
                b: number;
                a?: number;
              };
        };
      };
    };
    tree: TreeNode;
  }[];
}
export interface FrameNode {
  kind: "frame";
  name: string;
  source: string;
  sizing: "FIXED" | "FILL" | "HUG";
  width?: number | VariableBinding;
  height?: number | VariableBinding;
  x?: number;
  y?: number;
  children?: TreeNode[];
  fill?: Color;
  stroke?: {
    color?: Color;
    width?: number;
    weights?: number[];
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  radius?: number[];
  clip?: boolean;
  fit?: "FIT" | "FILL" | "CROP" | "TILE";
  src?: string;
  text?: Text;
  layout?: Layout;
  instanceOf?: string;
  svg?: string;
  effects?: {
    type: "DROP_SHADOW" | "INNER_SHADOW";
    color: Color;
    x: number;
    y: number;
    blur: number;
    spread: number;
  }[];
  visible?: boolean | VariableBinding;
  absolute?: boolean;
  opacity?: number;
  backgroundImage?: {
    src: string;
    /**
     * CSS background-size; converted to FIT/FILL, never assigned directly to a Figma enum.
     */
    fit?: string;
  };
}
export interface VariableBinding {
  var: string;
}
export interface Color {
  hex: string;
  opacity?: number;
  var?: string | null;
}
export interface Text {
  align?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  case?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
  characters: string;
  color?: Color;
  family: string;
  familyVar?: string | null;
  italic?: boolean;
  letterSpacing?: number | VariableBinding;
  lineHeight?: (number | VariableBinding) | null;
  singleLine?: boolean;
  size: number | VariableBinding;
  stack?: string;
  underline?: boolean;
  weight: number;
}
export interface Layout {
  mode: "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
  counterAlign?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  primaryAlign?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  gap?: number | VariableBinding;
  counterGap?: number | VariableBinding;
  padding?: {
    top?: number | VariableBinding;
    right?: number | VariableBinding;
    bottom?: number | VariableBinding;
    left?: number | VariableBinding;
  };
  wrap?: boolean;
  slots?: boolean;
  fellBack?: boolean;
}
export interface TextNode {
  kind: "text";
  name: string;
  source: string;
  sizing: "FIXED" | "FILL" | "HUG";
  width?: number | VariableBinding;
  height?: number | VariableBinding;
  x?: number;
  y?: number;
  children?: TreeNode[];
  fill?: Color;
  stroke?: {
    color?: Color;
    width?: number;
    weights?: number[];
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  radius?: number[];
  clip?: boolean;
  fit?: "FIT" | "FILL" | "CROP" | "TILE";
  src?: string;
  text: Text;
  layout?: Layout;
  instanceOf?: string;
  svg?: string;
  effects?: {
    type: "DROP_SHADOW" | "INNER_SHADOW";
    color: Color;
    x: number;
    y: number;
    blur: number;
    spread: number;
  }[];
  visible?: boolean | VariableBinding;
  absolute?: boolean;
  opacity?: number;
  backgroundImage?: {
    src: string;
    /**
     * CSS background-size; converted to FIT/FILL, never assigned directly to a Figma enum.
     */
    fit?: string;
  };
}
export interface ImageNode {
  kind: "image";
  name: string;
  source: string;
  sizing: "FIXED" | "FILL" | "HUG";
  width?: number | VariableBinding;
  height?: number | VariableBinding;
  x?: number;
  y?: number;
  children?: TreeNode[];
  fill?: Color;
  stroke?: {
    color?: Color;
    width?: number;
    weights?: number[];
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  radius?: number[];
  clip?: boolean;
  fit?: "FIT" | "FILL" | "CROP" | "TILE";
  src: string;
  text?: Text;
  layout?: Layout;
  instanceOf?: string;
  svg?: string;
  effects?: {
    type: "DROP_SHADOW" | "INNER_SHADOW";
    color: Color;
    x: number;
    y: number;
    blur: number;
    spread: number;
  }[];
  visible?: boolean | VariableBinding;
  absolute?: boolean;
  opacity?: number;
  backgroundImage?: {
    src: string;
    /**
     * CSS background-size; converted to FIT/FILL, never assigned directly to a Figma enum.
     */
    fit?: string;
  };
}
export interface SvgNode {
  kind: "svg";
  name: string;
  source: string;
  sizing: "FIXED" | "FILL" | "HUG";
  width?: number | VariableBinding;
  height?: number | VariableBinding;
  x?: number;
  y?: number;
  children?: TreeNode[];
  fill?: Color;
  stroke?: {
    color?: Color;
    width?: number;
    weights?: number[];
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  radius?: number[];
  clip?: boolean;
  fit?: "FIT" | "FILL" | "CROP" | "TILE";
  src?: string;
  text?: Text;
  layout?: Layout;
  instanceOf?: string;
  svg: string;
  effects?: {
    type: "DROP_SHADOW" | "INNER_SHADOW";
    color: Color;
    x: number;
    y: number;
    blur: number;
    spread: number;
  }[];
  visible?: boolean | VariableBinding;
  absolute?: boolean;
  opacity?: number;
  backgroundImage?: {
    src: string;
    /**
     * CSS background-size; converted to FIT/FILL, never assigned directly to a Figma enum.
     */
    fit?: string;
  };
}
export interface InstanceNode {
  kind: "instance";
  name: string;
  source: string;
  sizing: "FIXED" | "FILL" | "HUG";
  width?: number | VariableBinding;
  height?: number | VariableBinding;
  x?: number;
  y?: number;
  children?: TreeNode[];
  fill?: Color;
  stroke?: {
    color?: Color;
    width?: number;
    weights?: number[];
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  radius?: number[];
  clip?: boolean;
  fit?: "FIT" | "FILL" | "CROP" | "TILE";
  src?: string;
  text?: Text;
  layout?: Layout;
  instanceOf: string;
  svg?: string;
  effects?: {
    type: "DROP_SHADOW" | "INNER_SHADOW";
    color: Color;
    x: number;
    y: number;
    blur: number;
    spread: number;
  }[];
  visible?: boolean | VariableBinding;
  absolute?: boolean;
  opacity?: number;
  backgroundImage?: {
    src: string;
    /**
     * CSS background-size; converted to FIT/FILL, never assigned directly to a Figma enum.
     */
    fit?: string;
  };
}
