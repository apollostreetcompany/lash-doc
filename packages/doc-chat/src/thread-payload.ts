import type { DocumentId } from '@lash/types';

import type { ChatAnchor, ChatMessage, ChatRelativePosition, StoredChatThread } from './index';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const parseItemId = (value: unknown) =>
  isRecord(value) && isOffset(value.client) && isOffset(value.clock)
    ? { client: value.client, clock: value.clock }
    : undefined;

const parseRelativePosition = (value: unknown): ChatRelativePosition | null => {
  if (!isRecord(value)) return null;
  const type = parseItemId(value.type);
  const item = parseItemId(value.item);
  const tname = typeof value.tname === 'string' ? value.tname : undefined;
  if (!type && !item && tname === undefined) return null;
  return {
    ...(type ? { type } : {}),
    ...(item ? { item } : {}),
    ...(tname !== undefined ? { tname } : {}),
    ...(typeof value.assoc === 'number' && Number.isSafeInteger(value.assoc)
      ? { assoc: value.assoc }
      : {}),
  };
};

export const normalizeChatAnchor = (value: unknown): ChatAnchor | null => {
  if (
    !isRecord(value) ||
    (value.baseVersion !== null && typeof value.baseVersion !== 'string') ||
    !isOffset(value.from) ||
    !isOffset(value.to) ||
    value.from > value.to ||
    !isRecord(value.token)
  ) {
    return null;
  }
  const { token } = value;
  if (
    typeof token.before !== 'string' ||
    typeof token.after !== 'string' ||
    typeof token.text !== 'string' ||
    !isOffset(token.occurrence)
  ) {
    return null;
  }
  const relativeRange = isRecord(value.relativeRange) ? value.relativeRange : null;
  const start = parseRelativePosition(relativeRange?.start);
  const end = parseRelativePosition(relativeRange?.end);
  return {
    baseVersion: value.baseVersion,
    from: value.from,
    to: value.to,
    token: {
      before: token.before,
      after: token.after,
      text: token.text,
      occurrence: token.occurrence,
      ...(typeof token.nodeId === 'string' ? { nodeId: token.nodeId } : {}),
      ...(Array.isArray(token.nodePath) && token.nodePath.every(isOffset)
        ? { nodePath: token.nodePath as number[] }
        : {}),
      ...(typeof token.confidence === 'number' ? { confidence: token.confidence } : {}),
    },
    ...(value.assoc === -1 || value.assoc === 1 ? { assoc: value.assoc } : {}),
    ...(typeof value.orphaned === 'boolean' ? { orphaned: value.orphaned } : {}),
    ...(start && end ? { relativeRange: { start, end } } : {}),
  };
};

const normalizeAuthor = (value: unknown): ChatMessage['author'] | null => {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  if (value.type === 'user' || value.type === 'system') {
    return { type: value.type, id: value.id };
  }
  if (value.type === 'ai') {
    return {
      type: value.type,
      id: value.id,
      ...(typeof value.label === 'string' ? { label: value.label } : {}),
    };
  }
  return null;
};

const normalizeChatMessage = (value: unknown): ChatMessage | null => {
  if (!isRecord(value)) return null;
  const author = normalizeAuthor(value.author);
  if (
    !author ||
    typeof value.id !== 'string' ||
    typeof value.threadId !== 'string' ||
    typeof value.ts !== 'string' ||
    typeof value.body !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    threadId: value.threadId,
    author,
    ts: value.ts,
    body: value.body,
    ...(Array.isArray(value.citations)
      ? { citations: value.citations as ChatMessage['citations'] }
      : {}),
  };
};

const normalizeChatThread = (value: unknown, docId: DocumentId): StoredChatThread | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || !Array.isArray(value.messages)) {
    return null;
  }
  const anchor = normalizeChatAnchor(value.anchor);
  if (!anchor) return null;
  const messages = value.messages
    .map(normalizeChatMessage)
    .filter((message): message is ChatMessage => message !== null && message.threadId === value.id);
  const status = value.status === 'resolved' ? 'resolved' : 'open';
  return {
    id: value.id,
    docId,
    anchor,
    messages,
    filters: isRecord(value.filters) ? value.filters : {},
    historyText: typeof value.historyText === 'string' ? value.historyText : '',
    status,
    resolvedAt:
      status === 'resolved' && typeof value.resolvedAt === 'string' ? value.resolvedAt : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : (messages.at(-1)?.ts ?? ''),
  };
};

const parseJson = (value: string | null | undefined): unknown => {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

export const parseChatThread = (value: string | null | undefined, docId: DocumentId) =>
  normalizeChatThread(parseJson(value), docId);

export const parseChatThreads = (value: string | null | undefined, docId: DocumentId) => {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed
        .map((thread) => normalizeChatThread(thread, docId))
        .filter((thread): thread is StoredChatThread => thread !== null)
    : [];
};
