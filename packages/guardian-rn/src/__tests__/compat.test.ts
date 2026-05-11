import { fromFreeRaspListeners } from '../compat/useThreatActions.js';
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

describe('fromFreeRaspListeners', () => {
  test('root maps to privilegedAccess listener', () => {
    const privilegedAccess = jest.fn();
    const actions = fromFreeRaspListeners({ privilegedAccess });
    actions['root']?.(makeEvent({ threatId: 'root' }));
    expect(privilegedAccess).toHaveBeenCalledTimes(1);
  });

  test('jailbreak also maps to privilegedAccess', () => {
    const privilegedAccess = jest.fn();
    const actions = fromFreeRaspListeners({ privilegedAccess });
    actions['jailbreak']?.(makeEvent({ threatId: 'jailbreak' }));
    expect(privilegedAccess).toHaveBeenCalledTimes(1);
  });

  test('debugger maps to debug listener', () => {
    const debug = jest.fn();
    const actions = fromFreeRaspListeners({ debug });
    actions['debugger']?.(makeEvent({ threatId: 'debugger' }));
    expect(debug).toHaveBeenCalledTimes(1);
  });

  test('malware listener receives package info', () => {
    const malware = jest.fn();
    const actions = fromFreeRaspListeners({ malware });
    actions['malware']?.(makeEvent({
      threatId: 'malware',
      severity: 'critical',
      evidence: { packageName: 'com.evil.app' },
    }));
    expect(malware).toHaveBeenCalledWith({ packageName: 'com.evil.app', severity: 'critical' });
  });

  test('unmapped listener is not included in actions', () => {
    const actions = fromFreeRaspListeners({});
    expect(Object.keys(actions)).toHaveLength(0);
  });

  test('missing listener produces no action for that threatId', () => {
    const actions = fromFreeRaspListeners({ debug: jest.fn() });
    expect(actions['root']).toBeUndefined();
  });
});
