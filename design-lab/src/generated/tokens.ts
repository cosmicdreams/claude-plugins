// Generated from schemas/tokens.schema.json. Do not edit.

export type Tokens = (
  | {
      /**
       * @minItems 1
       */
      tokens: [
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
          };
          raw?: string;
          selector?: string;
          value?: string;
          valuesByMode?: {
            [k: string]: string;
          };
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
          };
          raw?: string;
          selector?: string;
          value?: string;
          valuesByMode?: {
            [k: string]: string;
          };
        }[]
      ];
    }
  | {
      colors: {
        className?: string;
        codeName?: string;
        hex?: string | null;
        inUse?: boolean;
        name?: string | null;
        provenance?: {
          kind?: string;
          ref?: string;
        };
        tags?: (string | null)[];
        uid?: string;
      }[];
    }
  | {
      spacing: string[];
    }
  | {
      type: string[];
    }
  | {
      radii: string[];
    }
  | {
      elevation: string[];
    }
  | {
      motion: string[];
    }
) & {
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
      };
      raw?: string;
      selector?: string;
      value?: string;
      valuesByMode?: {
        [k: string]: string;
      };
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
      };
      raw?: string;
      selector?: string;
      value?: string;
      valuesByMode?: {
        [k: string]: string;
      };
    }[]
  ];
  colors?: {
    className?: string;
    codeName?: string;
    hex?: string | null;
    inUse?: boolean;
    name?: string | null;
    provenance?: {
      kind?: string;
      ref?: string;
    };
    tags?: (string | null)[];
    uid?: string;
  }[];
  schemes?: string[];
  spacing?: string[];
  type?: string[];
  radii?: string[];
  elevation?: string[];
  motion?: string[];
  generatedAt?: string;
  source?: {
    strategy?: string;
    root?: string;
    stylesheets?: string[];
    librariesFiles?: string[];
    ignoredNotLoaded?: string[];
    configDir?: string;
    entities?: {
      colors?: number;
      fontStacks?: number;
      scssVariables?: number;
      customStyles?: number;
    };
    files?: string[];
    maps?: string[];
  };
  modes?: string[];
  modeRationale?: string;
  typeScaling?: {
    observable?: boolean;
    noneScale?: boolean | null;
    reason?: string;
    roleLevelCaveat?: string;
    fontSizeTokens?: number;
    scaling?: number;
  };
  totals?: {
    tokens?: number;
    base?: number;
    component?: number;
    shadowed?: number;
    byFamily?: {
      color?: number;
      "font-family"?: number;
      "font-size"?: number;
      "font-weight"?: number;
      "letter-spacing"?: number;
      "line-height"?: number;
      motion?: number;
      number?: number;
      radius?: number;
      spacing?: number;
      breakpoint?: number;
      "container-width"?: number;
      flag?: number;
      unknown?: number;
    };
  };
  shadowed?: {
    name?: string;
    value?: string;
    layer?: string;
    provenance?: {
      kind?: string;
      ref?: string;
    };
    codeName?: string | null;
    raw?: string;
    family?: string;
    isAlias?: boolean;
    codePath?: string;
    description?: string;
  }[];
  problems?: {
    check?: string;
    detail?: string;
    evidence?: string[];
    sourceRef?: string;
    kind?: string;
    ref?: string;
  }[];
  fontStacks?: {
    name?: string | null;
    uid?: string;
    stack?: string;
    primaryFamily?: string;
    codeName?: string;
    systemFont?: boolean;
    inUse?: boolean;
    provenance?: {
      kind?: string;
      ref?: string;
    };
  }[];
  scssVariables?: {
    name?: string | null;
    uid?: string | null;
    value?: string | number | boolean | null;
    codeName?: string;
    inUse?: boolean;
    provenance?: {
      kind?: string;
      ref?: string;
    };
  }[];
  customStyles?: {
    name?: string | null;
    codeName?: string | null;
    property?: string;
    family?: string;
    valuesByBreakpoint?: {
      [k: string]: string | number | boolean | null;
    };
    provenance?: {
      kind?: string;
      ref?: string;
    };
  }[];
  sourcesWithVariables?: {
    source?: string;
    variables?: number;
  }[];
};
