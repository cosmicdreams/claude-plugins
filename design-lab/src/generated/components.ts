// Generated from schemas/components.schema.json. Do not edit.

export interface Components {
  standardVersion: string;
  toolVersion: string;
  generatedAt: string;
  source: {
    strategy: string;
    root: string;
    [k: string]: unknown;
  };
  components: {
    id: string;
    machineName?: string;
    label: string;
    sourceRef: string;
    fields: {
      appliesToken?: null;
      canvasFieldType?: string;
      cardinality?: number;
      default?:
        | boolean
        | number
        | null
        | {
            options?: {
              [k: string]: unknown;
            };
            uri?: string;
            [k: string]: unknown;
          }
        | string;
      defaultSource?: string;
      description?: null | string;
      kind?: string;
      label?: string;
      maxItems?: number | null;
      minItems?: number;
      name?: string;
      options?:
        | {
            [k: string]: unknown;
          }[]
        | null;
      optionsSource?: string;
      provenance?: {
        default?: string;
        kind?: string;
        label?: string;
        options?: string;
        required?: string;
        sourceWidget?: string;
        [k: string]: unknown;
      };
      repeatableIn?: string;
      required?: boolean;
      showWhen?: null | string;
      sourceRef?: string;
      sourceType?: string;
      sourceWidget?: null | string;
      targetBundles?: string[] | null;
      targetType?: null | string;
      tokenFamily?: null | string;
      uid?: string;
      [k: string]: unknown;
    }[];
    slots: {
      accepts?: string[] | string;
      cardinality?: number;
      label?: string;
      name?: string;
      required?: boolean;
      sourceRef?: string;
      [k: string]: unknown;
    }[];
    defects: {
      detail?: string;
      evidence?: string;
      kind?: string;
      [k: string]: unknown;
    }[];
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}
