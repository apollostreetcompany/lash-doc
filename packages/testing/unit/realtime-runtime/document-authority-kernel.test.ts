import { describe, expect, it } from 'vitest';

import {
  decideDocumentAuthorityAction,
  deriveDocumentAuthorityGrant,
  parsePublicAccessMode,
  type AccountPrincipal,
  type AccountSubject,
  type DocumentAuthorityCapability,
  type DocumentAuthorityGrant,
  type DocumentAuthorityState,
  type NamedDocumentRole,
  type PublicAccessMode,
} from '../../../realtime-worker/src/documentAuthority';

const subject = (subjectId: string, issuer = 'https://identity.example.test'): AccountSubject => ({
  issuer,
  subject: subjectId,
});

const principal = (
  subjectId: string,
  verifiedEmailDigest: string | null = `verified-email-digest:${subjectId}`,
  issuer?: string,
): AccountPrincipal => ({
  account: subject(subjectId, issuer),
  verifiedEmailDigest,
});

const state = ({
  publicMode = 'restricted',
  members = [],
}: {
  publicMode?: PublicAccessMode;
  members?: Array<{
    principal: AccountSubject;
    role: NamedDocumentRole;
    cutoffGeneration?: number;
  }>;
} = {}): DocumentAuthorityState => ({
  documentId: 'doc-alpha',
  owner: subject('owner-subject'),
  ownerCutoffGeneration: 2,
  aclVersion: 7,
  publicAccess: {
    mode: publicMode,
    version: 5,
    cutoffGeneration: 3,
  },
  members: members.map((member) => ({
    ...member,
    cutoffGeneration: member.cutoffGeneration ?? 4,
  })),
});

const granted = (
  authorityState: DocumentAuthorityState,
  account: AccountPrincipal | null,
): DocumentAuthorityGrant => {
  const decision = deriveDocumentAuthorityGrant({
    state: authorityState,
    documentId: authorityState.documentId,
    principal: account,
  });
  expect(decision.allow).toBe(true);
  if (!decision.allow) throw new Error(`expected grant, received ${decision.reason}`);
  return decision.grant;
};

describe('document authority kernel', () => {
  it('denies a forged owner snapshot when the independently verified principal is an intruder', () => {
    const authorityState = state({ publicMode: 'restricted' });
    const forgedOwnerGrant: DocumentAuthorityGrant = {
      documentId: 'doc-alpha',
      principal: authorityState.owner,
      verifiedEmail: true,
      role: 'owner',
      source: 'owner',
      aclVersion: authorityState.aclVersion,
      publicPolicyVersion: authorityState.publicAccess.version,
      cutoffGeneration: authorityState.ownerCutoffGeneration,
    };

    expect(
      decideDocumentAuthorityAction({
        state: authorityState,
        documentId: 'doc-alpha',
        grant: forgedOwnerGrant,
        currentPrincipal: principal('intruder'),
        capability: 'doc.share',
      }),
    ).toEqual({ allow: false, reason: 'no-access' });
  });

  it('parses only the closed restricted/read/comment public-access enum', () => {
    // @ts-expect-error Public Edit must remain unrepresentable in the external policy type.
    const impossiblePublicEdit: PublicAccessMode = 'edit';
    expect(
      (['restricted', 'read', 'comment'] satisfies PublicAccessMode[]).map(parsePublicAccessMode),
    ).toEqual(['restricted', 'read', 'comment']);
    expect(parsePublicAccessMode(impossiblePublicEdit)).toBeNull();

    for (const value of ['edit', 'custom', '', 'READ', null, undefined, 0, 1, true, {}, []]) {
      expect(parsePublicAccessMode(value)).toBeNull();
    }
  });

  it.each([
    {
      label: 'owner',
      account: principal('owner-subject'),
      authorityState: state({ publicMode: 'restricted' }),
      role: 'owner',
      source: 'owner',
      capabilities: [
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
      ],
    },
    {
      label: 'named View',
      account: principal('named-view'),
      authorityState: state({
        publicMode: 'comment',
        members: [{ principal: subject('named-view'), role: 'view' }],
      }),
      role: 'view',
      source: 'named',
      capabilities: ['doc.read'],
    },
    {
      label: 'named Comment',
      account: principal('named-comment'),
      authorityState: state({
        members: [{ principal: subject('named-comment'), role: 'comment' }],
      }),
      role: 'comment',
      source: 'named',
      capabilities: [
        'doc.read',
        'comment.collaborator.read',
        'comment.collaborator.create',
        'comment.collaborator.reply',
        'comment.collaborator.resolve',
        'doc.suggest',
        'comment.public.read',
      ],
    },
    {
      label: 'named Edit',
      account: principal('named-edit'),
      authorityState: state({
        members: [{ principal: subject('named-edit'), role: 'edit' }],
      }),
      role: 'edit',
      source: 'named',
      capabilities: [
        'doc.read',
        'comment.collaborator.read',
        'comment.collaborator.create',
        'comment.collaborator.reply',
        'comment.collaborator.resolve',
        'doc.suggest',
        'comment.public.read',
        'doc.edit',
        'doc.history.read',
        'ai.invoke',
      ],
    },
    {
      label: 'anonymous Public Read',
      account: null,
      authorityState: state({ publicMode: 'read' }),
      role: 'public-read',
      source: 'public',
      capabilities: ['doc.read'],
    },
    {
      label: 'anonymous Public Comment',
      account: null,
      authorityState: state({ publicMode: 'comment' }),
      role: 'public-comment',
      source: 'public',
      capabilities: ['doc.read', 'comment.public.read'],
    },
    {
      label: 'verified Public Comment',
      account: principal('public-commenter'),
      authorityState: state({ publicMode: 'comment' }),
      role: 'public-comment',
      source: 'public',
      capabilities: ['doc.read', 'comment.public.read', 'comment.public.create'],
    },
  ] as const)(
    'derives the exact $label authority from durable state',
    ({ account, authorityState, role, source, capabilities }) => {
      expect(
        deriveDocumentAuthorityGrant({
          state: authorityState,
          documentId: 'doc-alpha',
          principal: account,
        }),
      ).toMatchObject({
        allow: true,
        capabilities,
        grant: {
          role,
          source,
          aclVersion: authorityState.aclVersion,
          publicPolicyVersion: authorityState.publicAccess.version,
        },
      });
    },
  );

  it('keeps Public Comment read-only until a verified account signs in', () => {
    const publicComment = state({ publicMode: 'comment' });
    const anonymousGrant = granted(publicComment, null);
    const unverifiedPrincipal = principal('unverified', null);
    const verifiedPrincipal = principal('verified');
    const unverifiedGrant = granted(publicComment, unverifiedPrincipal);
    const verifiedGrant = granted(publicComment, verifiedPrincipal);

    for (const [grant, currentPrincipal] of [
      [anonymousGrant, null],
      [unverifiedGrant, unverifiedPrincipal],
    ] as const) {
      expect(
        decideDocumentAuthorityAction({
          state: publicComment,
          documentId: 'doc-alpha',
          grant,
          currentPrincipal,
          capability: 'comment.public.create',
        }),
      ).toEqual({ allow: false, reason: 'scope-mismatch' });
      expect(
        decideDocumentAuthorityAction({
          state: publicComment,
          documentId: 'doc-alpha',
          grant,
          currentPrincipal,
          capability: 'doc.read',
        }),
      ).toEqual({ allow: true });
    }

    expect(
      decideDocumentAuthorityAction({
        state: publicComment,
        documentId: 'doc-alpha',
        grant: verifiedGrant,
        currentPrincipal: verifiedPrincipal,
        capability: 'comment.public.create',
      }),
    ).toEqual({ allow: true });
    expect(
      decideDocumentAuthorityAction({
        state: publicComment,
        documentId: 'doc-alpha',
        grant: verifiedGrant,
        currentPrincipal: verifiedPrincipal,
        capability: 'comment.public.reply',
      }),
    ).toEqual({ allow: false, reason: 'scope-mismatch' });
  });

  it('never gives public or named Comment opaque body-edit authority', () => {
    const publicComment = state({ publicMode: 'comment' });
    const namedComment = state({
      publicMode: 'comment',
      members: [{ principal: subject('named-comment'), role: 'comment' }],
    });

    for (const [authorityState, account] of [
      [publicComment, null],
      [publicComment, principal('public-commenter')],
      [namedComment, principal('named-comment')],
    ] as const) {
      const grant = granted(authorityState, account);
      for (const capability of [
        'doc.edit',
        'doc.share',
        'doc.settings.public',
        'doc.history.read',
        'doc.history.restore',
        'ai.invoke',
      ] as const) {
        expect(
          decideDocumentAuthorityAction({
            state: authorityState,
            documentId: 'doc-alpha',
            grant,
            currentPrincipal: account,
            capability,
          }),
        ).toEqual({ allow: false, reason: 'scope-mismatch' });
      }
    }

    const publicGrant = granted(publicComment, principal('public-commenter'));
    expect(
      decideDocumentAuthorityAction({
        state: publicComment,
        documentId: 'doc-alpha',
        grant: publicGrant,
        currentPrincipal: principal('public-commenter'),
        capability: 'doc.suggest',
      }),
    ).toEqual({ allow: false, reason: 'scope-mismatch' });
  });

  it('binds ownership to issuer plus subject, never to the profile email', () => {
    const ownerState = state();
    const beforeEmailChange = granted(
      ownerState,
      principal('owner-subject', 'verified-email-digest:before'),
    );
    const afterEmailChange = granted(
      ownerState,
      principal('owner-subject', 'verified-email-digest:after'),
    );

    expect(beforeEmailChange.role).toBe('owner');
    expect(afterEmailChange.role).toBe('owner');
    expect(
      deriveDocumentAuthorityGrant({
        state: ownerState,
        documentId: 'doc-alpha',
        principal: principal(
          'owner-subject',
          'verified-email-digest:before',
          'https://different-issuer.example.test',
        ),
      }),
    ).toEqual({ allow: false, reason: 'no-access' });

    const loopbackIssuer = 'http://127.0.0.1:54321/auth/v1';
    expect(
      deriveDocumentAuthorityGrant({
        state: {
          ...ownerState,
          owner: subject('local-owner', loopbackIssuer),
        },
        documentId: 'doc-alpha',
        principal: principal('local-owner', 'verified-email-digest:local', loopbackIssuer),
      }),
    ).toMatchObject({ allow: true, grant: { role: 'owner', source: 'owner' } });
  });

  it('gives a named role precedence over a broader public policy', () => {
    const authorityState = state({
      publicMode: 'comment',
      members: [{ principal: subject('named-view'), role: 'view' }],
    });
    const grant = granted(authorityState, principal('named-view'));

    expect(grant).toMatchObject({ source: 'named', role: 'view' });
    expect(
      decideDocumentAuthorityAction({
        state: authorityState,
        documentId: 'doc-alpha',
        grant,
        currentPrincipal: principal('named-view'),
        capability: 'comment.public.create',
      }),
    ).toEqual({ allow: false, reason: 'scope-mismatch' });
  });

  it('rejects anonymous/account snapshot swaps and named role escalation', () => {
    const publicState = state({ publicMode: 'read' });
    const anonymousGrant = granted(publicState, null);
    const publicAccount = principal('public-reader');
    const accountGrant = granted(publicState, publicAccount);

    expect(
      decideDocumentAuthorityAction({
        state: publicState,
        documentId: 'doc-alpha',
        grant: anonymousGrant,
        currentPrincipal: publicAccount,
        capability: 'doc.read',
      }),
    ).toEqual({ allow: false, reason: 'invalid-grant' });
    expect(
      decideDocumentAuthorityAction({
        state: publicState,
        documentId: 'doc-alpha',
        grant: accountGrant,
        currentPrincipal: null,
        capability: 'doc.read',
      }),
    ).toEqual({ allow: false, reason: 'invalid-grant' });

    const namedState = state({
      members: [{ principal: subject('named-comment'), role: 'comment' }],
    });
    const namedPrincipal = principal('named-comment');
    const commentGrant = granted(namedState, namedPrincipal);
    const escalatedGrant = {
      ...commentGrant,
      role: 'edit',
    } as DocumentAuthorityGrant;
    expect(
      decideDocumentAuthorityAction({
        state: namedState,
        documentId: 'doc-alpha',
        grant: escalatedGrant,
        currentPrincipal: namedPrincipal,
        capability: 'doc.edit',
      }),
    ).toEqual({ allow: false, reason: 'invalid-grant' });

    for (const forgedGrant of [
      { ...commentGrant, source: 'owner', role: 'owner' },
      {
        ...commentGrant,
        source: 'public',
        role: 'public-comment',
        cutoffGeneration: namedState.publicAccess.cutoffGeneration,
      },
      { ...commentGrant, principal: namedState.owner },
    ] as DocumentAuthorityGrant[]) {
      expect(
        decideDocumentAuthorityAction({
          state: namedState,
          documentId: 'doc-alpha',
          grant: forgedGrant,
          currentPrincipal: namedPrincipal,
          capability: 'doc.share',
        }),
      ).toEqual({ allow: false, reason: 'invalid-grant' });
    }

    const forgedPublicCapabilities = {
      ...accountGrant,
      capabilities: ['doc.read', 'doc.edit', 'doc.share'],
    } as unknown as DocumentAuthorityGrant;
    expect(
      decideDocumentAuthorityAction({
        state: publicState,
        documentId: 'doc-alpha',
        grant: forgedPublicCapabilities,
        currentPrincipal: publicAccount,
        capability: 'doc.edit',
      }),
    ).toEqual({ allow: false, reason: 'scope-mismatch' });
  });

  it('accepts a serialized-equivalent snapshot only with the matching verified principal', () => {
    const authorityState = state({
      members: [{ principal: subject('named-edit'), role: 'edit' }],
    });
    const currentPrincipal = principal('named-edit');
    const issuedGrant = granted(authorityState, currentPrincipal);
    const externallyAuthenticatedSnapshot = JSON.parse(
      JSON.stringify(issuedGrant),
    ) as DocumentAuthorityGrant;

    expect(
      decideDocumentAuthorityAction({
        state: authorityState,
        documentId: 'doc-alpha',
        grant: externallyAuthenticatedSnapshot,
        currentPrincipal,
        capability: 'doc.edit',
      }),
    ).toEqual({ allow: true });
  });

  it('snapshots getter-backed grant, state, and current-principal inputs exactly once', () => {
    const restrictedState = state({ publicMode: 'restricted' });
    const forgedOwnerGrant: DocumentAuthorityGrant = {
      documentId: 'doc-alpha',
      principal: restrictedState.owner,
      verifiedEmail: true,
      role: 'owner',
      source: 'owner',
      aclVersion: restrictedState.aclVersion,
      publicPolicyVersion: restrictedState.publicAccess.version,
      cutoffGeneration: restrictedState.ownerCutoffGeneration,
    };
    let accountReads = 0;
    const switchingPrincipal = {
      get account() {
        accountReads += 1;
        return accountReads === 1 ? subject('intruder') : restrictedState.owner;
      },
      verifiedEmailDigest: 'verified-email-digest:switching',
    } as AccountPrincipal;
    expect(
      decideDocumentAuthorityAction({
        state: restrictedState,
        documentId: 'doc-alpha',
        grant: forgedOwnerGrant,
        currentPrincipal: switchingPrincipal,
        capability: 'doc.share',
      }),
    ).toEqual({ allow: false, reason: 'no-access' });
    expect(accountReads).toBe(1);

    const publicState = state({ publicMode: 'read' });
    const publicGrant = granted(publicState, null);
    let grantCutoffReads = 0;
    const staleThenCurrentGrant = new Proxy(publicGrant, {
      get(target, property, receiver) {
        if (property === 'cutoffGeneration') {
          grantCutoffReads += 1;
          return grantCutoffReads === 1
            ? publicGrant.cutoffGeneration - 1
            : publicGrant.cutoffGeneration;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      decideDocumentAuthorityAction({
        state: publicState,
        documentId: 'doc-alpha',
        grant: staleThenCurrentGrant,
        currentPrincipal: null,
        capability: 'doc.read',
      }),
    ).toEqual({ allow: false, reason: 'cut-off' });
    expect(grantCutoffReads).toBe(1);

    let stateCutoffReads = 0;
    const changingState = {
      ...publicState,
      publicAccess: {
        ...publicState.publicAccess,
        get cutoffGeneration() {
          stateCutoffReads += 1;
          return stateCutoffReads === 1
            ? publicState.publicAccess.cutoffGeneration + 1
            : publicState.publicAccess.cutoffGeneration;
        },
      },
    } as DocumentAuthorityState;
    expect(
      decideDocumentAuthorityAction({
        state: changingState,
        documentId: 'doc-alpha',
        grant: publicGrant,
        currentPrincipal: null,
        capability: 'doc.read',
      }),
    ).toEqual({ allow: false, reason: 'cut-off' });
    expect(stateCutoffReads).toBe(1);
  });

  it('rejects wrong-document, stale ACL, stale policy, and cutoff grants', () => {
    const authorityState = state({ publicMode: 'comment' });
    const publicCommenter = principal('public-commenter');
    const grant = granted(authorityState, publicCommenter);

    expect(
      decideDocumentAuthorityAction({
        state: authorityState,
        documentId: 'doc-beta',
        grant,
        currentPrincipal: publicCommenter,
        capability: 'doc.read',
      }),
    ).toEqual({ allow: false, reason: 'document-mismatch' });
    expect(
      decideDocumentAuthorityAction({
        state: { ...authorityState, aclVersion: authorityState.aclVersion + 1 },
        documentId: 'doc-alpha',
        grant,
        currentPrincipal: publicCommenter,
        capability: 'doc.read',
      }),
    ).toEqual({ allow: false, reason: 'stale-acl' });
    expect(
      decideDocumentAuthorityAction({
        state: {
          ...authorityState,
          publicAccess: {
            ...authorityState.publicAccess,
            version: authorityState.publicAccess.version + 1,
          },
        },
        documentId: 'doc-alpha',
        grant,
        currentPrincipal: publicCommenter,
        capability: 'doc.read',
      }),
    ).toEqual({ allow: false, reason: 'stale-public-policy' });
    expect(
      decideDocumentAuthorityAction({
        state: {
          ...authorityState,
          publicAccess: {
            ...authorityState.publicAccess,
            cutoffGeneration: authorityState.publicAccess.cutoffGeneration + 1,
          },
        },
        documentId: 'doc-alpha',
        grant,
        currentPrincipal: publicCommenter,
        capability: 'doc.read',
      }),
    ).toEqual({ allow: false, reason: 'cut-off' });

    const namedState = state({
      members: [{ principal: subject('named-comment'), role: 'comment' }],
    });
    const namedPrincipal = principal('named-comment');
    const namedGrant = granted(namedState, namedPrincipal);
    expect(
      decideDocumentAuthorityAction({
        state: {
          ...namedState,
          members: namedState.members.map((member) => ({
            ...member,
            cutoffGeneration: member.cutoffGeneration + 1,
          })),
        },
        documentId: 'doc-alpha',
        grant: namedGrant,
        currentPrincipal: namedPrincipal,
        capability: 'comment.collaborator.create',
      }),
    ).toEqual({ allow: false, reason: 'cut-off' });
  });

  it('fails closed for invalid durable state and ignores client capability claims', () => {
    const invalidPublicMode = {
      ...state({ publicMode: 'restricted' }),
      publicAccess: {
        ...state().publicAccess,
        mode: 'edit',
      },
    } as unknown as DocumentAuthorityState;

    expect(
      deriveDocumentAuthorityGrant({
        state: invalidPublicMode,
        documentId: 'doc-alpha',
        principal: principal('owner-subject'),
      }),
    ).toEqual({ allow: false, reason: 'invalid-state' });

    const invalidNamedRole = {
      ...state({
        members: [{ principal: subject('named-comment'), role: 'comment' }],
      }),
      members: [
        {
          principal: subject('named-comment'),
          role: 'owner',
          cutoffGeneration: 4,
        },
      ],
    } as unknown as DocumentAuthorityState;
    expect(
      deriveDocumentAuthorityGrant({
        state: invalidNamedRole,
        documentId: 'doc-alpha',
        principal: principal('named-comment'),
      }),
    ).toEqual({ allow: false, reason: 'invalid-state' });

    for (const malformedOwner of [
      subject('owner-subject', 'not-an-absolute-url'),
      subject('owner-subject', ' http://127.0.0.1:54321/auth/v1'),
      subject('owner-subject', 'http://identity.example.test'),
      subject('owner-subject', 'https://user:password@identity.example.test'),
      subject('owner-subject', 'https://identity.example.test#fragment'),
      subject('owner-subject', `https://${'a'.repeat(2_048)}.example.test`),
      subject(' owner-subject'),
      subject('owner\u0000subject'),
      subject('x'.repeat(513)),
    ]) {
      expect(
        deriveDocumentAuthorityGrant({
          state: { ...state(), owner: malformedOwner },
          documentId: 'doc-alpha',
          principal: principal('owner-subject'),
        }),
      ).toEqual({ allow: false, reason: 'invalid-state' });
    }

    expect(
      deriveDocumentAuthorityGrant({
        state: state({ publicMode: 'restricted' }),
        documentId: 'doc-alpha',
        principal: principal('intruder'),
        capabilities: ['doc.read', 'doc.edit', 'doc.share'],
      } as unknown as Parameters<typeof deriveDocumentAuthorityGrant>[0]),
    ).toEqual({ allow: false, reason: 'no-access' });
  });

  it('returns literal true only for an action present in the current derived authority', () => {
    const authorityState = state({
      members: [{ principal: subject('named-edit'), role: 'edit' }],
    });
    const namedEditor = principal('named-edit');
    const grant = granted(authorityState, namedEditor);

    const allowed = decideDocumentAuthorityAction({
      state: authorityState,
      documentId: 'doc-alpha',
      grant,
      currentPrincipal: namedEditor,
      capability: 'doc.edit',
    });
    expect(allowed.allow).toBe(true);
    expect(allowed).toEqual({ allow: true });
    expect(
      decideDocumentAuthorityAction({
        state: authorityState,
        documentId: 'doc-alpha',
        grant,
        currentPrincipal: namedEditor,
        capability: 'doc.delete',
      } as unknown as Parameters<typeof decideDocumentAuthorityAction>[0]),
    ).toEqual({ allow: false, reason: 'scope-mismatch' });
  });

  it('snapshots caller-owned identity and capability outputs', () => {
    const publicState = state({ publicMode: 'comment' });
    const callerPrincipal = principal('unverified', null);
    const publicDecision = deriveDocumentAuthorityGrant({
      state: publicState,
      documentId: 'doc-alpha',
      principal: callerPrincipal,
    });
    expect(publicDecision.allow).toBe(true);
    if (!publicDecision.allow) throw new Error('expected public grant');

    (callerPrincipal as { verifiedEmailDigest: string | null }).verifiedEmailDigest =
      'verified-email-digest:late-mutation';
    expect(
      decideDocumentAuthorityAction({
        state: publicState,
        documentId: 'doc-alpha',
        grant: publicDecision.grant,
        currentPrincipal: callerPrincipal,
        capability: 'comment.public.create',
      }),
    ).toEqual({ allow: false, reason: 'invalid-grant' });

    const viewState = state({
      members: [{ principal: subject('named-view'), role: 'view' }],
    });
    const firstViewDecision = deriveDocumentAuthorityGrant({
      state: viewState,
      documentId: 'doc-alpha',
      principal: principal('named-view'),
    });
    expect(firstViewDecision.allow).toBe(true);
    if (!firstViewDecision.allow) throw new Error('expected view grant');
    (firstViewDecision.capabilities as DocumentAuthorityCapability[]).push('doc.edit');

    expect(
      deriveDocumentAuthorityGrant({
        state: viewState,
        documentId: 'doc-alpha',
        principal: principal('named-view'),
      }),
    ).toMatchObject({ allow: true, capabilities: ['doc.read'] });
  });
});
