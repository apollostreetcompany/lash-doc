import { canonicalize } from '@lash/types';

export function textDiffEdges(before: string, after: string) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { prefix, suffix };
}

type BodyNode = Record<string, unknown> & { type: string };
type MarkRun = { from: number; to: number; style: string };

const isBodyNode = (value: unknown): value is BodyNode =>
  value !== null && typeof value === 'object' && 'type' in value && typeof value.type === 'string';

const isTextNode = (value: unknown): value is BodyNode & { text: string } =>
  isBodyNode(value) && value.type === 'text' && typeof value.text === 'string';

const sameJson = (before: unknown, after: unknown) =>
  before === after || canonicalize(before ?? null) === canonicalize(after ?? null);

const nodeAttrs = (node: BodyNode) => {
  if (!node.attrs || node.type !== 'heading' || typeof node.attrs !== 'object') return node.attrs;
  // Outline identity can be generated from position. Heading level is still compared.
  const { headingId: _headingId, ...attrs } = node.attrs as Record<string, unknown>;
  return attrs;
};

function readInlineText(children: readonly unknown[], start: number) {
  let next = start;
  let length = 0;
  const pieces: string[] = [];
  const runs: MarkRun[] = [];
  while (true) {
    const node = children[next];
    if (!isTextNode(node)) break;
    next += 1;
    if (!node.text.length) continue;
    pieces.push(node.text);
    const style = Array.isArray(node.marks) && node.marks.length ? canonicalize(node.marks) : '';
    const previous = runs.at(-1);
    const end = length + node.text.length;
    if (previous?.style === style) previous.to = end;
    else runs.push({ from: length, to: end, style });
    length = end;
  }
  return { text: pieces.join(''), runs, next };
}

function marksIn(runs: readonly MarkRun[], from: number, to: number) {
  if (from === to) return [];
  const styles: Array<{ style: string; length: number }> = [];
  for (const run of runs) {
    if (run.from >= to) break;
    if (run.to > from) {
      styles.push({ style: run.style, length: Math.min(run.to, to) - Math.max(run.from, from) });
    }
  }
  return styles;
}

const sameStyles = (
  before: ReturnType<typeof marksIn>,
  after: ReturnType<typeof marksIn>,
  compareLength: boolean,
) =>
  before.length === after.length &&
  before.every(
    ({ style, length }, index) =>
      style === after[index].style && (!compareLength || length === after[index].length),
  );

function inlineFormattingChanged(
  before: ReturnType<typeof readInlineText>,
  after: ReturnType<typeof readInlineText>,
) {
  // Identical marks around one edited run remain the same even if a repeated
  // character makes the text-only alignment cross a mark boundary.
  let editedRuns = 0;
  if (
    before.runs.length === after.runs.length &&
    before.runs.every((run, index) => {
      const next = after.runs[index];
      if (run.style !== next.style) return false;
      if (before.text.slice(run.from, run.to) !== after.text.slice(next.from, next.to)) {
        editedRuns += 1;
      }
      return editedRuns <= 1;
    })
  )
    return false;
  const { prefix, suffix } = textDiffEdges(before.text, after.text);
  const beforeEnd = before.text.length - suffix;
  const afterEnd = after.text.length - suffix;
  if (
    !sameStyles(marksIn(before.runs, 0, prefix), marksIn(after.runs, 0, prefix), true) ||
    !sameStyles(
      marksIn(before.runs, beforeEnd, before.text.length),
      marksIn(after.runs, afterEnd, after.text.length),
      true,
    )
  )
    return true;

  if (afterEnd === prefix) return false;
  const inserted = marksIn(after.runs, prefix, afterEnd);
  if (beforeEnd > prefix) {
    // Replacing words inside the same formatting does not change their style.
    return !sameStyles(marksIn(before.runs, prefix, beforeEnd), inserted, false);
  }

  // An insertion may inherit marks from either side of its old caret position.
  const nearbyStyles = new Set(
    before.runs.filter(({ from, to }) => from <= prefix && to >= prefix).map(({ style }) => style),
  );
  return inserted.some(({ style }) => style !== '' && !nearbyStyles.has(style));
}

export function mixedBodyFormattingChanged(before: unknown, after: unknown): boolean {
  if (before === after) return false;
  if (!isBodyNode(before) || !isBodyNode(after)) return !sameJson(before, after);
  if (
    before.type !== after.type ||
    (before.attrs !== after.attrs && !sameJson(nodeAttrs(before), nodeAttrs(after))) ||
    !sameJson(before.marks, after.marks)
  ) {
    return true;
  }

  const beforeChildren = Array.isArray(before.content) ? before.content : [];
  const afterChildren = Array.isArray(after.content) ? after.content : [];
  if (beforeChildren === afterChildren) return false;
  let left = 0;
  let right = 0;
  while (left < beforeChildren.length || right < afterChildren.length) {
    const leftNode: unknown = beforeChildren[left];
    const rightNode: unknown = afterChildren[right];
    if (isTextNode(leftNode) || isTextNode(rightNode)) {
      const beforeText = readInlineText(beforeChildren, left);
      const afterText = readInlineText(afterChildren, right);
      if (inlineFormattingChanged(beforeText, afterText)) return true;
      left = beforeText.next;
      right = afterText.next;
    } else {
      if (mixedBodyFormattingChanged(leftNode, rightNode)) return true;
      left += 1;
      right += 1;
    }
  }
  return false;
}
