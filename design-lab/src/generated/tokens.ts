// Generated from schemas/tokens.schema.json. Do not edit.

export type Tokens = {
  [k: string]: unknown;
} & {
  standardVersion: string;
  toolVersion: string;
  /**
   * @minItems 1
   */
  tokens?: [
    {
      codeName?: null | string;
      codePath?: string;
      description?: string;
      family?: string;
      isAlias?: boolean;
      layer?: string;
      media?: string | null;
      name?: string;
      provenance?: {
        kind?: string;
        ref?: string;
        [k: string]: unknown;
      };
      raw?: string;
      selector?: string;
      value?: string;
      valuesByMode?: {
        [k: string]: string;
      };
      [k: string]: unknown;
    },
    ...{
      codeName?: null | string;
      codePath?: string;
      description?: string;
      family?: string;
      isAlias?: boolean;
      layer?: string;
      media?: string | null;
      name?: string;
      provenance?: {
        kind?: string;
        ref?: string;
        [k: string]: unknown;
      };
      raw?: string;
      selector?: string;
      value?: string;
      valuesByMode?: {
        [k: string]: string;
      };
      [k: string]: unknown;
    }[]
  ];
  colors?: {
    className?: string;
    codeName?: string;
    hex?: string;
    inUse?: boolean;
    name?: string;
    provenance?: {
      kind?: string;
      ref?: string;
      [k: string]: unknown;
    };
    tags?: string[];
    uid?: string;
    [k: string]: unknown;
  }[];
  schemes?: unknown[];
  spacing?: unknown[];
  type?: unknown[];
  radii?: unknown[];
  elevation?: unknown[];
  motion?: unknown[];
  [k: string]: unknown;
};
