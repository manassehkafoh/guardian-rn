import type { ThreatEvent } from '../events/ThreatEvent.js';

export type ThreatHandler = (event: ThreatEvent) => void;

interface Subscriber {
  readonly id: string;
  readonly handler: ThreatHandler;
}

let nextId = 1;

export class SubscriberStore {
  private readonly subscribers = new Map<string, Subscriber>();
  private handlersArray: ThreatHandler[] | null = null;

  subscribe(handler: ThreatHandler): () => void {
    const id = `sub-${nextId++}`;
    this.subscribers.set(id, { id, handler });
    this.handlersArray = null;
    return () => {
      this.subscribers.delete(id);
      this.handlersArray = null;
    };
  }

  dispatch(event: ThreatEvent): void {
    if (this.handlersArray === null) {
      this.handlersArray = Array.from(this.subscribers.values()).map(s => s.handler);
    }
    const handlers = this.handlersArray;
    for (let i = 0; i < handlers.length; i++) {
      try {
        handlers[i]!(event);
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
    this.handlersArray = null;
  }
}
