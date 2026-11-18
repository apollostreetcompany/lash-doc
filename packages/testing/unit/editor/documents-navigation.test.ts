import { afterEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '../../../../apps/web/components/shell/Sidebar';
import * as React from '../../../../apps/web/node_modules/react';
import { renderToStaticMarkup } from '../../../../apps/web/node_modules/react-dom/server';

describe('workspace document navigation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exposes a named Documents destination in the collapsed workspace sidebar', () => {
    vi.stubGlobal('React', React);
    const markup = renderToStaticMarkup(
      React.createElement(Sidebar, {
        collapsed: true,
        outlineItems: [],
        onToggleCollapsed: () => {},
        onToggleHeading: () => {},
        onFocusHeading: () => {},
      }),
    );

    expect(markup).toMatch(/<a\b(?=[^>]*href="\/documents")(?=[^>]*aria-label="Documents")/);
  });
});
