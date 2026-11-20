'use client';

import dynamic from 'next/dynamic';

import { EditorWorkspace } from './EditorWorkspace';

export const EditorWorkspaceLoader =
  process.env.NEXT_PUBLIC_LASH_TEST_HOOKS === 'true'
    ? dynamic(() => import('../testing/EditorPerformanceProfiler'), { ssr: false })
    : EditorWorkspace;
