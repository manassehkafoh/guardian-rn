import type { ThreatId } from '../generated/ThreatId.js';
import type { ResponsePolicy } from '../generated/ResponsePolicy.js';
import type { Engine } from '../engine/Engine.js';
import type { TelemetryAdapter } from '../telemetry/TelemetryAdapter.js';
import type { TerminatorPort } from '../policy/TerminatorPort.js';

export interface KillPolicyConfig {
  readonly enabled: boolean;
  readonly graceMs: number;
  readonly warningCallback?: (threatId: ThreatId) => void;
}

export interface ConfidenceThresholds {
  readonly restrict: number;
  readonly lockout: number;
  readonly kill: number;
}

export interface BusConfig {
  readonly dedupWindowMs: number;
  readonly rateCapPerSecond: number;
}

/**
 * Full configuration for a guardian-rn session. Per ADR-0005.
 */
export interface GuardianConfig {
  readonly tenantId: string;
  readonly engines: readonly Engine[];
  readonly policies?: Partial<Record<ThreatId, ResponsePolicy>>;
  readonly confidenceThresholds?: Partial<ConfidenceThresholds>;
  readonly killPolicy?: KillPolicyConfig;
  readonly busConfig?: Partial<BusConfig>;
  readonly telemetry?: TelemetryAdapter;
  readonly terminator?: TerminatorPort;

  readonly actions: GuardianActions;
}

export interface GuardianActions {
  onRestrict?: (event: import('../events/ThreatEvent.js').ThreatEvent) => void;
  onLockout?: (event: import('../events/ThreatEvent.js').ThreatEvent) => void;
  onKill?: (event: import('../events/ThreatEvent.js').ThreatEvent) => void;
  [threatId: string]: ((event: import('../events/ThreatEvent.js').ThreatEvent) => void) | undefined;
}
