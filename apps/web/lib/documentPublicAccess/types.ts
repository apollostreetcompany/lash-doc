export const PUBLIC_ACCESS_MODES = ['restricted', 'read', 'comment'] as const;
export type PublicAccessMode = (typeof PUBLIC_ACCESS_MODES)[number];

export type PublicAccessStateV1 = Readonly<{
  mode: PublicAccessMode;
  policyVersion: number;
  cutoffGeneration: number;
  publicUrl: string | null;
  publicProjectionBlocked?: true;
}>;

export type PublicAccessBrowserSuccessV1 = Readonly<{
  ok: true;
  version: 1;
  state: PublicAccessStateV1;
  changed?: boolean;
}>;

export type PublicAccessFailureCodeV1 =
  | 'invalid-request'
  | 'unauthenticated'
  | 'document-unavailable'
  | 'policy-conflict'
  | 'public-projection-blocked'
  | 'temporarily-unavailable';

export type PublicAccessBrowserFailureV1 = Readonly<{
  ok: false;
  version: 1;
  error: PublicAccessFailureCodeV1;
  retryable: boolean;
  state?: PublicAccessStateV1;
}>;

export type PublicAccessBrowserResultV1 =
  | PublicAccessBrowserSuccessV1
  | PublicAccessBrowserFailureV1;

export type PublicPolicyManagementReadRequestV1 = Readonly<{
  version: 1;
  claimId: string;
  ownerPrincipalId: string;
  localDocumentId: string;
}>;

export type PublicPolicyManagementUpdateRequestV1 = PublicPolicyManagementReadRequestV1 &
  Readonly<{
    mode: PublicAccessMode;
    expectedPolicyVersion: number;
    mutationId: string;
  }>;

export type PublicPolicyManagementSuccessV1 = Readonly<{
  ok: true;
  version: 1;
  claimId: string;
  roomId: string;
  ownerPrincipalId: string;
  mode: PublicAccessMode;
  policyVersion: number;
  cutoffGeneration: number;
  publicPath: string | null;
  publicProjectionBlocked?: true;
  changed?: boolean;
}>;

export type PublicPolicyManagementFailureV1 = Readonly<{
  ok: false;
  version: 1;
  error:
    | 'invalid-request'
    | 'unauthorized'
    | 'promotion-disabled'
    | 'claim-not-found'
    | 'claim-conflict'
    | 'owner-mismatch'
    | 'not-shareable'
    | 'policy-conflict'
    | 'replay-detected'
    | 'readback-failed'
    | 'internal-error';
  retryable: boolean;
  state?: Readonly<{
    mode: PublicAccessMode;
    policyVersion: number;
    cutoffGeneration: number;
    publicPath: string | null;
    publicProjectionBlocked?: true;
  }>;
}>;

export type PublicPolicyManagementResultV1 =
  | PublicPolicyManagementSuccessV1
  | PublicPolicyManagementFailureV1;
