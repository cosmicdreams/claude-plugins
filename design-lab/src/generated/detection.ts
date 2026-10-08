// Generated from schemas/detection.schema.json. Do not edit.

export interface Detection {
  root: string;
  componentSources: Strategy[];
  tokenSources: Strategy[];
  usageSources: Strategy[];
  recommended: {
    component?: string | null;
    token?: string | null;
    usage?: string | null;
  };
  priorArt: {
    path: string;
    kind: string;
  }[];
  docroot?: string;
  configSync?: string | null;
  configCandidates?: {
    path?: string;
    entityCount?: number;
  }[];
  notes?: string[];
  siteStudio?: {
    configDir?: string | null;
    configFrom?: string | null;
    problem?: string | null;
    declared?: {
      file: string;
      line: number;
      path: string | null;
      expression: string;
      exists: boolean;
    }[];
    families?: {
      [k: string]: number;
    };
    components?: number;
    customStyles?: number;
    customComponents?: string[];
    customComponentProblems?: {
      kind: string;
      detail: string;
    }[];
    customComponentsFromActiveExtensionsOnly?: boolean;
  };
}
export interface Strategy {
  strategy: string;
  count?: number;
  blocks?: number;
  paragraphs?: number;
  evidence?: string;
  withEnumProps?: number;
  withSlots?: number;
  filesWithVars?: number;
  filesLoadedByTheme?: number;
  variablesLoadedByTheme?: number;
  files?: number;
  variables?: number;
  maps?: {
    ref?: string;
    variables?: number;
    sources?: number;
  }[];
  configComponents?: number;
  customComponents?: number;
}
