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
    // Use confidence < kill threshold (0.9) so fast-path does not bypass dedup
    const lowConf = { ...BASE_PAYLOAD, confidence: 0.6 };
    const bus = new EventBus(SESSION_KEY, SESSION_ID, { dedupWindowMs: 100, rateCapPerSecond: 50, fastPathEnabled: true });
    const received: string[] = [];
    bus.onThreat((e) => received.push(e.threatId));

    bus.processEnvelope(makeEnvelope(1, lowConf), 'engine');
    bus.processEnvelope(makeEnvelope(2, lowConf), 'engine'); // same threatId, within window

    expect(received).toHaveLength(1);
  });

  test('rate cap drops events exceeding limit', () => {
    // Use confidence < kill threshold (0.9) so fast-path does not bypass rate-cap
    const bus = new EventBus(SESSION_KEY, SESSION_ID, { dedupWindowMs: 0, rateCapPerSecond: 3, fastPathEnabled: true });
    const received: string[] = [];
    bus.onThreat((e) => received.push(e.threatId));

    // Send 5 events from same engine with different threatIds to bypass dedup
    const threats = ['root', 'jailbreak', 'debugger', 'hooks', 'tamper'] as const;
    threats.forEach((threatId, i) => {
      const p = { ...BASE_PAYLOAD, threatId, confidence: 0.6 };
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

  test('fast-path: confidence >= kill threshold bypasses dedup and rate-cap', () => {
    // rate cap of 1/s and 200ms dedup — but fast-path events go through regardless
    const bus = new EventBus(
      SESSION_KEY,
      SESSION_ID,
      { dedupWindowMs: 200, rateCapPerSecond: 1, fastPathEnabled: true },
      0.9,
    );
    const received: string[] = [];
    bus.onThreat((e) => received.push(e.threatId));

    // Three identical high-confidence events — all should be forwarded
    bus.processEnvelope(makeEnvelope(1, BASE_PAYLOAD), 'engine'); // confidence 0.95
    bus.processEnvelope(makeEnvelope(2, BASE_PAYLOAD), 'engine');
    bus.processEnvelope(makeEnvelope(3, BASE_PAYLOAD), 'engine');

    expect(received).toHaveLength(3);
  });

  test('fast-path disabled: confidence >= kill threshold still goes through normal pipeline', () => {
    const bus = new EventBus(
      SESSION_KEY,
      SESSION_ID,
      { dedupWindowMs: 200, rateCapPerSecond: 50, fastPathEnabled: false },
      0.9,
    );
    const received: string[] = [];
    bus.onThreat((e) => received.push(e.threatId));

    bus.processEnvelope(makeEnvelope(1, BASE_PAYLOAD), 'engine');
    bus.processEnvelope(makeEnvelope(2, BASE_PAYLOAD), 'engine'); // deduplicated

    expect(received).toHaveLength(1);
  });
});
