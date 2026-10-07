// Generated from schemas/detection.schema.json. Do not edit.

export interface Detection {
  root: string;
  componentSources: Strategy[];
  tokenSources: Strategy[];
  usageSources: Strategy[];
  recommended: {
    [k: string]: unknown;
  };
  priorArt: unknown[];
  [k: string]: unknown;
}
export interface Strategy {
  strategy: string;
  [k: string]: unknown;
}
