import type { OutlineItem } from '@lash/editor-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { OutlinePanel } from '../../../../apps/web/components/editor/panels/OutlinePanel';
import * as React from '../../../../apps/web/node_modules/react';
import { renderToStaticMarkup } from '../../../../apps/web/node_modules/react-dom/server';

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const renderOutline = (items: OutlineItem[]) =>
  renderToStaticMarkup(
    OutlinePanel({
      items,
      onToggle: () => undefined,
      onFocus: () => undefined,
      onExpandAll: () => undefined,
    }),
  );

const item = (collapsed: boolean): OutlineItem => ({
  headingId: 'heading-1',
  level: 1,
  title: 'Launch plan',
  collapsed,
  descendantCount: 1,
  hiddenBlockCount: collapsed ? 1 : 0,
  from: 1,
  to: 12,
  contentFrom: 2,
  contentTo: 11,
});

describe('OutlinePanel bulk action disclosure', () => {
  it('omits Expand all when the outline is empty', () => {
    expect(renderOutline([])).not.toContain('outline-expand-all-button');
  });

  it('omits Expand all when every heading is already expanded', () => {
    expect(renderOutline([item(false)])).not.toContain('outline-expand-all-button');
  });

  it('renders one enabled Expand all action when a heading is collapsed', () => {
    const markup = renderOutline([item(true)]);

    expect(markup).toContain('aria-label="Expand all headings"');
    expect(markup).not.toContain('disabled=""');
  });
});
