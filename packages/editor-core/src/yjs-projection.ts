const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const isExactEmptyPlainObject = (value: unknown) =>
  isPlainObject(value) && Object.keys(value).length === 0;

type ProjectionObject = 'node' | 'mark' | 'other';

const cloneProjectionValue = (value: unknown, kind: ProjectionObject): unknown => {
  if (Array.isArray(value)) {
    return value.map((child) => cloneProjectionValue(child, kind));
  }
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (kind === 'mark' && key === 'attrs' && isExactEmptyPlainObject(child)) return [];
      if (kind === 'node' && value.type === 'image' && key === 'attrs' && isPlainObject(child)) {
        return [
          [
            key,
            cloneProjectionValue(
              { uploadId: null, previewSrc: null, error: null, ...child },
              'other',
            ),
          ],
        ];
      }
      if (key === 'marks' && Array.isArray(child)) {
        return [[key, cloneProjectionValue(child, 'mark')]];
      }
      return [
        [key, cloneProjectionValue(child, kind === 'node' && key === 'content' ? 'node' : 'other')],
      ];
    }),
  );
};

/**
 * Y-ProseMirror emits empty attrs for attribute-free marks and omits null
 * attrs on image nodes. Restore the ProseMirror representation of those
 * fields only so exact-schema and promotion comparisons use the same shape.
 */
export const normalizeYProsemirrorProjectionJson = (projection: unknown): unknown =>
  cloneProjectionValue(projection, 'node');
