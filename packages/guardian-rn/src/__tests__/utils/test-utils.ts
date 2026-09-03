import type { GuardianConfig } from '../../config/GuardianConfig.js';
import type { ThreatEvent } from '../../events/ThreatEvent.js';

export const NOOP_SIGN = (_data: string) => `sha256=${'0'.repeat(64)}`;

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

export function makeConfig(overrides: Partial<GuardianConfig> = {}): GuardianConfig {
  return {
    tenantId: 'test-tenant',
    engines: [],
    actions: {},
    ...overrides,
  };
}
