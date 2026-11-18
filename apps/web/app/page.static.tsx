import { Suspense } from 'react';

import { StaticEditorWorkspace } from '../components/editor/StaticEditorWorkspace';

export default function StaticHomePage() {
  return (
    <main data-testid="lash-home" aria-labelledby="lash-page-title">
      <h1 className="sr-only" id="lash-page-title">
        Lash Collaborative Editor
      </h1>
      <section aria-label="Document workspace">
        <Suspense fallback={<p role="status">Preparing your editor…</p>}>
          <StaticEditorWorkspace />
        </Suspense>
      </section>
    </main>
  );
}
