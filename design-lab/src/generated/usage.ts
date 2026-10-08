// Generated from schemas/usage.schema.json. Do not edit.

export interface Usage {
  standardVersion: string;
  toolVersion: string;
  generatedAt: string;
  source: {
    strategy: string;
    scope: string;
    definitions: {
      placements?: string;
      structuralRefs?: string;
      templatePlacements?: string;
    };
    ddevProject?: null | string;
    approot?: string;
    population?: {
      siteStudioLayouts?: number;
      paragraphInstances?: number;
      blockContentEntities?: number;
      nodes?: number;
      layoutBuilderSections?: number;
      publishedPages?: number;
      pagePlacementRows?: number;
      templateNodes?: number;
      siteStudioTemplates?: number;
    };
    exampleVerification?: {
      baseUrl?: string;
      pagesFetched?: number;
      anonymous?: boolean;
      twigDebug?: boolean;
    };
    renderedVerification?: {
      baseUrl?: string;
      pathsSelected?: number;
      pagesFetched?: number;
      pathsFailed?: string[];
    };
    root?: string;
  };
  usage: {
    [k: string]: {
      placements: number;
      structuralRefs: number;
      pages: number;
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
      templates?: string[];
    };
  };
  problems: {
    check?: string;
    detail?: string;
    evidence?: string[];
  }[];
}
