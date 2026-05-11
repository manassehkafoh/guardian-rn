import type { GuardianConfig } from '../config/GuardianConfig.js';
import type { ThreatId } from '../generated/ThreatId.js';
import type { ResponsePolicy } from '../generated/ResponsePolicy.js';
import { fromFreeRaspListeners, type FreeRaspListeners } from './useThreatActions.js';

/**
 * Mirrors TalsecConfig from freerasp-react-native v6.x.
 * Only the fields guardian-rn can map are included; unknown fields are ignored.
 */
export interface TalsecConfig {
  androidConfig?: {
    packageName: string;
    certificateHashes: string[];
    supportedAlternativeStores?: string[];
    malwareConfig?: { blacklistedPackageNames?: string[] };
  };
  iosConfig?: {
    bundleIds: string[];
    teamId: string;
  };
  isProd: boolean;
  listeners: FreeRaspListeners;
}

/**
 * Converts a freerasp-rn TalsecConfig to a GuardianConfig.
 * Engines must still be provided — guardian-rn has no default engine set here
 * so callers don't pull in the community engine unless they explicitly want it.
 *
 * Usage:
 * ```ts
 * import { CommunityEngine } from '@guardian-rn/engine-community';
 * const config = fromTalsecConfig(talsecConfig, [new CommunityEngine()]);
 * ```
 */
export function fromTalsecConfig(
  talsecConfig: TalsecConfig,
  engines: GuardianConfig['engines'],
  tenantId = 'migrated',
): GuardianConfig {
  const actions = fromFreeRaspListeners(talsecConfig.listeners);

  const policies: Partial<Record<ThreatId, ResponsePolicy>> = talsecConfig.isProd
    ? {}
    : { root: 'telemetry', jailbreak: 'telemetry', debugger: 'telemetry', hooks: 'telemetry' };

  return {
    tenantId,
    engines,
    actions,
    policies,
  };
}
