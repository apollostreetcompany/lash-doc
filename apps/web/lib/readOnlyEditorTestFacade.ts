type ReadableEditor = {
  getAttributes?(name: string): Record<string, unknown>;
  getJSON(): unknown;
  getText(options?: { blockSeparator?: string }): string;
  isActive?(name: string, attributes?: Record<string, unknown>): boolean;
  readonly isDestroyed?: boolean;
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const deniedCommands = new Proxy<Record<string, () => false>>(
  {},
  {
    get: () => () => false,
  },
);

const deniedChain = () => {
  const chain = new Proxy<Record<string, () => unknown>>(
    {},
    {
      get: (_target, property) => (property === 'run' ? () => false : () => chain),
    },
  );
  return chain;
};

/**
 * Test builds historically exposed TipTap's raw Editor on `window`. A remote
 * read grant must not turn that convenience hook into a route to the
 * collaboration Y.Doc or mutating commands, so read-only sessions receive
 * this deliberately narrow snapshot/navigation facade instead.
 */
export const createReadOnlyEditorTestFacade = (editor: ReadableEditor) => ({
  attemptBodyMutation: () => false,
  chain: deniedChain,
  commands: deniedCommands,
  getAttributes: (name: string) => cloneJson(editor.getAttributes?.(name) ?? {}),
  getJSON: () => cloneJson(editor.getJSON()),
  getText: (options?: { blockSeparator?: string }) => editor.getText(options),
  isActive: (name: string, attributes?: Record<string, unknown>) =>
    editor.isActive?.(name, attributes) ?? false,
  get isDestroyed() {
    return Boolean(editor.isDestroyed);
  },
  isEditable: false,
  get state() {
    return {
      doc: {
        textContent: editor.getText(),
        toJSON: () => cloneJson(editor.getJSON()),
      },
    };
  },
});
