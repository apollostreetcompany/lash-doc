import { expect, type Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';

const sampleDocument = `
  <h1>Chapter One</h1>
  <p>Opening paragraph.</p>
  <h2>Section Alpha</h2>
  <p>Alpha body one.</p>
  <p>Alpha body two.</p>
  <h3>Deep Dive</h3>
  <p>Nested insight.</p>
  <h2>Section Beta</h2>
  <p>Beta body.</p>
`;

type OutlineTestWindow = Window & { __lashEditor?: Editor };

export async function seedOutlineDocument(page: Page) {
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await page.waitForFunction(() => (window as OutlineTestWindow).__lashEditor?.isEditable);
  const seeded = await page.evaluate(
    (html) => (window as OutlineTestWindow).__lashEditor?.commands.setContent(html),
    sampleDocument,
  );
  expect(seeded).toBe(true);

  const outline = page.getByRole('navigation', { name: 'Outline' });
  await expect(outline.getByRole('button', { name: 'Jump to Section Alpha' })).toBeVisible();
  return { editor, outline };
}
