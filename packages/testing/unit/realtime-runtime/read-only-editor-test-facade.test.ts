import { describe, expect, it, vi } from 'vitest';

import { createReadOnlyEditorTestFacade } from '../../../../apps/web/lib/readOnlyEditorTestFacade';

describe('read-only editor test facade', () => {
  it('exposes document reads while refusing commands and hiding Yjs reachability', () => {
    const setContent = vi.fn();
    const editor = {
      commands: { setContent },
      getJSON: () => ({ type: 'doc', content: [{ type: 'paragraph' }] }),
      getText: () => 'readable body',
      storage: { collaboration: { document: { transact: vi.fn() } } },
      view: { dispatch: vi.fn() },
    };

    const facade = createReadOnlyEditorTestFacade(editor);

    expect(facade.getText()).toBe('readable body');
    expect(facade.getJSON()).toEqual(editor.getJSON());
    expect(facade.commands.setContent({ type: 'doc' })).toBe(false);
    expect(facade.chain().insertContent('forbidden').run()).toBe(false);
    expect(facade.attemptBodyMutation()).toBe(false);
    expect(setContent).not.toHaveBeenCalled();
    expect(facade).not.toHaveProperty('storage');
    expect(facade).not.toHaveProperty('view');
  });
});
