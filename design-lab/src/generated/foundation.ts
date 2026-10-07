// Generated from schemas/foundation.schema.json. Do not edit.

export interface Foundation {
  standardVersion: string;
  toolVersion: string;
  figmaFileKey: string;
  pages: {
    [k: string]: unknown;
  };
  collections: {
    [k: string]: unknown;
  };
  validation: {
    /**
     * @maxItems 0
     */
    errors: [];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
