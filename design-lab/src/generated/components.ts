// Generated from schemas/components.schema.json. Do not edit.

/**
 * External site configuration or third-party JSON values, with explicitly typed recursive values.
 */
export type JsonValue =
  | (string | number | boolean | null)
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };

export interface Components {
  standardVersion: string;
  toolVersion: string;
  generatedAt: string;
  source: {
    strategy: string;
    root: string;
    configDir?: string | null;
    config?: string | null;
    sdcParser?: string;
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
              [k: string]: JsonValue;
            };
            uri?: string;
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
            value?: string | number;
            label?: string;
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
    }[];
    slots: {
      accepts?: string[] | string;
      cardinality?: number;
      label?: string;
      name?: string;
      required?: boolean;
      sourceRef?: string;
    }[];
    defects: {
      detail?: string;
      evidence?: string;
      kind?: string;
    }[];
    description?: string | null;
    group?: string | null;
    category?: string;
    aliases?: string[];
    usage?: {
      placements?: number | null;
      structuralRefs?: number | null;
      pages?: number;
      unpublishedInstances?: number;
      inlineBlockEntities?: number;
      configPlacedBlocks?: number;
      orphanInstances?: number;
      examples?: {
        url?: string;
        path?: string;
        marker?: string;
        markerKind?: string;
        markerUniqueToThisComponent?: boolean;
        instancesOnPage?: number;
        status?: number;
        anonymous?: boolean;
        verifiedAt?: string;
      }[];
      noExampleReason?: string | null;
      tier?: string;
      source?: string;
      measuredAt?: string;
      exampleCandidates?: string[];
      templatePlacements?: number;
      templateBundles?: string[];
      templateRefs?: (
        | {
            file?: string;
            line?: number;
            global?: boolean;
          }
        | string
      )[];
      globalTemplate?: boolean;
      renderedPages?: number;
      renderedInstances?: number;
      renderedExamples?: string[];
      structuralReferences?: number | null;
      tierReason?: string;
      status?: string;
    } | null;
    status?: boolean | string | null;
    containedBy?: string[];
    isCustomComponent?: boolean;
    sourceSdcId?: string;
    componentVersion?: string | number | null;
    canvasRef?: string;
    folder?: string;
    folderRef?: string;
    provenance?: {
      definition?: string;
      label?: string;
      componentVersion?: string;
      group?: string;
    };
  }[];
  totals?: {
    all?: number;
    blocks?: number;
    paragraphs?: number;
    withDefects?: number;
    placements?: number;
    structuralRefs?: number;
  };
  problems?: {
    check?: string;
    detail?: string;
    evidence?: string[];
  }[];
}
