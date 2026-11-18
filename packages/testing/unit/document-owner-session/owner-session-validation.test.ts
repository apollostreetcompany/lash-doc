import { describe, expect, it } from 'vitest';

import {
  OWNER_SESSION_LIMITS,
  parseBrowserOwnerSessionRequest,
} from '../../../../apps/web/lib/documentOwnerSession/validation';

describe('browser owner-session request validation', () => {
  it.each([
    '{"version":1,"actorId":"writer-1"}',
    '{ "actorId" : "a", "version" : 1 }',
    `{"version":1,"actorId":"${'a'.repeat(96)}"}`,
  ])('accepts the exact closed request %s', (raw) => {
    expect(parseBrowserOwnerSessionRequest(raw)).toEqual({
      ok: true,
      request: {
        version: 1,
        actorId: JSON.parse(raw).actorId,
      },
    });
  });

  it.each([
    ['empty actor', '{"version":1,"actorId":""}'],
    ['uppercase actor', '{"version":1,"actorId":"Writer"}'],
    ['padded actor', '{"version":1,"actorId":" writer"}'],
    ['leading hyphen', '{"version":1,"actorId":"-writer"}'],
    ['trailing hyphen', '{"version":1,"actorId":"writer-"}'],
    ['oversized actor', `{"version":1,"actorId":"${'a'.repeat(97)}"}`],
    ['unknown room', '{"version":1,"actorId":"writer","roomId":"forged"}'],
    ['unknown principal', '{"version":1,"actorId":"writer","principalId":"forged"}'],
    ['unknown owner', '{"version":1,"actorId":"writer","owner":true}'],
    ['unknown role', '{"version":1,"actorId":"writer","role":"owner"}'],
    ['unknown scope', '{"version":1,"actorId":"writer","scope":"edit"}'],
    ['unknown capabilities', '{"version":1,"actorId":"writer","capabilities":["doc.edit"]}'],
    ['duplicate version', '{"version":1,"version":1,"actorId":"writer"}'],
    ['duplicate actor', '{"version":1,"actorId":"writer","actorId":"other"}'],
    ['escaped actor', '{"version":1,"actorId":"writer\\u002d1"}'],
    ['wrong version', '{"version":2,"actorId":"writer"}'],
    ['array', '[]'],
    ['trailing input', '{"version":1,"actorId":"writer"}true'],
    ['oversized bytes', ' '.repeat(OWNER_SESSION_LIMITS.requestBytes + 1)],
  ])('rejects $label', (_label, raw) => {
    expect(parseBrowserOwnerSessionRequest(raw)).toEqual({
      ok: false,
      error: 'invalid-request',
    });
  });
});
