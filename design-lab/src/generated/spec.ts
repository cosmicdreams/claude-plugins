// Generated from schemas/spec.schema.json. Do not edit.

export interface Spec {
  component: string;
  machineName: string | null;
  source: {
    sourceRef?: string | null;
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
          };
          backdrop?: string;
          nodes: MeasuredNode[];
        }
      | {
          error: string;
          totalMatches?: number;
        };
  };
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
  } | null;
  inlineText: string | null;
  maskSvg?: string;
  maskUnfetched?: string;
}
