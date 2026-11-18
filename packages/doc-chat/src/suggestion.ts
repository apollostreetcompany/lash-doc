import type { ChatAnchor, ChatRelativePosition, ChatRelativeRange } from './index';

export type SuggestionDecision = 'accepted' | 'rejected';

export type SuggestionContent = {
  before: string;
  replacement: string;
};

export type ReviewProposal = SuggestionContent & { anchor: ChatAnchor<null> };

export type ReviewProposalView = {
  replacement: string;
  status: 'pending' | SuggestionDecision;
  actorId: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
};

export const MAX_SUGGESTION_TEXT = 1_000;

export const readSuggestionContent = (value: Record<string, unknown>): SuggestionContent | null => {
  const { before, replacement } = value;
  if (
    typeof before !== 'string' ||
    !before ||
    before.length > 5_000 ||
    typeof replacement !== 'string' ||
    replacement.length > MAX_SUGGESTION_TEXT ||
    /[\r\n\u2028\u2029]/u.test(replacement)
  )
    return null;
  return { before, replacement };
};

const isTextEdge = (edge: ChatRelativePosition, assoc: -1 | 0) =>
  edge.assoc === assoc && Boolean(edge.type && edge.item) && edge.tname === undefined;

export function hasSuggestionEdges(range: ChatRelativeRange | undefined) {
  return Boolean(range && isTextEdge(range.start, 0) && isTextEdge(range.end, -1));
}
