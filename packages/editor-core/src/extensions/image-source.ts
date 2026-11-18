export const MAX_IMAGE_FILE_BYTES = 256 * 1024;

const imageTypes: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

export const isSupportedImageType = (type: string) => imageTypes.has(type);

const hasText = (bytes: string, offset: number, value: string) => bytes.startsWith(value, offset);

export const hasImageSignature = (type: string, bytes: string): boolean => {
  switch (type) {
    case 'image/png':
      return hasText(bytes, 0, '\x89PNG\r\n\x1a\n') && hasText(bytes, 12, 'IHDR');
    case 'image/jpeg':
    case 'image/jpg':
      return hasText(bytes, 0, '\xff\xd8\xff');
    case 'image/gif':
      return hasText(bytes, 0, 'GIF87a') || hasText(bytes, 0, 'GIF89a');
    case 'image/webp':
      return hasText(bytes, 0, 'RIFF') && hasText(bytes, 8, 'WEBP');
    case 'image/avif': {
      if (!hasText(bytes, 4, 'ftyp') || bytes.length < 16) return false;
      const boxLength =
        bytes.charCodeAt(0) * 0x1000000 +
        bytes.charCodeAt(1) * 0x10000 +
        bytes.charCodeAt(2) * 0x100 +
        bytes.charCodeAt(3);
      if (boxLength < 16 || boxLength > bytes.length) return false;
      if (hasText(bytes, 8, 'avif') || hasText(bytes, 8, 'avis')) return true;
      for (let offset = 16; offset + 4 <= boxLength; offset += 4) {
        if (hasText(bytes, offset, 'avif') || hasText(bytes, offset, 'avis')) return true;
      }
      return false;
    }
    default:
      return false;
  }
};

export const isEmbeddedRasterImage = (source: string) => {
  const separator = source.indexOf(',');
  if (separator < 0 || !source.startsWith('data:')) return false;
  const match = /^data:(image\/[a-z]+);base64$/u.exec(source.slice(0, separator));
  if (!match || !isSupportedImageType(match[1])) return false;
  const payload = source.slice(separator + 1);
  if (!payload || payload.length > Math.ceil(MAX_IMAGE_FILE_BYTES / 3) * 4) return false;

  try {
    const bytes = atob(payload);
    return (
      bytes.length <= MAX_IMAGE_FILE_BYTES &&
      btoa(bytes) === payload &&
      hasImageSignature(match[1], bytes)
    );
  } catch {
    return false;
  }
};
