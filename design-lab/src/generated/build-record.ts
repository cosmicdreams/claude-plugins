// Generated from schemas/build-record.schema.json. Do not edit.

/**
 * External site configuration or third-party JSON values, with explicitly typed recursive values.
 */
export type JsonValue =
  | (string | number | boolean | null)
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };

export interface BuildRecord {
  standardVersion: string;
  toolVersion: string;
  id: string;
  figma: {
    fileKey: string;
    pageId: string;
    documentationCardId: string;
    componentId?: string;
    componentSetId?: string;
    pageName?: string;
    blockId?: string;
  };
  visualEvidence: {
    path: string;
    /**
     * @minItems 3
     */
    captureFiles: [string, string, string, ...string[]];
    /**
     * @minItems 1
     */
    states: [string, ...string[]];
    breakpoints: {
      desktop: BreakpointEvidence;
      tablet: BreakpointEvidence;
      mobile: BreakpointEvidence;
    };
    comparison: {
      verdict: "pass" | "fail" | "not-run";
      reviewedAt?: string;
      breakpoints: {
        desktop: "pass" | "fail" | "not-run";
        tablet: "pass" | "fail" | "not-run";
        mobile: "pass" | "fail" | "not-run";
      };
      metrics?: StepResult;
    };
  };
  documentation: {
    anatomy: {
      fields: DocumentationField[];
      relationships: DocumentationRelationship[];
      emptyReason?: string;
    };
    breakpointScreenshots: {
      desktop: string;
      tablet: string;
      mobile: string;
    };
  };
  nativeComponent: {
    nodeType: "COMPONENT" | "COMPONENT_SET";
    rootHasImageFill: false;
    componentProperties: {
      name?: string;
      type?: string;
    }[];
    nestedInstances: {
      instanceNodeIds?: string[];
      sourceId?: string;
    }[];
    validation: {
      nativeNode: boolean;
      noScreenshotSurrogate: boolean;
      authoringCoverage: boolean;
      relationshipCoverage: boolean;
    };
  };
  assertions: {
    component?: {
      verdict?: string;
      componentId?: string;
      geometry?: {
        captures?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
        specimen?: {
          height?: number;
          width?: number;
        };
        variants?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
      };
      count?: number;
      collectionId?: string;
      bound?: number;
      literal?: number;
      fellBack?: string[];
      statuses?: number[];
      expected?: number;
      failed?: {
        src?: string;
        error?: string;
      }[];
      missing?: string[];
      breakpoints?: {
        mobile?: string;
        tablet?: string;
        desktop?: string;
      };
    };
    variables?: {
      verdict?: string;
      componentId?: string;
      geometry?: {
        captures?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
        specimen?: {
          height?: number;
          width?: number;
        };
        variants?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
      };
      count?: number;
      collectionId?: string | null;
      bound?: number;
      literal?: number;
      fellBack?: string[];
      statuses?: number[];
      expected?: number;
      failed?: {
        src?: string;
        error?: string;
      }[];
      missing?: string[];
      breakpoints?: {
        mobile?: string;
        tablet?: string;
        desktop?: string;
      };
    };
    bindings?: {
      verdict?: string;
      componentId?: string;
      geometry?: {
        captures?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
        specimen?: {
          height?: number;
          width?: number;
        };
        variants?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
      };
      count?: number;
      collectionId?: string;
      bound?: number;
      literal?: number;
      fellBack?: string[];
      statuses?: number[];
      expected?: number;
      failed?: {
        src?: string;
        error?: string;
      }[];
      missing?: string[];
      breakpoints?: {
        mobile?: string;
        tablet?: string;
        desktop?: string;
      };
    };
    "image-upload"?: {
      verdict?: string;
      componentId?: string;
      geometry?: {
        captures?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
        specimen?: {
          height?: number;
          width?: number;
        };
        variants?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
      };
      count?: number;
      collectionId?: string;
      bound?: number;
      literal?: number;
      fellBack?: string[];
      statuses?: number[];
      expected?: number;
      failed?: {
        src?: string;
        error?: string;
      }[];
      missing?: string[];
      breakpoints?: {
        mobile?: string;
        tablet?: string;
        desktop?: string;
      };
    };
    "breakpoint-evidence"?: {
      verdict?: string;
      componentId?: string;
      geometry?: {
        captures?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
        specimen?: {
          height?: number;
          width?: number;
        };
        variants?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
      };
      count?: number;
      collectionId?: string;
      bound?: number;
      literal?: number;
      fellBack?: string[];
      statuses?: number[];
      expected?: number;
      failed?: {
        src?: string;
        error?: string;
      }[];
      missing?: string[];
      breakpoints?: {
        mobile?: string;
        tablet?: string;
        desktop?: string;
      };
    };
    "evidence-upload"?: {
      verdict?: string;
      componentId?: string;
      geometry?: {
        captures?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
        specimen?: {
          height?: number;
          width?: number;
        };
        variants?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
      };
      count?: number;
      collectionId?: string;
      bound?: number;
      literal?: number;
      fellBack?: string[];
      statuses?: number[];
      expected?: number;
      failed?: {
        src?: string;
        error?: string;
      }[];
      missing?: string[];
      breakpoints?: {
        mobile?: string;
        tablet?: string;
        desktop?: string;
      };
    };
    "visual-comparison"?: {
      verdict?: string;
      componentId?: string;
      geometry?: {
        captures?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
        specimen?: {
          height?: number;
          width?: number;
        };
        variants?: {
          height?: number;
          label?: string;
          width?: number;
          x?: number;
          y?: number;
        }[];
      };
      count?: number;
      collectionId?: string;
      bound?: number;
      literal?: number;
      fellBack?: string[];
      statuses?: number[];
      expected?: number;
      failed?: {
        src?: string;
        error?: string;
      }[];
      missing?: string[];
      breakpoints?: {
        mobile?: string;
        tablet?: string;
        desktop?: string;
      };
    };
  };
  sourceHash: string;
  built?: {
    variables?: number;
    created?: number;
    bindings?: number;
    literals?: number;
    fellBack?: string[];
    collectionId?: string | null;
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
    nestedMismatch?: {
      images?: number[];
      name?: string;
      sourceId?: string;
      texts?: number[];
    }[];
    images?: {
      fit?: string;
      id?: string;
      src?: string;
    }[];
    svgFailures?: string[];
  };
  sourceRef?: string;
  sourceHashBasis?: string;
}
export interface BreakpointEvidence {
  captureFile: string;
  viewportWidth: number;
  state?: string;
}
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
export interface DocumentationField {
  field: string;
  kind: string;
  required: boolean;
  default: JsonValue;
  options?: unknown[] | null;
  figmaTreatment: string;
  figmaProperty?: string;
}
export interface DocumentationRelationship {
  field: string;
  /**
   * Legacy bare string forms (including any) remain serialized in older receipts; slot_accepts normalizes them when used.
   */
  accepts: [string, ...string[]] | string;
  cardinality: number;
  required: boolean;
  rendered: boolean;
  renderedAccepts?: string[];
  renderedEvidence?: string;
}
