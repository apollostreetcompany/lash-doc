'use client';

import dynamic from 'next/dynamic';

export const EditorWorkspaceLoader =
  process.env.NEXT_PUBLIC_LASH_TEST_HOOKS === 'true'
    ? dynamic(() => import('../testing/EditorPerformanceProfiler'), { ssr: false })
    : dynamic(() => import('./EditorWorkspace'), { ssr: false });
