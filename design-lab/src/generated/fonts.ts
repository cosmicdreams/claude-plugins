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
    }[];
    available?: boolean | null;
    figmaFamily?: string | null;
    standIn?: {
      family: string;
      default?: boolean;
      reason?: string;
    };
    route?: {
      kind: string;
      steps: string[];
      note?: string;
      foundry?: string | null;
      licence?: string;
    };
    adobeKit?: string;
    note?: string;
  }[];
  unrendered: {
    family: string;
    why: string;
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
      };
    };
    stacks: {
      [k: string]: {
        family?: string;
        icon?: string;
        ranges?: number[][] | null;
        otherwise?: string;
      };
    };
    skip: string[];
    icons: string[];
  };
}
