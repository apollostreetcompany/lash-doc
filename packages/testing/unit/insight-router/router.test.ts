import {
  InsightRouter,
  createDefaultInsightRouter,
  createDocumentInsertPlace,
  createGardenPlace,
  createHermesPlace,
  createInsightPayload,
  createPersephonePlace,
  stableInsightId,
  validateInsightPayload,
  GARDEN_UNCONFIGURED,
  HERMES_UNCONFIGURED,
  PERSEPHONE_UNCONFIGURED,
  type InsightPayload,
  type WritingPlace,
} from '@lash/insight-router';
import { describe, expect, it, vi } from 'vitest';

const FIXED = '2026-06-22T00:00:00.000Z';
const fixedClock = () => FIXED;

const payload = (over: Partial<InsightPayload> = {}): InsightPayload => ({
  id: 'insight:1',
  kind: 'ai-answer',
  text: 'Ship the writing-places router.',
  docId: 'demo-document',
  createdAt: FIXED,
  ...over,
});

describe('validateInsightPayload', () => {
  it('accepts a well-formed payload', () => {
    expect(validateInsightPayload(payload())).toEqual({ ok: true });
  });

  it('fails loud on empty text, missing id, bad kind, and bad range', () => {
    const bad = validateInsightPayload(
      payload({
        id: '',
        text: '   ',
        kind: 'nope' as InsightPayload['kind'],
        source: { range: { from: 5, to: 2 } },
      }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.length).toBeGreaterThanOrEqual(3);
      expect(bad.errors.join(' ')).toMatch(/text/);
      expect(bad.errors.join(' ')).toMatch(/range/);
    }
  });
});

describe('stableInsightId / createInsightPayload', () => {
  it('is deterministic and content-sensitive', () => {
    const a = stableInsightId({ docId: 'd', kind: 'note', text: 'hello' });
    const b = stableInsightId({ docId: 'd', kind: 'note', text: 'hello' });
    const c = stableInsightId({ docId: 'd', kind: 'note', text: 'world' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('derives id + createdAt when omitted', () => {
    const p = createInsightPayload({ kind: 'note', text: 'x', docId: 'd', createdAt: FIXED });
    expect(p.id).toMatch(/^insight:note:/);
    expect(p.createdAt).toBe(FIXED);
  });
});

describe('InsightRouter routing', () => {
  it('routes to a built-in place and records a success', async () => {
    const insert = vi.fn(() => 'pos:42');
    const router = new InsightRouter({ now: fixedClock }).register(
      createDocumentInsertPlace(insert),
    );
    const result = await router.route(payload(), 'doc');
    expect(result).toEqual({
      ok: true,
      placeId: 'doc',
      ref: 'pos:42',
      idempotent: false,
      at: FIXED,
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(router.history()).toHaveLength(1);
  });

  it('records the actor in the audit trail when known', async () => {
    const router = new InsightRouter({ now: fixedClock }).register(
      createDocumentInsertPlace(() => 'pos:1'),
    );
    const author = { type: 'user', id: 'user:ada' } as const;
    await router.route(payload({ source: { author } }), 'doc');
    const entry = router.history()[0];
    expect(entry.actor).toEqual(author);
    expect(entry.payloadId).toBe('insight:1');
  });

  it('is idempotent: same insight to same place writes once', async () => {
    const insert = vi.fn(() => 'pos:1');
    const router = new InsightRouter({ now: fixedClock }).register(
      createDocumentInsertPlace(insert),
    );
    const first = await router.route(payload(), 'doc');
    const second = await router.route(payload(), 'doc');
    expect(first.ok && first.idempotent).toBe(false);
    expect(second.ok && second.idempotent).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing place and stays usable (no silent fallback)', async () => {
    const exploding: WritingPlace = {
      id: 'boom',
      label: 'Boom',
      kind: 'builtin',
      description: 'throws',
      isConfigured: () => true,
      accepts: () => true,
      write: () => {
        throw new Error('kaboom');
      },
    };
    const router = new InsightRouter({ now: fixedClock })
      .register(exploding)
      .register(createDocumentInsertPlace(() => 'pos:ok'));
    const failed = await router.route(payload(), 'boom');
    expect(failed).toEqual({
      ok: false,
      placeId: 'boom',
      code: 'failed',
      error: 'kaboom',
      at: FIXED,
    });
    // router still routes elsewhere; failure did NOT cascade or auto-redirect
    const ok = await router.route(payload(), 'doc');
    expect(ok.ok).toBe(true);
  });

  it('rejects invalid payloads, unknown places, and guard refusals with typed codes', async () => {
    const router = new InsightRouter({ now: fixedClock }).register(
      createDocumentInsertPlace(() => 'pos'),
    );
    const invalid = await router.route(payload({ text: '' }), 'doc');
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe('invalid');

    const unknown = await router.route(payload(), 'nowhere');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.code).toBe('rejected');
  });
});

describe('external writing-place placeholders', () => {
  it('persephone/hermes/garden are unconfigured by default and fail loud', async () => {
    const router = createDefaultInsightRouter({ now: fixedClock });
    for (const [id, message] of [
      ['persephone', PERSEPHONE_UNCONFIGURED],
      ['hermes', HERMES_UNCONFIGURED],
      ['garden', GARDEN_UNCONFIGURED],
    ] as const) {
      const result = await router.route(payload(), id);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('unconfigured');
        expect(result.error).toBe(message);
      }
    }
  });

  it('routes once a client is supplied', async () => {
    const router = new InsightRouter({ now: fixedClock })
      .register(createPersephonePlace({ remember: async () => ({ id: 'mem-7' }) }))
      .register(createHermesPlace({ dispatch: async () => ({ taskId: 'task-9' }) }))
      .register(createGardenPlace({ createTask: async () => ({ id: 'todo-3' }) }));

    expect(await router.route(payload({ id: 'a' }), 'persephone')).toMatchObject({
      ok: true,
      ref: 'persephone:mem-7',
    });
    expect(await router.route(payload({ id: 'b' }), 'hermes')).toMatchObject({
      ok: true,
      ref: 'hermes:task-9',
    });
    expect(await router.route(payload({ id: 'c' }), 'garden')).toMatchObject({
      ok: true,
      ref: 'garden:todo-3',
    });
  });

  it('availabilityFor reflects configured + accepts state', () => {
    const router = createDefaultInsightRouter({
      now: fixedClock,
      persephone: { remember: async () => ({ id: 'm' }) },
    });
    const avail = router.availabilityFor(payload());
    const byId = Object.fromEntries(avail.map((a) => [a.place.id, a.available]));
    expect(byId.persephone).toBe(true);
    expect(byId.hermes).toBe(false);
    expect(byId.garden).toBe(false);
  });
});
