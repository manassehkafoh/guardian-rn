import type { GuardianConfig } from '../../config/GuardianConfig.js';

export function makeConfig(overrides: Partial<GuardianConfig> = {}): GuardianConfig {
  return {
    tenantId: 'test-tenant',
    engines: [],
    actions: {},
    ...overrides,
  };
}
