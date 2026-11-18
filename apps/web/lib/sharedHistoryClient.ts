import type { SharedHistoryCommand, SharedHistoryFrame, SharedHistoryOutcome } from '@lash/types';

type WithoutRequestId<T> = T extends { requestId: string } ? Omit<T, 'requestId'> : never;
type SharedHistoryAction = WithoutRequestId<SharedHistoryCommand>;
type PendingRequest = {
  settle: (result: SharedHistoryOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
};

const unavailable = { kind: 'error', code: 'unavailable' } as const;

export class SharedHistoryClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  constructor(private readonly send: (command: SharedHistoryCommand) => boolean) {}

  getRevision = () => this.revision;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  refresh() {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  disconnect() {
    for (const requestId of this.pending.keys()) this.settle(requestId, unavailable);
    this.refresh();
  }

  request(action: SharedHistoryAction): Promise<SharedHistoryOutcome> {
    if (this.pending.size >= 4) return Promise.resolve(unavailable);
    const requestId = crypto.randomUUID();
    return new Promise((settle) => {
      const timer = setTimeout(() => this.settle(requestId, unavailable), 8_000);
      this.pending.set(requestId, { settle, timer });
      if (!this.send({ ...action, requestId })) this.settle(requestId, unavailable);
    });
  }

  receive(frame: SharedHistoryFrame) {
    if (frame.outcome && typeof frame.outcome === 'object') {
      this.settle(frame.requestId, frame.outcome);
    }
  }

  private settle(requestId: string, result: SharedHistoryOutcome) {
    const request = this.pending.get(requestId);
    if (!request) return;
    this.pending.delete(requestId);
    clearTimeout(request.timer);
    request.settle(result);
  }
}
