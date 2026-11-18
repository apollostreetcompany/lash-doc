'use client';

import {
  Profiler,
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type ProfilerOnRenderCallback,
} from 'react';

import LashEditorWorkspace from '../editor/EditorWorkspace';

export interface EditorPerformanceCommit {
  index: number;
  id: string;
  phase: string;
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
  runId: string;
  generation: number;
}

export interface EditorPerformanceRun {
  runId: string;
  generation: number;
  armedAt: number;
  stoppedAt: number;
  commits: EditorPerformanceCommit[];
}

export interface EditorPerformanceProfilerHook {
  readonly version: 1;
  readonly profilerId: 'lash-editor-workspace';
  readonly routePath: string;
  begin: (runId: string) => {
    runId: string;
    generation: number;
    armedAt: number;
  };
  stop: (runId: string) => EditorPerformanceRun;
  snapshot: () => {
    activeRunId: string | null;
    generation: number;
    commits: EditorPerformanceCommit[];
  };
}

declare global {
  interface Window {
    __lashReactProfiler?: EditorPerformanceProfilerHook;
  }
}

interface RecorderState {
  activeRunId: string | null;
  generation: number;
  armedAt: number;
  commits: EditorPerformanceCommit[];
}

const TEST_PROFILING_ENABLED = process.env.NEXT_PUBLIC_LASH_TEST_HOOKS === 'true';
const PROFILER_ID = 'lash-editor-workspace' as const;

export default function EditorPerformanceProfiler(
  props: ComponentProps<typeof LashEditorWorkspace>,
) {
  const recorderRef = useRef<RecorderState>({
    activeRunId: null,
    generation: 0,
    armedAt: 0,
    commits: [],
  });

  const handleRender = useCallback<ProfilerOnRenderCallback>(
    (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
      const recorder = recorderRef.current;
      if (!TEST_PROFILING_ENABLED || recorder.activeRunId === null) return;
      recorder.commits.push({
        index: recorder.commits.length,
        id,
        phase,
        actualDuration,
        baseDuration,
        startTime,
        commitTime,
        runId: recorder.activeRunId,
        generation: recorder.generation,
      });
    },
    [],
  );

  useEffect(() => {
    if (!TEST_PROFILING_ENABLED) return;
    const recorder = recorderRef.current;

    const hook: EditorPerformanceProfilerHook = {
      version: 1,
      profilerId: PROFILER_ID,
      routePath: window.location.pathname,
      begin: (runId) => {
        const normalizedRunId = runId.trim();
        if (!normalizedRunId) {
          throw new Error('React profiler runId must be non-empty.');
        }
        if (recorder.activeRunId !== null) {
          throw new Error(`React profiler run ${recorder.activeRunId} is already active.`);
        }
        recorder.generation += 1;
        recorder.activeRunId = normalizedRunId;
        recorder.armedAt = performance.now();
        recorder.commits = [];
        return {
          runId: normalizedRunId,
          generation: recorder.generation,
          armedAt: recorder.armedAt,
        };
      },
      stop: (runId) => {
        if (recorder.activeRunId !== runId) {
          throw new Error(
            `Cannot stop React profiler run ${runId}; active run is ${
              recorder.activeRunId ?? 'none'
            }.`,
          );
        }
        const stoppedAt = performance.now();
        const result: EditorPerformanceRun = {
          runId,
          generation: recorder.generation,
          armedAt: recorder.armedAt,
          stoppedAt,
          commits: recorder.commits.map((commit) => ({ ...commit })),
        };
        recorder.activeRunId = null;
        recorder.commits = [];
        return result;
      },
      snapshot: () => {
        return {
          activeRunId: recorder.activeRunId,
          generation: recorder.generation,
          commits: recorder.commits.map((commit) => ({ ...commit })),
        };
      },
    };

    window.__lashReactProfiler = hook;
    return () => {
      recorder.activeRunId = null;
      recorder.commits = [];
      if (window.__lashReactProfiler === hook) {
        delete window.__lashReactProfiler;
      }
    };
  }, []);

  if (!TEST_PROFILING_ENABLED) {
    return <LashEditorWorkspace {...props} />;
  }

  return (
    <Profiler id={PROFILER_ID} onRender={handleRender}>
      <LashEditorWorkspace {...props} />
    </Profiler>
  );
}
