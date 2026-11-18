import { canonicalize } from '@lash/types';

type Path = (string | number)[];
type Replace = { path: Path; value: unknown };
type Splice = { path: Path; start: number; remove: number; insert: unknown[] };
export type BodyChange = Replace | Splice;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const same = (left: unknown, right: unknown) =>
  left === right || canonicalize(left) === canonicalize(right);

export function createBodyPatch(before: unknown, after: unknown): BodyChange[] {
  const changes: BodyChange[] = [];
  function visit(left: unknown, right: unknown, path: Path) {
    if (left === right) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length === right.length) {
        left.forEach((child, index) => visit(child, right[index], [...path, index]));
        return;
      }
      let start = 0;
      let end = 0;
      while (start < left.length && start < right.length && same(left[start], right[start]))
        start += 1;
      while (
        end < left.length - start &&
        end < right.length - start &&
        same(left[left.length - 1 - end], right[right.length - 1 - end])
      )
        end += 1;
      changes.push({
        path,
        start,
        remove: left.length - start - end,
        insert: right.slice(start, right.length - end),
      });
      return;
    }
    if (isObject(left) && isObject(right)) {
      const keys = Object.keys(left).sort();
      if (
        keys.length === Object.keys(right).length &&
        keys.every((key) => Object.hasOwn(right, key))
      ) {
        for (const key of keys) visit(left[key], right[key], [...path, key]);
        return;
      }
    }
    changes.push({ path, value: right });
  }
  visit(before, after, []);
  return changes;
}

const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const validIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const follow = (node: unknown, part: unknown): unknown => {
  if (Array.isArray(node) && validIndex(part) && part < node.length) return node[part];
  if (
    isObject(node) &&
    typeof part === 'string' &&
    !forbiddenKeys.has(part) &&
    Object.hasOwn(node, part)
  ) {
    return node[part];
  }
  throw new Error('History body path is invalid');
};

const updateAt = (
  node: unknown,
  path: unknown[],
  offset: number,
  transform: (value: unknown) => unknown,
): unknown => {
  if (offset === path.length) return transform(node);
  const part = path[offset];
  const value = updateAt(follow(node, part), path, offset + 1, transform);
  if (Array.isArray(node)) {
    const next = node.slice();
    next[part as number] = value;
    return next;
  }
  return { ...(node as Record<string, unknown>), [part as string]: value };
};

export function applyBodyPatch(snapshot: Record<string, unknown>, encoded: unknown) {
  if (!Array.isArray(encoded) || encoded.length > 1_000)
    throw new Error('History body patch is invalid');
  let result: unknown = snapshot;
  for (const change of encoded as unknown[]) {
    if (!isObject(change) || !Array.isArray(change.path) || change.path.length > 64) {
      throw new Error('History body change is invalid');
    }
    const path = change.path as unknown[];
    if ('value' in change) {
      result = updateAt(result, path, 0, () => structuredClone(change.value));
      continue;
    }
    result = updateAt(result, path, 0, (target) => {
      const { start, remove, insert } = change;
      if (
        !Array.isArray(target) ||
        !validIndex(start) ||
        !validIndex(remove) ||
        start + remove > target.length ||
        !Array.isArray(insert)
      ) {
        throw new Error('History body splice is invalid');
      }
      return [
        ...target.slice(0, start),
        ...structuredClone(insert),
        ...target.slice(start + remove),
      ];
    });
  }
  if (!isObject(result) || result.type !== 'doc')
    throw new Error('History editor snapshot is invalid');
  return result;
}
