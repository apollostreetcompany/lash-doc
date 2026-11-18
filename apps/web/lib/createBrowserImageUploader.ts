import {
  hasImageSignature,
  ImageUploadError,
  isSupportedImageType,
  MAX_IMAGE_FILE_BYTES,
  type LashImageUploader,
} from '@lash/editor-core';

interface UploadMockControls {
  failNext?: boolean;
}

const MAX_IMAGE_EDGE = 4_096;
const MAX_IMAGE_PIXELS = 12_000_000;

const readImageBytes = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read this file. Try again.'));
        return;
      }
      resolve(reader.result);
    });
    reader.addEventListener('error', () =>
      reject(new Error('Could not read this file. Try again.')),
    );
    reader.addEventListener('abort', () =>
      reject(new Error('Could not read this file. Try again.')),
    );
    reader.readAsDataURL(file);
  });

export const createBrowserImageUploader = (): LashImageUploader => ({
  async upload(file, onProgress) {
    if (!isSupportedImageType(file.type)) {
      throw new ImageUploadError('Choose a PNG, JPEG, GIF, WebP, or AVIF image.', false);
    }
    if (!file.size || file.size > MAX_IMAGE_FILE_BYTES) {
      throw new ImageUploadError('Choose a nonempty image up to 256 KiB.', false);
    }
    if (
      process.env.NODE_ENV !== 'production' ||
      process.env.NEXT_PUBLIC_LASH_TEST_HOOKS === 'true'
    ) {
      const controls = (window as Window & { __lashImageUploadMock?: UploadMockControls })
        .__lashImageUploadMock;
      if (controls?.failNext) {
        controls.failNext = false;
        throw new Error('Could not read this file. Try again.');
      }
    }

    const source = await readImageBytes(file);
    const base64 = source.slice(source.indexOf(',') + 1);
    if (!hasImageSignature(file.type, atob(base64))) {
      throw new ImageUploadError('The file does not match its image format.', false);
    }
    onProgress(0.5);

    // The browser checks that the actual bytes decode and supplies the natural
    // dimensions, including orientation. No object URL is saved or shared.
    const image = new Image();
    image.src = source;
    try {
      await image.decode();
    } catch {
      throw new ImageUploadError('Could not open this image. Choose another file.', false);
    }
    const { naturalWidth: width, naturalHeight: height } = image;
    if (
      !width ||
      !height ||
      width > MAX_IMAGE_EDGE ||
      height > MAX_IMAGE_EDGE ||
      width * height > MAX_IMAGE_PIXELS
    ) {
      throw new ImageUploadError(
        'Choose an image up to 4,096 pixels per side and 12 megapixels.',
        false,
      );
    }
    return { src: source, width: Math.min(width, 960) };
  },
});
