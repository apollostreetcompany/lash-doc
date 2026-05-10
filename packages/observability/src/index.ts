/**
 * @lash/observability — tracing/metrics/logs aligned with the SLOs in agents.md.
 * Status: SCAFFOLD — implement in M5/F5 alongside deploy docs.
 */

export interface Span {
  name: string;
  startMs: number;
  endMs?: number;
  attrs?: Record<string, string | number | boolean>;
  /** optional parent span id for distributed traces */
  parentId?: string;
}

export interface Tracer {
  start(name: string, attrs?: Span['attrs'], parentId?: string): Span;
  end(span: Span, attrs?: Span['attrs']): void;
}

export interface MetricRecorder {
  /** counter increment */
  inc(name: string, value?: number, tags?: Record<string, string>): void;
  /** observation for histograms (latency etc.) */
  observe(name: string, value: number, tags?: Record<string, string>): void;
}

export interface Logger {
  info(msg: string, attrs?: Record<string, unknown>): void;
  warn(msg: string, attrs?: Record<string, unknown>): void;
  error(msg: string, attrs?: Record<string, unknown>): void;
}

export const createTracer = (_serviceName: string): Tracer => {
  throw new Error('createTracer: not implemented (M5/F5)');
};

export const createMetricRecorder = (_serviceName: string): MetricRecorder => {
  throw new Error('createMetricRecorder: not implemented (M5/F5)');
};

export const createLogger = (_serviceName: string): Logger => {
  throw new Error('createLogger: not implemented (M5/F5)');
};
