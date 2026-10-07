// Generated from schemas/capture-evidence.schema.json. Do not edit.

export interface CaptureEvidence {
  standardVersion: string;
  toolVersion: string;
  generatedAt: string;
  canonicalBaseUrl: string;
  captures: {
    [k: string]: {
      path: string;
      verificationUrl: string;
      linkUrl: string;
      selector: string;
      /**
       * @minItems 1
       */
      states: [string, ...string[]];
      /**
       * @minItems 1
       */
      images: [
        {
          file?: string;
          hash?: string;
          height?: number;
          state?: string;
          viewport?: string;
          width?: number;
          [k: string]: unknown;
        },
        ...{
          file?: string;
          hash?: string;
          height?: number;
          state?: string;
          viewport?: string;
          width?: number;
          [k: string]: unknown;
        }[]
      ];
      [k: string]: unknown;
    };
  };
  problems: {
    componentId?: string;
    detail?: string;
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}
