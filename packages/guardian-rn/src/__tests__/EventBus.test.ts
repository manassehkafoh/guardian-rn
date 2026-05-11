import { EventBus } from '../bus/EventBus.js';
import { canonicalJson } from '../core/CanonicalJson.js';
import { computeHmac } from '../core/HmacEnvelope.js';
import type { GuardianEnvelope } from '../core/HmacEnvelope.js';
import type { ThreatPayload } from '../core/ThreatPayload.js';

const SESSION_KEY = new Uint8Array(32).fill(0xcd);
const SESSION_ID = 'bus-test-session';

function makeEnvelope(seq: number, payload: ThreatPayload, key = SESSION_KEY): GuardianEnvelope {
  const canonical = canonicalJson(payload);
  const hmac = computeHmac(canonical, key);
  return { seq, sessionId: SESSION_ID, ts: Date.now(), hmac, payload };
}

const BASE_PAYLOAD: ThreatPayload = {
  threatId: 'hooks',
  severity: 'high',
  confidence: 0.95,
  evidence: { source: 'test' },
  ts: Date.now(),
};

describe('EventBus', () => {
  test('valid envelope fires threat handler', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID);
    const received: string[] = [];
    bus.onThreat((e) => received.push(e.threatId));

    bus.processEnvelope(makeEnvelope(1, BASE_PAYLOAD), 'community@1.0.0');
    expect(received).toEqual(['hooks']);
  });

  test('HMAC mismatch fires fault handler, not threat handler', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID);
    const threats: string[] = [];
    const faults: string[] = [];
    bus.onThreat((e) => threats.push(e.threatId));
    bus.onFault((id) => faults.push(id));

    const wrongKey = new Uint8Array(32).fill(0x00);
    const env = makeEnvelope(1, BASE_PAYLOAD, wrongKey);
    bus.processEnvelope(env, 'community@1.0.0');

    expect(threats).toHaveLength(0);
    expect(faults).toHaveLength(1);
  });

  test('replayed envelope is dropped', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID);
    const received: string[] = [];
    bus.onThreat((e) => received.push(e.threatId));

    bus.processEnvelope(makeEnvelope(1, BASE_PAYLOAD), 'engine');
    bus.processEnvelope(makeEnvelope(1, BASE_PAYLOAD), 'engine'); // replay

    // Dedup window (100ms) + replay both reduce to 1
    expect(received.length).toBeLessThanOrEqual(1);
  });

  test('dedup window suppresses same threatId within 100ms', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID, { dedupWindowMs: 100, rateCapPerSecond: 50 });
    const received: string[] = [];
    bus.onThreat((e) => received.push(e.threatId));

    bus.processEnvelope(makeEnvelope(1, BASE_PAYLOAD), 'engine');
    bus.processEnvelope(makeEnvelope(2, BASE_PAYLOAD), 'engine'); // same threatId, within window

    expect(received).toHaveLength(1);
  });

  test('rate cap drops events exceeding limit', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID, { dedupWindowMs: 0, rateCapPerSecond: 3 });
    const received: string[] = [];
    bus.onThreat((e) => received.push(e.threatId));

    // Send 5 events from same engine with different threatIds to bypass dedup
    const threats = ['root', 'jailbreak', 'debugger', 'hooks', 'tamper'] as const;
    threats.forEach((threatId, i) => {
      const p = { ...BASE_PAYLOAD, threatId };
      bus.processEnvelope(makeEnvelope(i + 1, p), 'engine');
    });

    expect(received.length).toBeLessThanOrEqual(3);
    expect(bus.dropped).toBeGreaterThan(0);
  });

  test('multiple handlers all receive the event', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID);
    const a: string[] = [], b: string[] = [];
    bus.onThreat((e) => a.push(e.threatId));
    bus.onThreat((e) => b.push(e.threatId));

    bus.processEnvelope(makeEnvelope(1, BASE_PAYLOAD), 'engine');
    expect(a).toEqual(['hooks']);
    expect(b).toEqual(['hooks']);
  });

  test('unsubscribe stops delivery', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID);
    const received: string[] = [];
    const unsub = bus.onThreat((e) => received.push(e.threatId));

    bus.processEnvelope(makeEnvelope(1, BASE_PAYLOAD), 'engine');
    unsub();
    // Send a different threatId to bypass dedup
    bus.processEnvelope(makeEnvelope(2, { ...BASE_PAYLOAD, threatId: 'root' }), 'engine');

    expect(received).toEqual(['hooks']); // only the first event
  });
});
