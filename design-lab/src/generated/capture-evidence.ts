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
        },
        ...{
          file?: string;
          hash?: string;
          height?: number;
          state?: string;
          viewport?: string;
          width?: number;
        }[]
      ];
    };
  };
  problems: {
    componentId?: string;
    detail?: string;
  }[];
  checks?: {
    componentId?: string;
    chosen?: string | null;
    revealed?: boolean;
    seconds?: number;
    pages?: {
      path?: string;
      matches?: number;
      visible?: number;
      height?: number;
      revealed?: boolean;
      error?: string;
      seconds?: number;
    }[];
  }[];
}
