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
  /** Events with confidence >= kill threshold bypass dedup/rate-cap. Default: true. */
  readonly fastPathEnabled: boolean;
}

/**
 * OODA adaptive threshold config — tightens confidence gates when threats
 * are observed at elevated frequency. Per ADR-0011.
 */
export interface AdaptiveThresholdConfig {
  /** Rolling window over which threat frequency is sampled (ms). Default: 60_000. */
  readonly windowMs?: number;
  /** Threat count within windowMs that triggers escalation. Default: 3. */
  readonly escalationCount?: number;
  /** Multiplier applied to confidence thresholds during escalation (0 < v ≤ 1). Default: 0.9. */
  readonly escalationFactor?: number;
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
  /** OODA adaptive threshold tuning. Omit to disable adaptive mode. */
  readonly adaptiveThresholds?: AdaptiveThresholdConfig;
  /** Max session age in milliseconds. Emits sessionExpiry at age. Omit for no expiry. */
  readonly sessionMaxAgeMs?: number;
  /** Remote policy endpoint URL (https). Fetched at startup; PolicyStore falls back to cache. */
  readonly policyEndpoint?: string;
  /** When true, threatId values in outbound telemetry are replaced with opaque tokens. */
  readonly obfuscateThreatIds?: boolean;

  readonly actions: GuardianActions;
}

export interface GuardianActions {
  onRestrict?: (event: import('../events/ThreatEvent.js').ThreatEvent) => void;
  onLockout?: (event: import('../events/ThreatEvent.js').ThreatEvent) => void;
  onKill?: (event: import('../events/ThreatEvent.js').ThreatEvent) => void;
  [threatId: string]: ((event: import('../events/ThreatEvent.js').ThreatEvent) => void) | undefined;
}
