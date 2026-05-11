import { fromTalsecConfig, type TalsecConfig } from '../compat/freerasp-rn.js';

function makeTalsecConfig(overrides: Partial<TalsecConfig> = {}): TalsecConfig {
  return {
    androidConfig: {
      packageName: 'com.example.app',
      certificateHashes: ['abcdef1234567890'],
    },
    iosConfig: {
      bundleIds: ['com.example.app'],
      teamId: 'TEAM123',
    },
    isProd: true,
    listeners: {},
    ...overrides,
  };
}

describe('fromTalsecConfig', () => {
  test('returns a valid GuardianConfig', () => {
    const config = fromTalsecConfig(makeTalsecConfig(), []);
    expect(config.tenantId).toBe('migrated');
    expect(config.engines).toHaveLength(0);
    expect(config.actions).toBeDefined();
  });

  test('isProd=false downgrades default threat policies to telemetry', () => {
    const config = fromTalsecConfig(makeTalsecConfig({ isProd: false }), []);
    expect(config.policies?.['root']).toBe('telemetry');
    expect(config.policies?.['hooks']).toBe('telemetry');
  });

  test('isProd=true leaves policies empty (PolicyEngine defaults apply)', () => {
    const config = fromTalsecConfig(makeTalsecConfig({ isProd: true }), []);
    expect(config.policies?.['root']).toBeUndefined();
  });

  test('listeners are wired into actions', () => {
    const privilegedAccess = jest.fn();
    const config = fromTalsecConfig(
      makeTalsecConfig({ listeners: { privilegedAccess } }),
      [],
    );
    // root → privilegedAccess
    config.actions['root']?.({
      threatId: 'root',
      severity: 'high',
      confidence: 0.95,
      evidence: {},
      ts: Date.now(),
      engineId: 'test',
    });
    expect(privilegedAccess).toHaveBeenCalledTimes(1);
  });

  test('custom tenantId is passed through', () => {
    const config = fromTalsecConfig(makeTalsecConfig(), [], 'acme-corp');
    expect(config.tenantId).toBe('acme-corp');
  });
});
