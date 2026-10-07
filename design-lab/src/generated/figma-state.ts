// Generated from schemas/figma-state.schema.json. Do not edit.

export type FigmaState =
  | {
      fileKey: string;
    }
  | {
      fileKey: string;
      standardVersion: string;
      siteUrl: string;
      canonicalBaseUrl: string;
      runtime: string;
      offlineImages?: boolean;
      planned?: string[];
      steps: {
        id: string;
      }[];
      done: string[];
      emittedCollections?: string[];
      iterate?: boolean;
      subset?: string[];
      preflightCover?: string;
      built?: string[];
      buildId?: string;
      executionRevision?: string;
    };
