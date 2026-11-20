// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  initialWorkspaceChrome,
  transitionWorkspaceChrome,
} from '../../../../apps/web/components/editor/workspaceChrome';

describe('editor workspace chrome', () => {
  it('releases a mobile rail into desktop without reopening it when returning to mobile', () => {
    const phone = transitionWorkspaceChrome(initialWorkspaceChrome, {
      type: 'open-rail',
      viewport: 'mobile',
      tab: 'history',
      trigger: null,
    });
    expect(phone).toMatchObject({ viewport: 'mobile', drawer: 'rail', activeTab: 'history' });

    const desktop = transitionWorkspaceChrome(phone, { type: 'viewport', viewport: 'desktop' });
    expect(desktop).toMatchObject({ drawer: null, desktopRailOpen: true, activeTab: 'history' });

    const backOnPhone = transitionWorkspaceChrome(desktop, {
      type: 'viewport',
      viewport: 'mobile',
    });
    expect(backOnPhone).toMatchObject({ drawer: null, desktopRailOpen: true });
  });

  it('keeps mobile activity and navigation exclusive and releases a drawer on entering focus mode', () => {
    const sidebar = transitionWorkspaceChrome(initialWorkspaceChrome, { type: 'open-sidebar' });
    const conversation = transitionWorkspaceChrome(sidebar, {
      type: 'open-rail',
      viewport: 'mobile',
      tab: 'chat',
      trigger: null,
    });
    expect(conversation).toMatchObject({ drawer: 'rail', focusMode: false });
    expect(transitionWorkspaceChrome(conversation, { type: 'close-sidebar' })).toBe(conversation);
    expect(transitionWorkspaceChrome(conversation, { type: 'focus' })).toMatchObject({
      drawer: null,
      focusMode: true,
    });
  });

  it('lets an anchor jump own focus after the modal releases', () => {
    const opener = document.createElement('button');
    const phone = transitionWorkspaceChrome(initialWorkspaceChrome, {
      type: 'open-rail',
      viewport: 'mobile',
      tab: 'chat',
      trigger: opener,
    });
    const closed = transitionWorkspaceChrome(phone, { type: 'close-rail', restoreFocus: false });
    expect(closed).toMatchObject({ drawer: null, activeTab: 'chat' });
    expect(closed.railFocus.trigger).toBe(opener);
    expect(closed.railFocus.restoreFocus).toBe(false);
  });
});
