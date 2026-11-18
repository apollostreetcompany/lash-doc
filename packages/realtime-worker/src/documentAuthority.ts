export const PUBLIC_ACCESS_MODES = ['restricted', 'read', 'comment'] as const;
export type PublicAccessMode = (typeof PUBLIC_ACCESS_MODES)[number];

export const NAMED_DOCUMENT_ROLES = ['view', 'comment', 'edit'] as const;
export type NamedDocumentRole = (typeof NAMED_DOCUMENT_ROLES)[number];

export type AccountSubject = Readonly<{
  issuer: string;
  subject: string;
}>;

/**
 * Provider-neutral account input after the server identity adapter has verified
 * it. The email digest is profile/invite-matching evidence only; issuer +
 * subject is the account identity used for document authority.
 */
export type AccountPrincipal = Readonly<{
  account: AccountSubject;
  verifiedEmailDigest: string | null;
}>;

export type NamedDocumentMember = Readonly<{
  principal: AccountSubject;
  role: NamedDocumentRole;
  cutoffGeneration: number;
}>;

export type DocumentAuthorityState = Readonly<{
  documentId: string;
  owner: AccountSubject;
  ownerCutoffGeneration: number;
  aclVersion: number;
  publicAccess: Readonly<{
    mode: PublicAccessMode;
    version: number;
    cutoffGeneration: number;
  }>;
  members: readonly NamedDocumentMember[];
}>;

export type DocumentAuthorityCapability =
  | 'doc.read'
  | 'comment.public.read'
  | 'comment.public.create'
  | 'comment.public.reply'
  | 'comment.public.moderate'
  | 'comment.collaborator.read'
  | 'comment.collaborator.create'
  | 'comment.collaborator.reply'
  | 'comment.collaborator.resolve'
  | 'doc.suggest'
  | 'doc.edit'
  | 'doc.share'
  | 'doc.settings.public'
  | 'doc.history.read'
  | 'doc.history.restore'
  | 'ai.invoke';

export type DocumentAuthorityRole = 'owner' | NamedDocumentRole | 'public-read' | 'public-comment';

export type DocumentAuthoritySource = 'owner' | 'named' | 'public';

/**
 * Correlation/version snapshot only. These fields carry no authenticity by
 * themselves; serialized grants require upstream HMAC verification before the
 * action decision receives them.
 */
export type DocumentAuthorityGrant = Readonly<{
  documentId: string;
  principal: AccountSubject | null;
  verifiedEmail: boolean;
  role: DocumentAuthorityRole;
  source: DocumentAuthoritySource;
  aclVersion: number;
  publicPolicyVersion: number;
  cutoffGeneration: number;
}>;

export type DocumentAuthorityFailure =
  | 'invalid-state'
  | 'invalid-grant'
  | 'document-mismatch'
  | 'stale-acl'
  | 'stale-public-policy'
  | 'cut-off'
  | 'no-access'
  | 'scope-mismatch';

export type DocumentAuthorityGrantDecision =
  | Readonly<{
      allow: true;
      grant: DocumentAuthorityGrant;
      capabilities: readonly DocumentAuthorityCapability[];
    }>
  | Readonly<{ allow: false; reason: DocumentAuthorityFailure }>;

export type DocumentAuthorityActionDecision =
  | Readonly<{ allow: true }>
  | Readonly<{ allow: false; reason: DocumentAuthorityFailure }>;

const OWNER_CAPABILITIES = [
  'doc.read',
  'comment.public.read',
  'comment.public.create',
  'comment.public.reply',
  'comment.public.moderate',
  'comment.collaborator.read',
  'comment.collaborator.create',
  'comment.collaborator.reply',
  'comment.collaborator.resolve',
  'doc.suggest',
  'doc.edit',
  'doc.share',
  'doc.settings.public',
  'doc.history.read',
  'doc.history.restore',
  'ai.invoke',
] as const satisfies readonly DocumentAuthorityCapability[];

const NAMED_VIEW_CAPABILITIES = [
  'doc.read',
] as const satisfies readonly DocumentAuthorityCapability[];

const NAMED_COMMENT_CAPABILITIES = [
  'doc.read',
  'comment.collaborator.read',
  'comment.collaborator.create',
  'comment.collaborator.reply',
  'comment.collaborator.resolve',
  'doc.suggest',
  'comment.public.read',
] as const satisfies readonly DocumentAuthorityCapability[];

const NAMED_EDIT_CAPABILITIES = [
  ...NAMED_COMMENT_CAPABILITIES,
  'doc.edit',
  'doc.history.read',
  'ai.invoke',
] as const satisfies readonly DocumentAuthorityCapability[];

const PUBLIC_READ_CAPABILITIES = [
  'doc.read',
] as const satisfies readonly DocumentAuthorityCapability[];

const PUBLIC_COMMENT_READER_CAPABILITIES = [
  'doc.read',
  'comment.public.read',
] as const satisfies readonly DocumentAuthorityCapability[];

const PUBLIC_COMMENTER_CAPABILITIES = [
  ...PUBLIC_COMMENT_READER_CAPABILITIES,
  'comment.public.create',
] as const satisfies readonly DocumentAuthorityCapability[];

const MAX_ISSUER_LENGTH = 2_048;
const MAX_SUBJECT_LENGTH = 512;
const MAX_EMAIL_DIGEST_LENGTH = 512;
const MAX_DOCUMENT_ID_LENGTH = 512;
const MAX_NAMED_MEMBERS = 10_000;

const hasNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const hasBoundedCanonicalText = (value: unknown, maxLength: number): value is string =>
  hasNonEmptyString(value) &&
  value.length <= maxLength &&
  value === value.trim() &&
  !/[\u0000-\u001f\u007f]/u.test(value);

const isVersion = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

const isCutoffGeneration = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export const parsePublicAccessMode = (value: unknown): PublicAccessMode | null => {
  switch (value) {
    case 'restricted':
    case 'read':
    case 'comment':
      return value;
    default:
      return null;
  }
};

const parseNamedDocumentRole = (value: unknown): NamedDocumentRole | null => {
  switch (value) {
    case 'view':
    case 'comment':
    case 'edit':
      return value;
    default:
      return null;
  }
};

const isCanonicalIssuer = (value: unknown): value is string => {
  if (!hasBoundedCanonicalText(value, MAX_ISSUER_LENGTH)) return false;
  try {
    const issuer = new URL(value);
    const isSecureIssuer = issuer.protocol === 'https:';
    const isLoopbackIssuer =
      issuer.protocol === 'http:' &&
      (issuer.hostname === 'localhost' ||
        issuer.hostname === '127.0.0.1' ||
        issuer.hostname === '[::1]');
    return (
      (isSecureIssuer || isLoopbackIssuer) &&
      issuer.username === '' &&
      issuer.password === '' &&
      issuer.search === '' &&
      issuer.hash === ''
    );
  } catch {
    return false;
  }
};

const snapshotAccountSubject = (value: unknown): AccountSubject | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let issuer: unknown;
  let subject: unknown;
  try {
    const candidate = value as Partial<AccountSubject>;
    issuer = candidate.issuer;
    subject = candidate.subject;
  } catch {
    return null;
  }
  if (!isCanonicalIssuer(issuer) || !hasBoundedCanonicalText(subject, MAX_SUBJECT_LENGTH)) {
    return null;
  }
  return { issuer, subject };
};

const snapshotAccountPrincipal = (value: unknown): AccountPrincipal | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let rawAccount: unknown;
  let verifiedEmailDigest: unknown;
  try {
    const candidate = value as Partial<AccountPrincipal>;
    rawAccount = candidate.account;
    verifiedEmailDigest = candidate.verifiedEmailDigest;
  } catch {
    return null;
  }
  const account = snapshotAccountSubject(rawAccount);
  if (
    !account ||
    (verifiedEmailDigest !== null &&
      !hasBoundedCanonicalText(verifiedEmailDigest, MAX_EMAIL_DIGEST_LENGTH))
  ) {
    return null;
  }
  return { account, verifiedEmailDigest };
};

const subjectKey = (principal: AccountSubject) =>
  `${principal.issuer.length}:${principal.issuer}${principal.subject.length}:${principal.subject}`;

const sameSubject = (left: AccountSubject, right: AccountSubject) =>
  left.issuer === right.issuer && left.subject === right.subject;

const snapshotNamedMember = (value: unknown): NamedDocumentMember | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let rawPrincipal: unknown;
  let rawRole: unknown;
  let cutoffGeneration: unknown;
  try {
    const candidate = value as Partial<NamedDocumentMember>;
    rawPrincipal = candidate.principal;
    rawRole = candidate.role;
    cutoffGeneration = candidate.cutoffGeneration;
  } catch {
    return null;
  }
  const principal = snapshotAccountSubject(rawPrincipal);
  const role = parseNamedDocumentRole(rawRole);
  return principal && role && isCutoffGeneration(cutoffGeneration)
    ? { principal, role, cutoffGeneration }
    : null;
};

const snapshotAuthorityState = (value: unknown): DocumentAuthorityState | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let documentId: unknown;
  let rawOwner: unknown;
  let ownerCutoffGeneration: unknown;
  let aclVersion: unknown;
  let rawPublicAccess: unknown;
  let rawMembers: unknown;
  try {
    const candidate = value as Partial<DocumentAuthorityState>;
    documentId = candidate.documentId;
    rawOwner = candidate.owner;
    ownerCutoffGeneration = candidate.ownerCutoffGeneration;
    aclVersion = candidate.aclVersion;
    rawPublicAccess = candidate.publicAccess;
    rawMembers = candidate.members;
  } catch {
    return null;
  }
  if (
    !hasBoundedCanonicalText(documentId, MAX_DOCUMENT_ID_LENGTH) ||
    !isVersion(aclVersion) ||
    !isCutoffGeneration(ownerCutoffGeneration) ||
    !Array.isArray(rawMembers)
  ) {
    return null;
  }
  let memberCount: number;
  try {
    memberCount = rawMembers.length;
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(memberCount) || memberCount > MAX_NAMED_MEMBERS) return null;
  const owner = snapshotAccountSubject(rawOwner);
  if (!owner || !rawPublicAccess || typeof rawPublicAccess !== 'object') return null;

  let rawMode: unknown;
  let publicPolicyVersion: unknown;
  let publicCutoffGeneration: unknown;
  try {
    const publicAccess = rawPublicAccess as DocumentAuthorityState['publicAccess'];
    rawMode = publicAccess.mode;
    publicPolicyVersion = publicAccess.version;
    publicCutoffGeneration = publicAccess.cutoffGeneration;
  } catch {
    return null;
  }
  const mode = parsePublicAccessMode(rawMode);
  if (!mode || !isVersion(publicPolicyVersion) || !isCutoffGeneration(publicCutoffGeneration)) {
    return null;
  }

  const rawMemberEntries: unknown[] = [];
  try {
    for (let index = 0; index < memberCount; index += 1) {
      rawMemberEntries.push(rawMembers[index]);
    }
  } catch {
    return null;
  }

  const seenSubjects = new Set<string>([subjectKey(owner)]);
  const members: NamedDocumentMember[] = [];
  for (const rawMember of rawMemberEntries) {
    const member = snapshotNamedMember(rawMember);
    if (!member) return null;
    const key = subjectKey(member.principal);
    if (seenSubjects.has(key)) return null;
    seenSubjects.add(key);
    members.push(member);
  }
  return {
    documentId,
    owner,
    ownerCutoffGeneration,
    aclVersion,
    publicAccess: {
      mode,
      version: publicPolicyVersion,
      cutoffGeneration: publicCutoffGeneration,
    },
    members,
  };
};

const capabilitiesForRole = (
  role: DocumentAuthorityRole,
  verifiedEmail: boolean,
): readonly DocumentAuthorityCapability[] => {
  switch (role) {
    case 'owner':
      return OWNER_CAPABILITIES;
    case 'view':
      return NAMED_VIEW_CAPABILITIES;
    case 'comment':
      return NAMED_COMMENT_CAPABILITIES;
    case 'edit':
      return NAMED_EDIT_CAPABILITIES;
    case 'public-read':
      return PUBLIC_READ_CAPABILITIES;
    case 'public-comment':
      return verifiedEmail ? PUBLIC_COMMENTER_CAPABILITIES : PUBLIC_COMMENT_READER_CAPABILITIES;
  }
};

type ResolvedDocumentAuthority = Readonly<{
  role: DocumentAuthorityRole;
  source: DocumentAuthoritySource;
  cutoffGeneration: number;
  capabilities: readonly DocumentAuthorityCapability[];
}>;

const resolveDocumentAuthority = (
  state: DocumentAuthorityState,
  principal: AccountSubject | null,
  verifiedEmail: boolean,
): ResolvedDocumentAuthority | null => {
  let role: DocumentAuthorityRole;
  let source: DocumentAuthoritySource;
  let cutoffGeneration: number;

  if (principal && sameSubject(principal, state.owner)) {
    role = 'owner';
    source = 'owner';
    cutoffGeneration = state.ownerCutoffGeneration;
  } else {
    const member = principal
      ? state.members.find((entry) => sameSubject(entry.principal, principal))
      : undefined;
    if (member) {
      role = member.role;
      source = 'named';
      cutoffGeneration = member.cutoffGeneration;
    } else {
      switch (state.publicAccess.mode) {
        case 'restricted':
          return null;
        case 'read':
          role = 'public-read';
          source = 'public';
          cutoffGeneration = state.publicAccess.cutoffGeneration;
          break;
        case 'comment':
          role = 'public-comment';
          source = 'public';
          cutoffGeneration = state.publicAccess.cutoffGeneration;
          break;
      }
    }
  }

  return {
    role,
    source,
    cutoffGeneration,
    capabilities: capabilitiesForRole(role, verifiedEmail),
  };
};

export const deriveDocumentAuthorityGrant = (input: {
  state: DocumentAuthorityState;
  documentId: string;
  principal: AccountPrincipal | null;
}): DocumentAuthorityGrantDecision => {
  let rawState: unknown;
  let documentId: unknown;
  let rawPrincipal: unknown;
  try {
    rawState = input.state;
    documentId = input.documentId;
    rawPrincipal = input.principal;
  } catch {
    return { allow: false, reason: 'invalid-state' };
  }
  const state = snapshotAuthorityState(rawState);
  if (!state) {
    return { allow: false, reason: 'invalid-state' };
  }
  if (
    !hasBoundedCanonicalText(documentId, MAX_DOCUMENT_ID_LENGTH) ||
    documentId !== state.documentId
  ) {
    return { allow: false, reason: 'document-mismatch' };
  }
  const principal = rawPrincipal === null ? null : snapshotAccountPrincipal(rawPrincipal);
  if (rawPrincipal !== null && !principal) {
    return { allow: false, reason: 'no-access' };
  }
  const resolved = resolveDocumentAuthority(
    state,
    principal?.account ?? null,
    principal?.verifiedEmailDigest !== null && principal?.verifiedEmailDigest !== undefined,
  );
  if (!resolved) {
    return { allow: false, reason: 'no-access' };
  }

  const grant: DocumentAuthorityGrant = {
    documentId: state.documentId,
    principal: principal?.account ?? null,
    verifiedEmail:
      principal?.verifiedEmailDigest !== null && principal?.verifiedEmailDigest !== undefined,
    role: resolved.role,
    source: resolved.source,
    aclVersion: state.aclVersion,
    publicPolicyVersion: state.publicAccess.version,
    cutoffGeneration: resolved.cutoffGeneration,
  };
  return {
    allow: true,
    grant,
    capabilities: [...resolved.capabilities],
  };
};

const parseDocumentAuthorityRole = (value: unknown): DocumentAuthorityRole | null => {
  if (value === 'owner' || value === 'public-read' || value === 'public-comment') {
    return value;
  }
  return parseNamedDocumentRole(value);
};

const snapshotGrant = (value: unknown): DocumentAuthorityGrant | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let documentId: unknown;
  let rawPrincipal: unknown;
  let verifiedEmail: unknown;
  let rawRole: unknown;
  let source: unknown;
  let aclVersion: unknown;
  let publicPolicyVersion: unknown;
  let cutoffGeneration: unknown;
  try {
    const candidate = value as Partial<DocumentAuthorityGrant>;
    documentId = candidate.documentId;
    rawPrincipal = candidate.principal;
    verifiedEmail = candidate.verifiedEmail;
    rawRole = candidate.role;
    source = candidate.source;
    aclVersion = candidate.aclVersion;
    publicPolicyVersion = candidate.publicPolicyVersion;
    cutoffGeneration = candidate.cutoffGeneration;
  } catch {
    return null;
  }
  const principal = rawPrincipal === null ? null : snapshotAccountSubject(rawPrincipal);
  const role = parseDocumentAuthorityRole(rawRole);
  if (
    (rawPrincipal !== null && !principal) ||
    typeof verifiedEmail !== 'boolean' ||
    (principal === null && verifiedEmail) ||
    !hasBoundedCanonicalText(documentId, MAX_DOCUMENT_ID_LENGTH) ||
    !role ||
    (source !== 'owner' && source !== 'named' && source !== 'public') ||
    !isVersion(aclVersion) ||
    !isVersion(publicPolicyVersion) ||
    !isCutoffGeneration(cutoffGeneration)
  ) {
    return null;
  }
  return {
    documentId,
    principal,
    verifiedEmail,
    role,
    source,
    aclVersion,
    publicPolicyVersion,
    cutoffGeneration,
  };
};

export const decideDocumentAuthorityAction = (input: {
  state: DocumentAuthorityState;
  documentId: string;
  grant: DocumentAuthorityGrant;
  /**
   * Must come from the server identity adapter's current verified session, not
   * from the serialized grant. Structural validation, Readonly types, and this
   * pure correlation check are not cryptographic provenance. The access
   * integration must authenticate any serialized grant (for example, with its
   * reviewed HMAC boundary) before calling this function.
   */
  currentPrincipal: AccountPrincipal | null;
  capability: DocumentAuthorityCapability;
}): DocumentAuthorityActionDecision => {
  let rawState: unknown;
  let documentId: unknown;
  let rawGrant: unknown;
  let rawCurrentPrincipal: unknown;
  let capability: unknown;
  try {
    rawState = input.state;
    documentId = input.documentId;
    rawGrant = input.grant;
    rawCurrentPrincipal = input.currentPrincipal;
    capability = input.capability;
  } catch {
    return { allow: false, reason: 'invalid-grant' };
  }

  const state = snapshotAuthorityState(rawState);
  if (!state) {
    return { allow: false, reason: 'invalid-state' };
  }
  const grant = snapshotGrant(rawGrant);
  if (!grant) {
    return { allow: false, reason: 'invalid-grant' };
  }
  const currentPrincipal =
    rawCurrentPrincipal === null ? null : snapshotAccountPrincipal(rawCurrentPrincipal);
  if (rawCurrentPrincipal !== null && !currentPrincipal) {
    return { allow: false, reason: 'no-access' };
  }
  if (
    !hasBoundedCanonicalText(documentId, MAX_DOCUMENT_ID_LENGTH) ||
    documentId !== state.documentId ||
    grant.documentId !== documentId
  ) {
    return { allow: false, reason: 'document-mismatch' };
  }
  if (grant.aclVersion !== state.aclVersion) {
    return { allow: false, reason: 'stale-acl' };
  }
  if (grant.source === 'public' && grant.publicPolicyVersion !== state.publicAccess.version) {
    return { allow: false, reason: 'stale-public-policy' };
  }

  const current = resolveDocumentAuthority(
    state,
    currentPrincipal?.account ?? null,
    currentPrincipal?.verifiedEmailDigest !== null &&
      currentPrincipal?.verifiedEmailDigest !== undefined,
  );
  if (!current) return { allow: false, reason: 'no-access' };
  const principalMatches =
    grant.principal === null
      ? currentPrincipal === null
      : currentPrincipal !== null && sameSubject(grant.principal, currentPrincipal.account);
  const verifiedEmailMatches =
    grant.verifiedEmail ===
    (currentPrincipal?.verifiedEmailDigest !== null &&
      currentPrincipal?.verifiedEmailDigest !== undefined);
  if (!principalMatches || !verifiedEmailMatches) {
    return { allow: false, reason: 'invalid-grant' };
  }
  if (current.source !== grant.source || current.role !== grant.role) {
    return { allow: false, reason: 'invalid-grant' };
  }
  if (current.cutoffGeneration !== grant.cutoffGeneration) {
    return { allow: false, reason: 'cut-off' };
  }

  return current.capabilities.includes(capability as DocumentAuthorityCapability)
    ? { allow: true }
    : { allow: false, reason: 'scope-mismatch' };
};
