import type { LashImageUploader } from '@lash/editor-core';

interface UploadMockControls {
  failNext?: boolean;
  mode?: 'alwaysFail' | 'alwaysSucceed';
  nextUrl?: string;
  nextWidth?: number;
  delayMs?: number;
}

let uploadCounter = 0;

export const createBrowserImageUploader = (): LashImageUploader => {
  return {
    upload(file, onProgress) {
      uploadCounter += 1;
      const globalControls = (typeof window !== 'undefined'
        ? ((window as unknown as { __lashImageUploadMock?: UploadMockControls }).__lashImageUploadMock ?? {})
        : {}) as UploadMockControls;

      const shouldFail = Boolean(globalControls.failNext) || globalControls.mode === 'alwaysFail';
      if (globalControls.failNext) {
        globalControls.failNext = false;
      }

      const delay = Math.max(globalControls.delayMs ?? 160, 60);
      const targetWidth =
        typeof globalControls.nextWidth === 'number'
          ? globalControls.nextWidth
          : Math.min(800, Math.max(240, Math.round(file.size / 12) + 320));
      const url =
        globalControls.nextUrl ?? `https://assets.lash.dev/mock/image-${uploadCounter}.png`;

      let progress = 0;

      return new Promise<{ src: string; width: number }>((resolve, reject) => {
        const tick = () => {
          progress = Math.min(progress + 0.25, 0.95);
          onProgress(progress);
        };

        const interval = typeof window !== 'undefined' ? window.setInterval(tick, delay / 4) : null;

        const finalize = () => {
          if (interval !== null) {
            window.clearInterval(interval);
          }
        };

        if (shouldFail) {
          window.setTimeout(() => {
            finalize();
            reject(new Error('Mock upload failed'));
          }, delay);
          return;
        }

        window.setTimeout(() => {
          finalize();
          onProgress(1);
          resolve({ src: url, width: targetWidth });
        }, delay);
      });
    },
  };
};

export type { UploadMockControls };
