import { canonicalize } from '@lash/types';
import { Fragment, type Node, Slice, type Mark } from '@tiptap/pm/model';

export type SuggestionRange = { from: number; to: number };

/** A suggestion replaces text within one textblock. Atoms and structural edits
 * remain ordinary editor operations.
 */
export function readSuggestionRange(doc: Node, { from, to }: SuggestionRange) {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 1 ||
    from >= to ||
    to > doc.content.size
  )
    return null;
  const start = doc.resolve(from);
  if (!start.sameParent(doc.resolve(to)) || !start.parent.isTextblock) return null;
  const slice = doc.slice(from, to);
  if (slice.openStart || slice.openEnd) return null;
  let marks: readonly Mark[] | undefined;
  let text = '';
  let textOnly = true;
  slice.content.forEach((node) => {
    if (!node.isText || node.text === undefined) {
      textOnly = false;
      return;
    }
    text += node.text;
    marks = marks ? marks.filter((mark) => mark.isInSet(node.marks)) : node.marks;
  });
  if (!textOnly || !text.trim() || !isWellFormedSuggestionText(text)) return null;
  return { text, before: canonicalize(slice.toJSON()), marks: marks ?? [] };
}

export function isWellFormedSuggestionText(text: string) {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
}

export function prepareSuggestionReplacement(
  doc: Node,
  range: SuggestionRange,
  before: string,
  replacement: string,
) {
  const target = readSuggestionRange(doc, range);
  if (
    !target ||
    target.before !== before ||
    target.text === replacement ||
    /[\r\n\u2028\u2029]/u.test(replacement) ||
    !isWellFormedSuggestionText(replacement)
  ) {
    return null;
  }
  const content = replacement
    ? new Slice(Fragment.from(doc.type.schema.text(replacement, target.marks)), 0, 0)
    : Slice.empty;
  const next = doc.replace(range.from, range.to, content);
  next.check();
  return { content, doc: next };
}
