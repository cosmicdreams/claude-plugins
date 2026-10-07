// Generated from schemas/tree.schema.json. Do not edit.

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
              [k: string]: unknown;
            };
      };
      [k: string]: unknown;
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
                [k: string]: unknown;
              };
        };
        [k: string]: unknown;
      };
    };
    tree: TreeNode;
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}
export interface TreeNode {
  kind: "frame" | "text" | "image" | "svg" | "instance";
  name: string;
  source: string;
  sizing: string;
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
    [k: string]: unknown;
  };
  radius?: number[];
  clip?: boolean;
  fit?: string;
  src?: string;
  text?: Text;
  layout?: Layout;
  instanceOf?: string;
  svg?: string;
  effects?: {
    type?: string;
    color?: Color;
    x?: number;
    y?: number;
    blur?: number;
    spread?: number;
    [k: string]: unknown;
  }[];
  visible?: boolean | VariableBinding;
  absolute?: boolean;
  opacity?: number;
  backgroundImage?: {
    src?: string;
    fit?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
export interface VariableBinding {
  var: string;
  [k: string]: unknown;
}
export interface Color {
  hex: string;
  opacity?: number;
  var?: string | null;
  [k: string]: unknown;
}
export interface Text {
  align?: string;
  case?: string;
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
  [k: string]: unknown;
}
export interface Layout {
  mode: string;
  counterAlign?: string;
  primaryAlign?: string;
  gap?: number | VariableBinding;
  counterGap?: number | VariableBinding;
  padding?: {
    top?: number | VariableBinding;
    right?: number | VariableBinding;
    bottom?: number | VariableBinding;
    left?: number | VariableBinding;
    [k: string]: unknown;
  };
  wrap?: boolean;
  slots?: boolean;
  fellBack?: boolean;
  [k: string]: unknown;
}
