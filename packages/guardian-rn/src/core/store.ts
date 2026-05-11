import type { ThreatEvent } from '../events/ThreatEvent.js';

export type ThreatHandler = (event: ThreatEvent) => void;

interface Subscriber {
  readonly id: string;
  readonly handler: ThreatHandler;
}

let nextId = 1;

export class SubscriberStore {
  private readonly subscribers = new Map<string, Subscriber>();

  subscribe(handler: ThreatHandler): () => void {
    const id = `sub-${nextId++}`;
    this.subscribers.set(id, { id, handler });
    return () => this.subscribers.delete(id);
  }

  dispatch(event: ThreatEvent): void {
    for (const sub of this.subscribers.values()) {
      try {
        sub.handler(event);
      } catch {
        // Isolate handler failures — one bad subscriber must not block others
      }
    }
  }

  get size(): number {
    return this.subscribers.size;
  }

  clear(): void {
    this.subscribers.clear();
  }
}
