import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'apps/web/app/globals.css'), 'utf8');
const topBar = readFileSync(resolve(process.cwd(), 'apps/web/components/shell/TopBar.tsx'), 'utf8');

describe('stranger-visible responsive shell contract', () => {
  it('keeps the mobile navigation trigger and drawer backdrop out of desktop layout and focus order', () => {
    expect(css).toMatch(/\.lash-topbar-mobile-menu\s*{[^}]*display:\s*none;/s);
    expect(css).toMatch(/\.lash-app-backdrop\s*{[^}]*display:\s*none;/s);
  });

  it('exposes a 44px mobile navigation trigger and the functional drawer backdrop only below 768px', () => {
    expect(css).toMatch(
      /@media \(max-width:\s*767px\)\s*{[\s\S]*?\.lash-topbar-mobile-menu\s*{[^}]*display:\s*inline-flex;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*767px\)\s*{[\s\S]*?\.lash-app-backdrop\s*{[^}]*display:\s*block;/,
    );
  });

  it('does not let first-mount choreography replace the closed mobile sidebar or rail transforms', () => {
    expect(css).toMatch(
      /@media \(max-width:\s*767px\)\s*{[\s\S]*?\.lash-app\[data-entrance='true'\] \.lash-sidebar,\s*\.lash-app\[data-entrance='true'\] \.lash-rail\s*{[^}]*animation:\s*none;/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*767px\)\s*{[\s\S]*?\.lash-sidebar\s*{[^}]*transform:\s*translateX\(-100%\);/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*767px\)\s*{[\s\S]*?\.lash-rail\s*{[^}]*transform:\s*translateX\(100%\);/,
    );
  });

  it('keeps closed mobile drawers out of pointer and visibility semantics until opened', () => {
    expect(css).toMatch(
      /@media \(max-width:\s*767px\)\s*{[\s\S]*?\.lash-sidebar\s*{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/,
    );
    expect(css).toMatch(
      /\.lash-app\[data-mobile-drawer='true'\] \.lash-sidebar\s*{[^}]*visibility:\s*visible;[^}]*pointer-events:\s*auto;/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*767px\)\s*{[\s\S]*?\.lash-rail\s*{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/,
    );
    expect(css).toMatch(
      /\.lash-app\[data-rail-mobile='true'\] \.lash-rail\s*{[^}]*visibility:\s*visible;[^}]*pointer-events:\s*auto;/,
    );
  });

  it('does not reserve the collapsed desktop sidebar column in a closed mobile workspace', () => {
    expect(css).toMatch(
      /@media \(max-width:\s*767px\)\s*{[\s\S]*?\.lash-app,\s*\.lash-app\[data-rail-open='false'\]\s*{[^}]*grid-template-columns:\s*0 minmax\(0,\s*1fr\);[^}]*grid-template-areas:\s*'topbar topbar'\s*'canvas canvas';/,
    );
  });

  it('declares the mobile navigation disclosure relationship in source', () => {
    expect(topBar).toMatch(/aria-controls="lash-sidebar"/);
    expect(topBar).toMatch(/aria-expanded=/);
  });

  it('keeps inactive activity panels out of layout while the tab row remains horizontally reachable', () => {
    expect(css).toMatch(/\.lash-rail-section\[hidden\]\s*{[^}]*display:\s*none;/s);
    expect(css).toMatch(/\.lash-rail-tablist\s*{[^}]*overflow-x:\s*auto;/s);
  });

  it('replaces narrow-only direct actions with one 44px document Tools disclosure', () => {
    expect(css).toMatch(/\.lash-mobile-tools-button\s*{[^}]*display:\s*none;/s);
    expect(css).toMatch(
      /@media \(max-width:\s*431px\)\s*{[\s\S]*?\.lash-topbar-focus-action,\s*\.lash-topbar-suggest-action,\s*\.lash-document-settings-button\s*{[^}]*display:\s*none;/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*431px\)\s*{[\s\S]*?\.lash-mobile-tools-button\s*{[^}]*display:\s*inline-flex;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/,
    );
    expect(topBar).toContain('More document tools');
  });
});
