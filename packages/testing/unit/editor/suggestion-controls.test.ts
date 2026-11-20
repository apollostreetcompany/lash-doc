/** @vitest-environment jsdom */

import { afterEach, expect, it, vi } from 'vitest';

import { SuggestionComposer } from '../../../../apps/web/components/editor/panels/SuggestionControls';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await React.act(async () => root.unmount());
  document.body.replaceChildren();
});

it('preserves a pending suggestion on failure, clears its error on editing, and allows retry or cancel', async () => {
  let complete: (result: { ok: false; message: string }) => void = () => undefined;
  const pending = new Promise<{ ok: false; message: string }>((resolve) => {
    complete = resolve;
  });
  const onSubmit = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce({ ok: true });
  const onCancel = vi.fn();
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  await React.act(async () => {
    root.render(React.createElement(SuggestionComposer, { quote: 'original', onSubmit, onCancel }));
  });
  const replacement = host.querySelector<HTMLInputElement>('#suggestion-replacement')!;
  const cancel = host.querySelector<HTMLButtonElement>('button[type="button"]')!;
  const submit = () => React.act(async () => replacement.form?.requestSubmit());
  const fill = (value: string) =>
    React.act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        replacement,
        value,
      );
      replacement.dispatchEvent(new Event('input', { bubbles: true }));
    });

  await fill('proposed');
  await submit();
  await submit();
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(cancel.disabled).toBe(true);

  await React.act(async () => complete({ ok: false, message: 'Try again.' }));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Try again.');
  expect(replacement.value).toBe('proposed');
  expect(cancel.disabled).toBe(false);
  await fill('revised');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await submit();
  expect(onSubmit).toHaveBeenLastCalledWith('revised', '');
  await React.act(async () => cancel.click());
  expect(onCancel).toHaveBeenCalledOnce();
});
