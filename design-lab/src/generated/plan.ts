// Generated from schemas/plan.schema.json. Do not edit.

export interface Plan {
  standardVersion: string;
  plans: {
    id: string;
    variantAxes: {
      field?: string;
      label?: string;
      options?: number;
      [k: string]: unknown;
    }[];
    variants: number;
    properties: {
      field?: string;
      treatment?: string;
      [k: string]: unknown;
    }[];
    libraryRole: "component" | "subcomponent" | "schema-only" | "retirement";
    visualIdentity: "independent" | "embedded" | "unverified" | "none";
    visualEvidence: {
      captured: boolean;
      renderSignals: boolean;
      path: null | string;
      states: string[];
      images: {
        file?: string;
        hash?: string;
        height?: number;
        state?: string;
        viewport?: string;
        width?: number;
        [k: string]: unknown;
      }[];
      [k: string]: unknown;
    };
    verdict: "build" | "map" | "document" | "refuse";
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}
