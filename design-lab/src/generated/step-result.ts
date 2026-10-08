// Generated from schemas/step-result.schema.json. Do not edit.

export interface StepResult {
  statuses?: number[];
  file?: string;
  png?: string;
  pairs?: {
    label: string | null;
    changed: number;
    height: number;
    width: number;
    heightDelta?: number;
    ratio: number;
    pass?: boolean;
    ratioUnmasked?: number;
    textMasked?: number;
    widthDelta?: number;
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
  pass?: boolean;
  metric?: string;
}
