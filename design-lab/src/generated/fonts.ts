// Generated from schemas/fonts.schema.json. Do not edit.

export interface Fonts {
  families: {
    family: string;
    cssFamily: string;
    source: string;
    components: number;
    uses: {
      weight: number;
      italic: boolean;
      face: string | null;
      [k: string]: unknown;
    }[];
    available?: boolean | null;
    figmaFamily?: string | null;
    standIn?: {
      family: string;
      default?: boolean;
      reason?: string;
      [k: string]: unknown;
    };
    route?: {
      kind: string;
      steps: string[];
      note?: string;
      [k: string]: unknown;
    };
    adobeKit?: string;
    note?: string;
    [k: string]: unknown;
  }[];
  unrendered: {
    family: string;
    why: string;
    [k: string]: unknown;
  }[];
  icons: string[];
  kits: {
    [k: string]: boolean;
  };
  figmaChecked: boolean;
  generatedAt?: string;
  build: {
    families: {
      [k: string]: {
        family: string | null;
        standIn: boolean;
        faces: {
          [k: string]: string;
        };
        variable: {
          [k: string]: number;
        };
        display: string;
        [k: string]: unknown;
      };
    };
    stacks: {
      [k: string]: {
        family?: string;
        icon?: string;
        ranges?: number[][] | null;
        otherwise?: string;
        [k: string]: unknown;
      };
    };
    skip: string[];
    icons: string[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
