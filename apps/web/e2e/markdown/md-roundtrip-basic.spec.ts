import { expect, test } from '@playwright/test';
import path from 'path';

const fixturePath = path.join(__dirname, 'fixtures', 'basic.md');

test.describe('md-roundtrip-basic', () => {
  test('imports markdown and exports round-tripped content', async ({ page }) => {
    await page.goto('/');

    await page.setInputFiles('[data-testid="markdown-import-input"]', fixturePath);

    const heading = page.getByRole('heading', { level: 1, name: 'Project Plan' });
    await expect(heading).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();

    await expect(page.locator('ul[data-type="taskList"] li')).toHaveCount(2);
    await expect(page.locator('ol li')).toHaveCount(2);
    await expect(page.locator('img[alt="Architectural Diagram"]')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('markdown-export-button').click();
    const download = await downloadPromise;
    await download.delete();

    const exported = await page.evaluate(() => (window as unknown as { __lashLastExport?: string }).__lashLastExport);
    expect(exported).toBeTruthy();
    expect(exported).toContain('# Project Plan');
    expect(exported).toContain('- [x] Ship schema');
    expect(exported).toContain('[image-1]: https://example.com/diagram.png');
  });
});
