// Generated from schemas/runner-record.schema.json. Do not edit.

/**
 * Direct POST /record body. The receiver must also validate the definition selected by the expected step kind; the union alone cannot authorize a different kind. No unrestricted fallback.
 */
export type RunnerRecord =
  BuildResult | Screenshot | EmptySkip | Check | RootDump | TreeDump | PageDump | GettingStartedDump | UploadResult;
export type BuildResult = BuildResult1 & {
  width?: number;
  height?: number;
  blockId?: string;
  docId?: string;
  evidenceIds?: string[];
  geometry?: {
    captures?: {
      x: number;
      y: number;
      width: number;
      height: number;
      label?: string;
    }[];
    variants?: {
      x: number;
      y: number;
      width: number;
      height: number;
      label?: string;
    }[];
    specimen?: {
      width: number;
      height: number;
    };
  };
  native?: {
    nodeType?: string;
    rootHasImageFill?: boolean;
    nestedInstances?: {
      instanceId?: string;
      mainComponentId?: string | null;
      sourceId?: string | null;
    }[];
    documentedFields?: (string | null)[];
  };
  setId?: string;
  specimenId?: string;
  collectionId?: string;
  componentId?: string;
  variantId?: string;
  bound?: number;
  created?: number;
  literal?: number;
  variables?: number;
  updated?: number;
  fonts?: {
    [k: string]: string;
  };
  missingFonts?: string[];
  standIns?: {
    [k: string]: string;
  };
  styleFallbacks?: {
    [k: string]: string;
  };
  iconText?: {
    [k: string]: string | number;
  };
  images?: {
    id: string;
    src: string;
    fit?: string;
  }[];
  nested?: {
    id: string;
    sourceId: string;
  }[];
  nestedMismatch?: {
    sourceId?: string;
    name?: string;
    texts?: number[];
    images?: number[];
  }[];
  svgFailures?: string[];
  fellBack?: string[];
  rootId?: string;
  headerId?: string;
  componentsId?: string;
  missing?: string[];
  instances?: number;
  rows?: number;
  collections?: {
    [k: string]: {
      id: string;
      modes: string[];
      variables: number;
    };
  };
  aliasMisses?: string[];
  unplanned?: string[];
  pages?: {
    [k: string]: string;
  };
  foreign?: string[];
  coverId?: string;
  font?: string;
  fontLoaded?: boolean;
  nameOnly?: boolean;
  pageId?: string;
  pluginData?: boolean;
  clearedCover?: number;
  kept?: string[];
  removedCollections?: string[];
  removedPages?: string[];
};
export type BuildResult1 =
  | {
      pages: {
        [k: string]: string;
      };
    }
  | {
      collections: {
        [k: string]: {
          id: string;
          modes: string[];
          variables: number;
        };
      };
    }
  | {
      componentId: string;
    }
  | {
      blockId: string;
    }
  | {
      rootId: string;
    }
  | {
      coverId: string;
    }
  | {
      removedPages: string[];
    };
export type ResolvedBinding =
  | (string | null)
  | (string | null)[]
  | {
      [k: string]: ResolvedBinding;
    };

export interface Screenshot {
  png: string;
}
export interface EmptySkip {}
export interface Check {
  fileKey: string;
  fileName: string;
  pages: number;
  empty: boolean;
  preflightCover: boolean;
  fonts: {
    [k: string]: string[];
  };
}
export interface RootDump {
  pages: {
    id: string;
    name: string;
  }[];
  collections: {
    name?: string;
    modes?: string[];
    variables?: {
      name?: string;
      description?: string;
      type?: string;
      scopes?: string[];
      web?: string | null;
      valuesByMode?: {
        [k: string]:
          | string
          | number
          | boolean
          | {
              r: number;
              g: number;
              b: number;
              a?: number;
            }
          | {
              type: "VARIABLE_ALIAS";
              id: string;
            };
      };
    }[];
  }[];
}
export interface TreeDump {
  page: string;
  pageIndex: number;
  nodes: {
    x?: number | null;
    y?: number | null;
    width?: number | null;
    height?: number | null;
    paddingTop?: number | null;
    paddingRight?: number | null;
    paddingBottom?: number | null;
    paddingLeft?: number | null;
    itemSpacing?: number | null;
    cornerRadius?: number | null;
    fontSize?: number | null;
    layoutMode?: string | null;
    layoutSizingHorizontal?: string | null;
    layoutSizingVertical?: string | null;
    characters?: string | null;
    textStyle?: string | null;
    path?: string;
    type?: string;
    fills?: {
      type?: string;
      visible?: boolean;
      color?: string | null;
      boundVariables?: {
        [k: string]: ResolvedBinding;
      };
    }[];
    strokes?: {
      type?: string;
      visible?: boolean;
      color?: string | null;
      boundVariables?: {
        [k: string]: ResolvedBinding;
      };
    }[];
    fontName?: {
      family?: string;
      style?: string;
      variationSettings?: {
        [k: string]: number;
      };
    } | null;
    lineHeight?: {
      unit?: string;
      value?: number;
    } | null;
    componentPropertyDefinitions?: {
      [k: string]: {
        type?: string;
        defaultValue?: string | boolean | null;
        preferredValues?: {
          type?: string;
        }[];
        description?: string;
      };
    };
    variantProperties?: {
      [k: string]: string;
    };
    description?: string;
    documentationLinks?: string[];
    boundVariables?: {
      [k: string]: ResolvedBinding;
    };
  }[];
  _ids: {
    page?: string;
    nodes?: {
      [k: string]: string;
    };
  };
}
export interface PageDump {
  page: {
    id: string;
    name: string;
    children: number;
  };
  components: {
    id?: string;
    name?: string;
    page?: string;
    pageId?: string;
    description?: string;
    type?: string;
    docLinks?: number;
    variantCount?: number;
    boundVariableCount?: number;
    tokenBoundCount?: number;
    breakpointBoundCount?: number;
    responsiveVariableCount?: number;
    imageCount?: number;
    nestedInstanceCount?: number;
    visibleTextCount?: number;
    schemaLabelCount?: number;
    variesByWidth?: boolean;
    rootHasImageFill?: boolean;
    variantNames?: string[];
    componentProperties?: {
      name?: string;
      type?: string;
    }[];
  }[];
  cards: {
    name?: string;
    blockId?: string;
    blockName?: string;
    component?: string;
    order?: string;
    pageId?: string;
    id?: string | null;
    defaultNamedLayers?: number;
    breakpointScreenshotCount?: number;
    rejectedHeadingCount?: number;
    rootRelativeExampleCount?: number;
    urlLinkCount?: number;
    sections?: string[];
    hasPreviewImage?: boolean;
    captureLabels?: string[];
    breakpointLabels?: string[];
    breakpointNodes?: {
      id?: string;
      name?: string;
      type?: string;
      width?: number;
      mainComponentId?: string | null;
      mainComponentSetId?: string | null;
      explicitModes?: {
        [k: string]: string;
      };
    }[];
  }[];
  breakpointFrames: {
    name?: string;
    width?: number;
    height?: number;
    hasImage?: boolean;
    labelWidth?: number | null;
  }[];
  exampleInvalidNodes: {
    name?: string;
    type?: string;
  }[];
  breakpointCollection: {
    id?: string;
    name?: string;
    modes?: {
      id?: string;
      name?: string;
    }[];
  } | null;
}
export interface GettingStartedDump {
  gettingStarted: {
    sections: string[];
    indexRowCount: number | null;
    knownGapsText: string | null;
    thresholdsText: string | null;
    indexHeadings: string[];
    indexNodeLinks: {
      text: string;
      type: "NODE" | "URL";
      value: string;
    }[];
  };
}
export interface UploadResult {
  statuses: number[];
}
