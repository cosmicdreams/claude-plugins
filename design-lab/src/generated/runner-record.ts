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
      [k: string]: unknown;
    }[];
    variants?: {
      x: number;
      y: number;
      width: number;
      height: number;
      [k: string]: unknown;
    }[];
    specimen?: {
      width: number;
      height: number;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  native?: {
    [k: string]: unknown;
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
    [k: string]: string;
  };
  images?: {
    id: string;
    src: string;
    fit?: string;
    [k: string]: unknown;
  }[];
  nested?: {
    id: string;
    sourceId: string;
    [k: string]: unknown;
  }[];
  nestedMismatch?: (
    | {
        [k: string]: unknown;
      }
    | string
  )[];
  svgFailures?: (
    | {
        [k: string]: unknown;
      }
    | string
  )[];
  fellBack?: (
    | {
        [k: string]: unknown;
      }
    | string
  )[];
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
      [k: string]: unknown;
    };
  };
  aliasMisses?: (
    | {
        [k: string]: unknown;
      }
    | string
  )[];
  unplanned?: (
    | {
        [k: string]: unknown;
      }
    | string
  )[];
  pages?: {
    [k: string]: string;
  };
  foreign?: (
    | {
        [k: string]: unknown;
      }
    | string
  )[];
  coverId?: string;
  font?: string;
  fontLoaded?: boolean;
  nameOnly?: boolean;
  pageId?: string;
  pluginData?: boolean;
  clearedCover?: number;
  kept?: (
    | {
        [k: string]: unknown;
      }
    | string
  )[];
  removedCollections?: string[];
  removedPages?: string[];
};
export type BuildResult1 = {
  [k: string]: unknown;
};

export interface Screenshot {
  png: string;
}
export interface EmptySkip {
  [k: string]: unknown;
}
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
    [k: string]: unknown;
  }[];
}
export interface TreeDump {
  page: string;
  pageIndex: number;
  nodes: {
    [k: string]: unknown;
  }[];
  _ids: {
    [k: string]: unknown;
  };
}
export interface PageDump {
  page: {
    id: string;
    name: string;
    children: number;
  };
  components: {
    [k: string]: unknown;
  }[];
  cards: {
    [k: string]: unknown;
  }[];
  breakpointFrames: {
    [k: string]: unknown;
  }[];
  exampleInvalidNodes: {
    [k: string]: unknown;
  }[];
  breakpointCollection: {
    [k: string]: unknown;
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
