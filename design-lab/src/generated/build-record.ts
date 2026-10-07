// Generated from schemas/build-record.schema.json. Do not edit.

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
    [k: string]: unknown;
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
      [k: string]: unknown;
    };
    comparison: {
      verdict: "pass" | "fail" | "not-run";
      reviewedAt?: string;
      breakpoints: {
        desktop: "pass" | "fail" | "not-run";
        tablet: "pass" | "fail" | "not-run";
        mobile: "pass" | "fail" | "not-run";
        [k: string]: unknown;
      };
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  documentation: {
    anatomy: {
      fields: DocumentationField[];
      relationships: DocumentationRelationship[];
      emptyReason?: string;
      [k: string]: unknown;
    };
    breakpointScreenshots: {
      desktop: string;
      tablet: string;
      mobile: string;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  nativeComponent: {
    nodeType: "COMPONENT" | "COMPONENT_SET";
    rootHasImageFill: false;
    componentProperties: unknown[];
    nestedInstances: {
      instanceNodeIds?: string[];
      sourceId?: string;
      [k: string]: unknown;
    }[];
    validation: {
      nativeNode: boolean;
      noScreenshotSurrogate: boolean;
      authoringCoverage: boolean;
      relationshipCoverage: boolean;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  assertions: {
    [k: string]: unknown;
  };
  sourceHash: string;
  [k: string]: unknown;
}
export interface BreakpointEvidence {
  captureFile: string;
  viewportWidth: number;
  state?: string;
  [k: string]: unknown;
}
export interface DocumentationField {
  field: string;
  kind: string;
  required: boolean;
  default: unknown;
  options?: unknown[] | null;
  figmaTreatment: string;
  figmaProperty?: string;
  [k: string]: unknown;
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
  [k: string]: unknown;
}
