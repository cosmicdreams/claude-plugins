// Generated from schemas/step-result.schema.json. Do not edit.

export interface StepResult {
  statuses?: number[];
  file?: string;
  png?: string;
  pairs?: {
    label: string;
    changed: number;
    height: number;
    width: number;
    heightDelta?: number;
    ratio: number;
    pass?: boolean;
    [k: string]: unknown;
  }[];
  threshold?: number;
  tolerance?: number;
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
  pass?: boolean;
  [k: string]: unknown;
}
