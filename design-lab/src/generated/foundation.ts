// Generated from schemas/foundation.schema.json. Do not edit.

export interface Foundation {
  standardVersion: string;
  toolVersion: string;
  figmaFileKey: string;
  pages: {
    [k: string]: string;
  };
  collections: {
    [k: string]: {
      id?: string;
      modes?: string[];
      variables?: number;
    };
  };
  validation: {
    /**
     * @maxItems 0
     */
    errors: [];
  };
}
