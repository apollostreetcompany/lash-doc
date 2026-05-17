import dynamic from 'next/dynamic';

const EditorWorkspace = dynamic(() => import('../components/editor/EditorWorkspace'), {
  ssr: false,
});

export default function HomePage() {
  return (
    <main data-testid="lash-home" role="main" aria-labelledby="lash-page-title">
      <h1 className="sr-only" id="lash-page-title">
        Lash Collaborative Editor
      </h1>
      <section aria-label="Document editor">
        <EditorWorkspace />
      </section>
    </main>
  );
}
