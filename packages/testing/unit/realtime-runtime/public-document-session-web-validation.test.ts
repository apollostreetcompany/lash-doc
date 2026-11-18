import { describe, expect, it } from 'vitest';

import {
  completePublicDocumentHydration,
  createPublicDocumentOpeningState,
  markPublicDocumentSessionAuthorized,
  parseBrowserPublicDocumentSessionRequest,
  parsePublicDocumentSessionRequestEnvelope,
  parsePublicDocumentMode,
  parsePublicDocumentRoomId,
  PUBLIC_DOCUMENT_SESSION_LIMITS,
} from '../../../../apps/web/lib/publicDocumentAccess';

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;

describe('public document web session foundation', () => {
  it('accepts only canonical opaque room identifiers', () => {
    expect(parsePublicDocumentRoomId(ROOM_ID)).toBe(ROOM_ID);
    expect(parsePublicDocumentRoomId(`doc-v0-${'0'.repeat(64)}`)).toBe(`doc-v0-${'0'.repeat(64)}`);

    for (const value of [
      '',
      `DOC-v1-${'a'.repeat(64)}`,
      `doc-v01-${'a'.repeat(64)}`,
      `doc-v1-${'A'.repeat(64)}`,
      `doc-v1-${'a'.repeat(63)}`,
      `doc-v1-${'a'.repeat(65)}`,
      `doc-v1-${'a'.repeat(63)}_`,
      `${ROOM_ID}/socket`,
      `%64oc-v1-${'a'.repeat(64)}`,
      ` ${ROOM_ID}`,
      `${ROOM_ID}?edit=true`,
    ]) {
      expect(parsePublicDocumentRoomId(value)).toBeNull();
    }
  });

  it('accepts the exact bounded browser body in either key order', () => {
    expect(
      parseBrowserPublicDocumentSessionRequest(
        JSON.stringify({ version: 1, actorId: 'actor-public-reader' }),
      ),
    ).toEqual({
      ok: true,
      request: { version: 1, actorId: 'actor-public-reader' },
    });
    expect(
      parseBrowserPublicDocumentSessionRequest(
        '{ "actorId": "actor-public-reader", "version": 1 }',
      ),
    ).toEqual({
      ok: true,
      request: { version: 1, actorId: 'actor-public-reader' },
    });
  });

  it('rejects malformed actors, edit claims, duplicate or extra keys, and oversized bodies', () => {
    const invalidBodies = [
      '{}',
      '{"version":1}',
      '{"version":2,"actorId":"actor-public-reader"}',
      '{"version":1,"actorId":"Actor-public-reader"}',
      '{"version":1,"actorId":"actor_public_reader"}',
      '{"version":1,"actorId":"-actor"}',
      '{"version":1,"actorId":"actor-"}',
      `{"version":1,"actorId":"${'a'.repeat(97)}"}`,
      '{"version":1,"actorId":"actor-public-reader","mode":"edit"}',
      '{"version":1,"actorId":"actor-public-reader","capabilities":["doc.edit"]}',
      '{"version":1,"actorId":"actor-public-reader","actorId":"other-reader"}',
      '{"actorId":"actor-public-reader","version":1,"version":1}',
      `${' '.repeat(PUBLIC_DOCUMENT_SESSION_LIMITS.requestBytes)}x`,
    ];

    for (const raw of invalidBodies) {
      expect(parseBrowserPublicDocumentSessionRequest(raw)).toEqual({
        ok: false,
        error: 'invalid-request',
      });
    }
  });

  it('uses the exact browser Origin while permitting an internal Next transport origin', () => {
    const rawBody = JSON.stringify({ version: 1, actorId: 'actor-public-reader' });
    const expectedPath = `/api/public/documents/${ROOM_ID}/session`;
    const request = {
      method: 'POST',
      requestUrl: `https://lash.example${expectedPath}`,
      siteOrigin: 'https://lash.example',
      roomId: ROOM_ID,
      rawBody,
      headers: {
        origin: 'https://lash.example',
        contentType: 'application/json; charset=utf-8',
        contentEncoding: null,
        contentLength: String(new TextEncoder().encode(rawBody).byteLength),
        secFetchSite: 'same-origin',
        secFetchMode: 'cors',
        secFetchDest: 'empty',
      },
    } as const;

    expect(parsePublicDocumentSessionRequestEnvelope(request)).toEqual({
      ok: true,
      roomId: ROOM_ID,
      request: { version: 1, actorId: 'actor-public-reader' },
    });
    expect(
      parsePublicDocumentSessionRequestEnvelope({
        ...request,
        requestUrl: `http://127.0.0.1:3001${expectedPath}`,
      }),
    ).toEqual({
      ok: true,
      roomId: ROOM_ID,
      request: { version: 1, actorId: 'actor-public-reader' },
    });

    for (const changed of [
      { method: 'GET' },
      { requestUrl: `https://lash.example${expectedPath}?edit=true` },
      { requestUrl: `https://lash.example${expectedPath}#fragment` },
      { requestUrl: `https://lash.example${expectedPath}/` },
      { requestUrl: `https://user:password@internal.example${expectedPath}` },
      { requestUrl: `ftp://internal.example${expectedPath}` },
      { siteOrigin: 'https://lash.example/path' },
      { roomId: `doc-v1-${'b'.repeat(64)}` },
      { headers: { ...request.headers, origin: 'https://other.example' } },
      { headers: { ...request.headers, contentType: 'text/plain' } },
      { headers: { ...request.headers, contentType: 'application/json, text/plain' } },
      { headers: { ...request.headers, contentEncoding: 'gzip' } },
      { headers: { ...request.headers, contentLength: '9999' } },
      { headers: { ...request.headers, secFetchSite: 'cross-site' } },
      { headers: { ...request.headers, secFetchMode: 'navigate' } },
      { headers: { ...request.headers, secFetchDest: 'document' } },
    ]) {
      expect(parsePublicDocumentSessionRequestEnvelope({ ...request, ...changed })).toEqual({
        ok: false,
        error: 'invalid-request',
      });
    }
  });

  it('makes public Edit unrepresentable', () => {
    expect(parsePublicDocumentMode('read')).toBe('read');
    expect(parsePublicDocumentMode('comment')).toBe('comment');
    expect(parsePublicDocumentMode('edit')).toBeNull();
    expect(parsePublicDocumentMode('suggest')).toBeNull();
    expect(parsePublicDocumentMode(null)).toBeNull();
  });

  it('keeps content fenced after session authorization until exact hydration completes', () => {
    const opening = createPublicDocumentOpeningState(ROOM_ID);
    expect(opening).toEqual({
      phase: 'authorizing',
      roomId: ROOM_ID,
      canRevealContent: false,
    });

    const hydrating = markPublicDocumentSessionAuthorized(opening, {
      roomId: ROOM_ID,
      mode: 'read',
      policyVersion: 7,
      cutoffGeneration: 3,
    });
    expect(hydrating).toEqual({
      phase: 'hydrating',
      roomId: ROOM_ID,
      mode: 'read',
      policyVersion: 7,
      cutoffGeneration: 3,
      canRevealContent: false,
    });

    expect(
      completePublicDocumentHydration(hydrating, {
        roomId: ROOM_ID,
        mode: 'read',
        policyVersion: 7,
        cutoffGeneration: 3,
        hydrationComplete: true,
      }),
    ).toEqual({
      phase: 'ready',
      roomId: ROOM_ID,
      mode: 'read',
      policyVersion: 7,
      cutoffGeneration: 3,
      canRevealContent: true,
    });
  });

  it('fails closed on wrong-room, policy drift, edit, or incomplete hydration receipts', () => {
    const opening = createPublicDocumentOpeningState(ROOM_ID);
    const hydrating = markPublicDocumentSessionAuthorized(opening, {
      roomId: ROOM_ID,
      mode: 'comment',
      policyVersion: 9,
      cutoffGeneration: 4,
    });

    for (const receipt of [
      {
        roomId: `doc-v1-${'b'.repeat(64)}`,
        mode: 'comment',
        policyVersion: 9,
        cutoffGeneration: 4,
        hydrationComplete: true,
      },
      {
        roomId: ROOM_ID,
        mode: 'comment',
        policyVersion: 10,
        cutoffGeneration: 4,
        hydrationComplete: true,
      },
      {
        roomId: ROOM_ID,
        mode: 'comment',
        policyVersion: 9,
        cutoffGeneration: 5,
        hydrationComplete: true,
      },
      {
        roomId: ROOM_ID,
        mode: 'edit',
        policyVersion: 9,
        cutoffGeneration: 4,
        hydrationComplete: true,
      },
      {
        roomId: ROOM_ID,
        mode: 'comment',
        policyVersion: 9,
        cutoffGeneration: 4,
        hydrationComplete: false,
      },
    ]) {
      expect(completePublicDocumentHydration(hydrating, receipt)).toEqual({
        phase: 'unavailable',
        roomId: ROOM_ID,
        canRevealContent: false,
      });
    }
  });
});
