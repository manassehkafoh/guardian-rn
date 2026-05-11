import { SubscriberStore } from '../core/store.js';
import type { ThreatEvent } from '../events/ThreatEvent.js';

function makeEvent(overrides: Partial<ThreatEvent> = {}): ThreatEvent {
  return {
    threatId: 'root',
    severity: 'high',
    confidence: 0.95,
    evidence: {},
    ts: Date.now(),
    engineId: 'test',
    ...overrides,
  };
}

describe('SubscriberStore', () => {
  test('dispatches event to all subscribers', () => {
    const store = new SubscriberStore();
    const a: string[] = [], b: string[] = [];
    store.subscribe((e) => a.push(e.threatId));
    store.subscribe((e) => b.push(e.threatId));
    store.dispatch(makeEvent({ threatId: 'root' }));
    expect(a).toEqual(['root']);
    expect(b).toEqual(['root']);
  });

  test('unsubscribe stops delivery', () => {
    const store = new SubscriberStore();
    const received: string[] = [];
    const unsub = store.subscribe((e) => received.push(e.threatId));
    store.dispatch(makeEvent({ threatId: 'root' }));
    unsub();
    store.dispatch(makeEvent({ threatId: 'debugger' }));
    expect(received).toEqual(['root']);
  });

  test('size reflects current subscriber count', () => {
    const store = new SubscriberStore();
    expect(store.size).toBe(0);
    const unsub = store.subscribe(() => { /* empty */ });
    expect(store.size).toBe(1);
    unsub();
    expect(store.size).toBe(0);
  });

  test('faulty handler does not block other handlers', () => {
    const store = new SubscriberStore();
    const received: string[] = [];
    store.subscribe(() => { throw new Error('handler crash'); });
    store.subscribe((e) => received.push(e.threatId));
    expect(() => store.dispatch(makeEvent({ threatId: 'root' }))).not.toThrow();
    expect(received).toEqual(['root']);
  });

  test('clear() removes all subscribers', () => {
    const store = new SubscriberStore();
    store.subscribe(() => { /* empty */ });
    store.subscribe(() => { /* empty */ });
    store.clear();
    expect(store.size).toBe(0);
  });
});
