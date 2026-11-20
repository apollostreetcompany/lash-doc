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

function stylesIn(runs: readonly MarkRun[], from: number, to: number) {
  const styles: string[] = [];
  for (const run of runs) {
    if (run.from >= to) break;
    if (run.to > from) styles.push(run.style);
  }
  return styles;
}

function retainedStyleChanged(
  before: readonly MarkRun[],
  after: readonly MarkRun[],
  beforeStart: number,
  afterStart: number,
  length: number,
): boolean {
  if (!length) return false;
  const beforeEnd = beforeStart + length;
  let next = 0;
  for (const run of before) {
    if (run.from >= beforeEnd) break;
    if (run.to <= beforeStart) continue;
    const start = afterStart + Math.max(run.from, beforeStart) - beforeStart;
    const end = afterStart + Math.min(run.to, beforeEnd) - beforeStart;
    while (next < after.length && after[next].to <= start) next += 1;
    for (let index = next; index < after.length && after[index].from < end; index += 1) {
      if (after[index].style !== run.style) return true;
    }
  }
  return false;
}

function containsInOrder(text: string, retained: string): boolean {
  if (retained.length > text.length) return false;
  let next = 0;
  for (let index = 0; index < text.length && next < retained.length; index += 1) {
    if (text[index] === retained[next]) next += 1;
  }
  return next === retained.length;
}

function inlineFormattingChanged(
  before: ReturnType<typeof readInlineText>,
  after: ReturnType<typeof readInlineText>,
) {
  const pairedStyles =
    before.runs.length === after.runs.length &&
    before.runs.every((run, index) => run.style === after.runs[index].style);
  if (pairedStyles && before.runs.length < 2) return false;
  if (pairedStyles && before.text.length !== after.text.length) {
    const [shorter, longer] =
      before.text.length < after.text.length ? [before, after] : [after, before];
    const sameStyleLengthEdits = shorter.runs.every(({ from, to }, index) => {
      const run = longer.runs[index];
      return containsInOrder(longer.text.slice(run.from, run.to), shorter.text.slice(from, to));
    });
    if (sameStyleLengthEdits) return false;
  }
  // Prefer matching text inside the same style before looking across run boundaries.
  // With repeating text a flat prefix can otherwise consume a typed character in another run.
  const previousRuns =
    pairedStyles && before.text !== after.text
      ? before.runs.flatMap((run, index) => {
          const next = after.runs[index];
          const { prefix, suffix } = textDiffEdges(
            before.text.slice(run.from, run.to),
            after.text.slice(next.from, next.to),
          );
          const from = run.from + prefix;
          const to = run.to - suffix;
          return from < to ? [{ from, to, style: run.style }] : [];
        })
      : before.runs;
  const { prefix, suffix } = textDiffEdges(before.text, after.text);
  const beforeEnd = before.text.length - suffix;
  const afterEnd = after.text.length - suffix;
  if (
    retainedStyleChanged(previousRuns, after.runs, 0, 0, prefix) ||
    retainedStyleChanged(previousRuns, after.runs, beforeEnd, afterEnd, suffix)
  )
    return true;

  if (pairedStyles || afterEnd === prefix) return false;
  const inserted = stylesIn(after.runs, prefix, afterEnd);
  if (beforeEnd > prefix) {
    // Replacing words inside the same formatting does not change their style.
    const deleted = stylesIn(before.runs, prefix, beforeEnd);
    return (
      deleted.length !== inserted.length ||
      deleted.some((style, index) => style !== inserted[index])
    );
  }

  // An insertion may inherit marks from either side of its old caret position.
  const nearbyStyles = new Set(
    before.runs.filter(({ from, to }) => from <= prefix && to >= prefix).map(({ style }) => style),
  );
  return inserted.some((style) => style !== '' && !nearbyStyles.has(style));
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
