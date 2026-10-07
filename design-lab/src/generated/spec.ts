// Generated from schemas/spec.schema.json. Do not edit.

export interface Spec {
  component: string;
  machineName: string | null;
  source: {
    [k: string]: unknown;
  } | null;
  path: string;
  verificationUrl: string;
  linkUrl: string;
  rootSelector: string;
  extractedAt?: string;
  derivedFrom?: string;
  measurements: {
    [k: string]:
      | {
          rootBox: {
            width: number;
            height: number;
            [k: string]: unknown;
          };
          backdrop?: string;
          nodes: MeasuredNode[];
          [k: string]: unknown;
        }
      | {
          error: string;
          totalMatches?: number;
          [k: string]: unknown;
        };
  };
  [k: string]: unknown;
}
export interface MeasuredNode {
  path: string;
  tag: string;
  classes: string[];
  id: string | null;
  attributes: {
    [k: string]: string;
  };
  text: string | null;
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
    [k: string]: unknown;
  };
  computed: {
    [k: string]: string;
  };
  declared: {
    [k: string]: string | boolean;
  };
  before: {
    [k: string]: string;
  } | null;
  after: {
    [k: string]: string;
  } | null;
  rendered?: boolean | null;
  svg: string | null;
  image: {
    src: string;
    naturalWidth: number;
    naturalHeight: number;
    [k: string]: unknown;
  } | null;
  inlineText: string | null;
  maskSvg?: string;
  maskUnfetched?: string;
  [k: string]: unknown;
}
