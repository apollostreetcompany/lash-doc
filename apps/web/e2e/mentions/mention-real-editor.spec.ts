import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

const editorJson = async (page: Page) =>
  page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    return editor.getJSON();
  });

test.describe('real editor mention workflow', () => {
  test('selecting a user suggestion replaces the typed query with an inline mention node', async ({
    page,
  }) => {
    await page.goto('/');
    await ready(page);

    await page.getByTestId('lash-editor-content').click();
    await page.keyboard.type('Draft for @Ada');

    const suggestion = page.getByTestId('mention-suggestion').filter({ hasText: 'Ada Lovelace' });
    await expect(suggestion).toBeVisible();
    await suggestion.click();

    const inlineMention = page.getByTestId('lash-inline-mention').first();
    await expect(inlineMention).toBeVisible();
    await expect(inlineMention).toHaveAttribute('data-kind', 'user');
    await expect(inlineMention).toHaveText('@Ada Lovelace');

    await expect
      .poll(() => editorJson(page))
      .toMatchObject({
        content: [
          {
            content: expect.arrayContaining([
              {
                type: 'mention',
                attrs: expect.objectContaining({
                  kind: 'user',
                  refId: 'user:ada',
                  display: 'Ada Lovelace',
                }),
              },
            ]),
          },
        ],
      });
  });

  test('selecting a natural-date suggestion inserts a date mention chip in the editor', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-06-23T00:00:00+09:00'));
    await page.goto('/');
    await ready(page);

    await page.getByTestId('lash-editor-content').click();
    await page.keyboard.type('Review @next Friday 3pm');

    const suggestion = page.getByTestId('mention-suggestion').filter({ hasText: /Fri/i });
    await expect(suggestion).toBeVisible();
    await suggestion.click();

    const inlineMention = page.getByTestId('lash-inline-mention').first();
    await expect(inlineMention).toBeVisible();
    await expect(inlineMention).toHaveAttribute('data-kind', 'date');
    await expect(inlineMention).toHaveAttribute('data-iso', '2026-06-26T15:00:00+09:00');
    await expect(page.getByTestId('lash-editor-content')).not.toContainText('@next Friday');

    await expect
      .poll(() => editorJson(page))
      .toMatchObject({
        content: [
          {
            content: expect.arrayContaining([
              {
                type: 'mention',
                attrs: expect.objectContaining({
                  kind: 'date',
                  iso: '2026-06-26T15:00:00+09:00',
                }),
              },
            ]),
          },
        ],
      });
  });
});
