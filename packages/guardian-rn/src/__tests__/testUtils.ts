import type { ThreatEvent } from '../events/ThreatEvent.js';

export function makeEvent(overrides: Partial<ThreatEvent> = {}): ThreatEvent {
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
