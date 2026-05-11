import { BehavioralBaselineEngine } from '../BehavioralBaselineEngine.js';
import type { ThreatEvent } from '@guardian/rn/src/events/ThreatEvent.js';
import type { EngineContext } from '@guardian/rn/src/engine/Engine.js';

function makeContext(): EngineContext {
  return {
    config: {} as never,
    sessionId: 'test-session',
    platform: 'android',
    managedProfile: false,
    onFault: jest.fn(),
  };
}

function makeEvent(threatId: ThreatEvent['threatId'], ts = Date.now()): ThreatEvent {
  return {
    threatId,
    severity: 'high',
    confidence: 0.8,
    evidence: {},
    ts,
    engineId: 'community@1.0.0',
  };
}

describe('BehavioralBaselineEngine', () => {
  afterEach(() => jest.useRealTimers());

  test('emits behavioralAnomaly when event count reaches threshold', async () => {
    const engine = new BehavioralBaselineEngine({ anomalyThreshold: 3, windowMs: 10_000 });
    const upstream = {
      onThreat: {
        subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
      },
    } as never;

    // Manually exercise the record path by tapping into the private subscription
    const anomalies: ThreatEvent[] = [];
    engine.onThreat.subscribe({ next: (e) => anomalies.push(e) });

    await engine.start(makeContext());
    // Simulate upstream events by calling observeEngine with a real Observable
    // and then emitting directly through it
    const { SimpleObservable, emitters } = buildObservable();
    engine.observeEngine({ onThreat: SimpleObservable });

    emitters.emit(makeEvent('root'));
    emitters.emit(makeEvent('jailbreak'));
    expect(anomalies).toHaveLength(0); // below threshold

    emitters.emit(makeEvent('debugger')); // hits threshold of 3
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.threatId).toBe('behavioralAnomaly');
    expect(anomalies[0]!.confidence).toBeCloseTo(1.0);

    await engine.stop();
  });

  test('window event count resets after windowMs', async () => {
    jest.useFakeTimers();
    const engine = new BehavioralBaselineEngine({ anomalyThreshold: 3, windowMs: 5_000 });
    await engine.start(makeContext());

    const { SimpleObservable, emitters } = buildObservable();
    engine.observeEngine({ onThreat: SimpleObservable });

    const base = Date.now();
    emitters.emit(makeEvent('root', base));
    emitters.emit(makeEvent('jailbreak', base + 100));
    expect(engine.windowEventCount).toBe(2);

    jest.advanceTimersByTime(6_000);
    expect(engine.windowEventCount).toBe(0);

    await engine.stop();
  });

  test('confidence scales with event count above threshold', async () => {
    const engine = new BehavioralBaselineEngine({ anomalyThreshold: 2, windowMs: 60_000 });
    const anomalies: ThreatEvent[] = [];
    engine.onThreat.subscribe({ next: (e) => anomalies.push(e) });
    await engine.start(makeContext());

    const { SimpleObservable, emitters } = buildObservable();
    engine.observeEngine({ onThreat: SimpleObservable });

    emitters.emit(makeEvent('root'));
    emitters.emit(makeEvent('jailbreak')); // threshold = 2
    emitters.emit(makeEvent('debugger'));  // count = 3, confidence = min(1.0, 3/2) = 1.0

    expect(anomalies[anomalies.length - 1]!.confidence).toBe(1.0);
    await engine.stop();
  });

  test('stop() unsubscribes from upstream and drops subsequent events', async () => {
    const engine = new BehavioralBaselineEngine({ anomalyThreshold: 2, windowMs: 60_000 });
    const anomalies: ThreatEvent[] = [];
    engine.onThreat.subscribe({ next: (e) => anomalies.push(e) });
    await engine.start(makeContext());

    const { SimpleObservable, emitters } = buildObservable();
    engine.observeEngine({ onThreat: SimpleObservable });

    await engine.stop();
    emitters.emit(makeEvent('root'));
    emitters.emit(makeEvent('jailbreak'));
    expect(anomalies).toHaveLength(0);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

interface Emitters {
  emit(event: ThreatEvent): void;
}

function buildObservable(): {
  SimpleObservable: { subscribe(obs: { next(e: ThreatEvent): void }): { unsubscribe(): void } };
  emitters: Emitters;
} {
  const observers = new Set<{ next(e: ThreatEvent): void }>();
  const SimpleObservable = {
    subscribe(obs: { next(e: ThreatEvent): void }) {
      observers.add(obs);
      return { unsubscribe: () => observers.delete(obs) };
    },
  };
  const emitters: Emitters = {
    emit(event: ThreatEvent) {
      for (const obs of observers) obs.next(event);
    },
  };
  return { SimpleObservable, emitters };
}
