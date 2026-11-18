import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

type LashTestWindow = Window & {
  __lashEditor?: Editor;
};

test.describe('md-h2-shorthand', () => {
  test('converts markdown heading and applies bold/italic hotkeys', async ({ page }) => {
    await page.goto('/');

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.keyboard.type('## ');
    await page.keyboard.type('Outline Title');
    await page.keyboard.press('Enter');

    await expect(editor.locator('h2')).toHaveText('Outline Title');

    await page.keyboard.press(`${modKey}+B`);
    await page.keyboard.insertText('Bold');
    await page.keyboard.press(`${modKey}+B`);
    await page.keyboard.insertText(' ');
    await page.keyboard.press(`${modKey}+I`);
    await page.keyboard.insertText('Italic');
    await page.keyboard.press(`${modKey}+I`);

    const finalDoc = await page.evaluate(() => {
      const editor = (
        window as unknown as {
          __lashEditor?: { state: { doc: { toJSON: () => unknown } } };
        }
      ).__lashEditor;
      return editor?.state.doc.toJSON();
    });

    const paragraphContent =
      (
        finalDoc as {
          content: Array<{ content?: Array<{ text?: string; marks?: Array<{ type: string }> }> }>;
        }
      )?.content?.[1]?.content ?? [];

    const boldMarkExists = paragraphContent.some(
      (node) => node.text?.includes('Bold') && node.marks?.some((mark) => mark.type === 'bold'),
    );
    const italicMarkExists = paragraphContent.some(
      (node) => node.text === 'Italic' && node.marks?.some((mark) => mark.type === 'italic'),
    );

    expect(boldMarkExists).toBe(true);
    expect(italicMarkExists).toBe(true);
  });

  test('keeps the first character ordered during zero-delay heading input', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));

    const editor = page.getByTestId('lash-editor-content');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const title = `Outline Title ${attempt}`;
      await page.evaluate(() => {
        const editorInstance = (window as LashTestWindow).__lashEditor;
        if (!editorInstance) throw new Error('Lash editor test hook is unavailable');
        editorInstance.commands.setContent('<p></p>');
      });
      await editor.click();
      await page.keyboard.type('## ');
      await page.keyboard.type(title);
      await page.keyboard.press('Enter');

      const headings = await page.evaluate(() => {
        const editorInstance = (window as LashTestWindow).__lashEditor;
        if (!editorInstance) throw new Error('Lash editor test hook is unavailable');
        return editorInstance.getJSON().content?.filter((node) => node.type === 'heading') ?? [];
      });
      expect(headings).toHaveLength(1);
      expect(headings[0]?.content?.map((node) => node.text ?? '').join('')).toBe(title);
    }
  });

  test('keeps the first character ordered after the heading hotkey', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));

    const editor = page.getByTestId('lash-editor-content');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const title = `Hotkey Heading ${attempt}`;
      await page.evaluate(() => {
        const editorInstance = (window as LashTestWindow).__lashEditor;
        if (!editorInstance) throw new Error('Lash editor test hook is unavailable');
        editorInstance.commands.setContent('<p></p>');
      });
      await editor.click();
      await page.keyboard.press(`${modKey}+Alt+2`);
      await page.keyboard.type(title);
      await page.keyboard.press('Enter');

      const headings = await page.evaluate(() => {
        const editorInstance = (window as LashTestWindow).__lashEditor;
        if (!editorInstance) throw new Error('Lash editor test hook is unavailable');
        return editorInstance.getJSON().content?.filter((node) => node.type === 'heading') ?? [];
      });
      expect(headings).toHaveLength(1);
      expect(headings[0]?.content?.map((node) => node.text ?? '').join('')).toBe(title);
    }
  });

  test('keeps composition-first input ordered after H1/H2/H3 hotkeys', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));

    const editor = page.getByTestId('lash-editor-content');
    for (const level of [1, 2, 3] as const) {
      const title = `日本語見出し${level}`;
      await page.evaluate(() => {
        const editorInstance = (window as LashTestWindow).__lashEditor;
        if (!editorInstance) throw new Error('Lash editor test hook is unavailable');
        editorInstance.commands.setContent('<p></p>');
      });
      await editor.click();
      await page.keyboard.press(`${modKey}+Alt+${level}`);
      await page.evaluate(() => {
        const proseMirror = document.querySelector('.ProseMirror');
        proseMirror?.dispatchEvent(
          new CompositionEvent('compositionstart', { bubbles: true, data: '' }),
        );
      });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const editorInstance = (window as LashTestWindow).__lashEditor;
            if (!editorInstance) throw new Error('Lash editor test hook is unavailable');
            return editorInstance.view.composing;
          }),
        )
        .toBe(true);
      await page.keyboard.insertText(title);
      await page.evaluate((composedText) => {
        const proseMirror = document.querySelector('.ProseMirror');
        proseMirror?.dispatchEvent(
          new CompositionEvent('compositionend', { bubbles: true, data: composedText }),
        );
      }, title);

      await expect(editor.locator(`h${level}`)).toHaveText(title);
      await page.keyboard.press('Enter');
      const headings = await page.evaluate(() => {
        const editorInstance = (window as LashTestWindow).__lashEditor;
        if (!editorInstance) throw new Error('Lash editor test hook is unavailable');
        return editorInstance.getJSON().content?.filter((node) => node.type === 'heading') ?? [];
      });
      expect(headings).toHaveLength(1);
      expect(headings[0]?.content?.map((node) => node.text ?? '').join('')).toBe(title);
    }
  });

  test('keeps paste-first input ordered after a heading hotkey', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();
    await page.keyboard.press(`${modKey}+Alt+2`);
    await page.evaluate((pastedText) => {
      const proseMirror = document.querySelector('.ProseMirror');
      if (!proseMirror) throw new Error('ProseMirror editor is unavailable');
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', pastedText);
      const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: clipboard });
      proseMirror.dispatchEvent(paste);
    }, 'Pasted heading');

    await expect(editor.locator('h2')).toHaveText('Pasted heading');
    await page.keyboard.press('Enter');
    const headings = await page.evaluate(() => {
      const editorInstance = (window as LashTestWindow).__lashEditor;
      if (!editorInstance) throw new Error('Lash editor test hook is unavailable');
      return editorInstance.getJSON().content?.filter((node) => node.type === 'heading') ?? [];
    });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.content?.map((node) => node.text ?? '').join('')).toBe('Pasted heading');
  });
});
