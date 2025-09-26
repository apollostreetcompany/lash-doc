export type DocumentId = string & { readonly brand: unique symbol };

export interface LashUser {
  id: string;
  displayName: string;
  email?: string;
}

export interface FeatureFlag {
  name: string;
  enabled: boolean;
}

export interface LashEnvironment {
  buildSha: string;
  flags: FeatureFlag[];
}

export const createDocumentId = (value: string): DocumentId => value as DocumentId;
