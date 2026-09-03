import type { GuardianConfig } from '../../config/GuardianConfig.js';

export const NOOP_SIGN = (_data: string) => `sha256=${'0'.repeat(64)}`;

export function makeConfig(overrides: Partial<GuardianConfig> = {}): GuardianConfig {
  return {
    tenantId: 'test-tenant',
    engines: [],
    actions: {},
    ...overrides,
  };
}
