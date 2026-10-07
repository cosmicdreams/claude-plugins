// Generated from schemas/plan.schema.json. Do not edit.

export interface Plan {
  standardVersion: string;
  plans: {
    id: string;
    variantAxes: {
      field?: string;
      label?: string;
      options?: number;
    }[];
    variants: number;
    properties: {
      field?: string;
      treatment?: string;
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
      }[];
    };
    verdict: "build" | "map" | "document" | "refuse";
    label?: string;
    naiveVariants?: number;
    flags?: {
      field?: string;
      note?: string;
    }[];
    skippedFields?: string[];
    refuseReason?: string | null;
    defects?: {
      kind?: string;
      detail?: string;
      evidence?: string;
    }[];
  }[];
  generatedAt?: string;
  maxVariants?: number;
}
