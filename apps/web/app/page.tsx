import dynamic from 'next/dynamic';

const EditorWorkspace = dynamic(() => import('../components/editor/EditorWorkspace'), {
  ssr: false,
});

export default function HomePage() {
  return (
    <main data-testid="lash-home" role="main" aria-labelledby="lash-page-title">
      <header style={{ padding: '2rem 2.5rem 1.5rem' }}>
        <h1 style={{ margin: 0 }} id="lash-page-title">
          Lash Collaborative Editor
        </h1>
      </header>

      <section aria-label="Document editor" style={{ padding: '0 2.5rem 2.5rem' }}>
        <EditorWorkspace />
      </section>
    </main>
  );
}
