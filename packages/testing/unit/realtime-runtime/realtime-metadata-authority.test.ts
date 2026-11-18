import { describe, expect, it, vi } from 'vitest';

import * as realtime from '../../../../apps/web/lib/realtimeCollaboration';
import * as Y from '../../../../apps/web/node_modules/yjs';

type SuggestionResolutionRecord = {
  id: string;
  entryId: string;
  action: 'accepted' | 'rejected';
  ts: string;
  actorId: string;
};

type RealtimeMetadataApi = {
  REALTIME_SUGGESTION_RESOLUTIONS_YMAP: string;
  readRealtimeDocumentTitle(doc: Y.Doc): string | null;
  readRealtimeSuggestionResolutions(
    map: Y.Map<string>,
    documentId: string,
  ): SuggestionResolutionRecord[];
  replaceRealtimeSuggestionResolutions(
    map: Y.Map<string>,
    documentId: string,
    records: SuggestionResolutionRecord[],
  ): void;
  writeRealtimeDocumentTitle(doc: Y.Doc, title: string): void;
};

const api = realtime as typeof realtime & Partial<RealtimeMetadataApi>;

describe('realtime metadata authority', () => {
  it('converges title through the Y.Doc without consulting local title storage', () => {
    expect(typeof api.writeRealtimeDocumentTitle).toBe('function');
    expect(typeof api.readRealtimeDocumentTitle).toBe('function');
    const first = realtime.createRealtimeDocument();
    const second = realtime.createRealtimeDocument();
    first.on('update', (update: Uint8Array) => Y.applyUpdate(second, update));

    api.writeRealtimeDocumentTitle!(first, 'Canonical shared title');

    expect(api.readRealtimeDocumentTitle!(first)).toBe('Canonical shared title');
    expect(api.readRealtimeDocumentTitle!(second)).toBe('Canonical shared title');
  });

  it('stores one canonical suggestion resolution per entry with no accepted/rejected split', () => {
    expect(typeof api.replaceRealtimeSuggestionResolutions).toBe('function');
    expect(typeof api.readRealtimeSuggestionResolutions).toBe('function');
    expect(typeof api.REALTIME_SUGGESTION_RESOLUTIONS_YMAP).toBe('string');
    const doc = realtime.createRealtimeDocument();
    const map = doc.getMap<string>(api.REALTIME_SUGGESTION_RESOLUTIONS_YMAP!);
    const accepted: SuggestionResolutionRecord = {
      id: 'suggestion-resolution:entry-1:accepted',
      entryId: 'entry-1',
      action: 'accepted',
      ts: '2026-07-18T08:00:00.000Z',
      actorId: 'actor-owner',
    };
    const rejected: SuggestionResolutionRecord = {
      ...accepted,
      id: 'suggestion-resolution:entry-1:rejected',
      action: 'rejected',
      ts: '2026-07-18T08:01:00.000Z',
    };

    api.replaceRealtimeSuggestionResolutions!(map, 'fixture-document', [accepted]);
    api.replaceRealtimeSuggestionResolutions!(map, 'fixture-document', [rejected]);

    expect([...map.keys()]).toHaveLength(1);
    expect(api.readRealtimeSuggestionResolutions!(map, 'fixture-document')).toEqual([rejected]);
  });

  it('looks only in the authoritative shared map even when its document has no decisions', () => {
    const doc = realtime.createRealtimeDocument();
    const map = doc.getMap<string>(realtime.REALTIME_SUGGESTION_RESOLUTIONS_YMAP);
    const cached: SuggestionResolutionRecord = {
      id: 'local-decision',
      entryId: 'entry-1',
      action: 'accepted',
      ts: '2026-07-18T08:00:00.000Z',
      actorId: 'local-actor',
    };
    const readLocal = vi.fn(() => [cached]);
    expect(realtime.readSuggestionResolutionRecords(map, 'fixture-document', readLocal)).toEqual(
      [],
    );
    expect(readLocal).not.toHaveBeenCalled();
    expect([...map.keys()]).toEqual([]);
    const remote = { ...cached, id: 'remote-decision', action: 'rejected' as const };
    realtime.replaceRealtimeSuggestionResolutions(map, 'fixture-document', [remote]);
    expect(realtime.readSuggestionResolutionRecords(map, 'fixture-document', readLocal)).toEqual([
      remote,
    ]);
    expect(readLocal).not.toHaveBeenCalled();
    expect(realtime.readSuggestionResolutionRecords(null, 'fixture-document', readLocal)).toEqual([
      cached,
    ]);
    expect(readLocal).toHaveBeenCalledOnce();
    doc.destroy();
  });
});
