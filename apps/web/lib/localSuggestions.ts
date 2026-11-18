import { isReviewId, MAX_SUGGESTION_TEXT, readSuggestionContent } from '@lash/doc-chat';
import { readSuggestionRange, type SuggestionRange } from '@lash/editor-core';
import type { Transaction } from '@tiptap/pm/state';

export type LocalSuggestion = {
  id: string;
  quote: string;
  before: string;
  replacement: string;
  note: string;
  range: SuggestionRange | null;
  createdAt: string;
  decision?: { action: 'accepted' | 'rejected'; at: string };
};

export const MAX_LOCAL_SUGGESTIONS = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
  Number.isFinite(Date.parse(value));

export function parseLocalSuggestions(value: unknown): LocalSuggestion[] | null {
  if (!Array.isArray(value) || value.length > MAX_LOCAL_SUGGESTIONS) return null;
  const ids = new Set<string>();
  const records: LocalSuggestion[] = [];
  for (const item of value as unknown[]) {
    if (!isRecord(item)) return null;
    const { id, quote, note, range, createdAt, decision } = item;
    const content = readSuggestionContent(item);
    if (
      !isReviewId(id) ||
      ids.has(id) ||
      !content ||
      typeof quote !== 'string' ||
      !quote.trim() ||
      quote.length > MAX_SUGGESTION_TEXT ||
      typeof note !== 'string' ||
      note.length > 2_000 ||
      !isTimestamp(createdAt)
    )
      return null;
    let target: SuggestionRange | null = null;
    if (range !== null) {
      if (!isRecord(range)) return null;
      const { from, to } = range;
      if (
        typeof from !== 'number' ||
        typeof to !== 'number' ||
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from < 1 ||
        from >= to
      )
        return null;
      target = { from, to };
    }
    const record: LocalSuggestion = { id, quote, note, range: target, createdAt, ...content };
    if (decision !== undefined) {
      if (
        !isRecord(decision) ||
        (decision.action !== 'accepted' && decision.action !== 'rejected') ||
        !isTimestamp(decision.at)
      )
        return null;
      record.decision = { action: decision.action, at: decision.at };
    }
    ids.add(id);
    records.push(record);
  }
  return records;
}

export function mapLocalSuggestions(
  suggestions: LocalSuggestion[],
  transaction: Transaction,
): LocalSuggestion[] {
  if (!transaction.docChanged) return suggestions;
  let changed = false;
  const next = suggestions.map((suggestion) => {
    if (!suggestion.range || suggestion.decision) return suggestion;
    let { from, to } = suggestion.range;
    let overlaps = false;
    for (const step of transaction.mapping.maps) {
      step.forEach((start, end) => {
        if (start < to && end > from) {
          overlaps = true;
        }
      });
      const start = step.mapResult(from, 1);
      const end = step.mapResult(to, -1);
      if (start.deleted || end.deleted || start.pos >= end.pos) overlaps = true;
      from = start.pos;
      to = end.pos;
    }
    const range =
      !overlaps && readSuggestionRange(transaction.doc, { from, to })?.before === suggestion.before
        ? { from, to }
        : null;
    if (range?.from === suggestion.range.from && range.to === suggestion.range.to)
      return suggestion;
    changed = true;
    return { ...suggestion, range };
  });
  return changed ? next : suggestions;
}
