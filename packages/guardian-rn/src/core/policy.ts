import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { ResponsePolicy } from '../generated/ResponsePolicy.js';
import type { ThreatId } from '../generated/ThreatId.js';
import type { GuardianConfig } from '../config/GuardianConfig.js';

export const DEFAULT_POLICIES: Partial<Record<ThreatId, ResponsePolicy>> = {
  root: 'lockout',
  jailbreak: 'lockout',
  debugger: 'restrict',
  hooks: 'kill',
  tamper: 'kill',
  emulator: 'telemetry',
  malware: 'lockout',
  screenCapture: 'restrict',
  timeSpoofing: 'restrict',
  privilegedAccess: 'lockout',
  simulator: 'telemetry',
  unofficialStore: 'restrict',
  overlay: 'restrict',
  taskHijacking: 'lockout',
  repackaging: 'kill',
  systemVPN: 'telemetry',
  devMode: 'telemetry',
  adbEnabled: 'telemetry',
  passcodeMissing: 'restrict',
  biometricMissing: 'telemetry',
  hardwareBackedKeysMissing: 'restrict',
  engineFault: 'telemetry',
};

export const DEFAULT_CONFIDENCE_THRESHOLDS = {
  restrict: 0.5,
  lockout: 0.7,
  kill: 0.9,
} as const;

export class PolicyEngine {
  private readonly config: GuardianConfig;
  private killTimers = new Map<ThreatId, ReturnType<typeof setTimeout>>();

  constructor(config: GuardianConfig) {
    this.config = config;
  }

  apply(event: ThreatEvent): void {
    const policy = this.resolvePolicy(event.threatId);
    const thresholds = {
      ...DEFAULT_CONFIDENCE_THRESHOLDS,
      ...this.config.confidenceThresholds,
    };

    this.config.telemetry?.recordThreat(event);

    if (policy === 'telemetry') return;

    if (policy === 'restrict' && event.confidence >= thresholds.restrict) {
      this.config.actions.onRestrict?.(event);
      return;
    }

    if (policy === 'lockout' && event.confidence >= thresholds.lockout) {
      this.config.actions.onLockout?.(event);
      return;
    }

    if (policy === 'kill' && event.confidence >= thresholds.kill) {
      this.applyKill(event);
    }
  }

  private resolvePolicy(threatId: ThreatId): ResponsePolicy {
    return this.config.policies?.[threatId] ?? DEFAULT_POLICIES[threatId] ?? 'telemetry';
  }

  private applyKill(event: ThreatEvent): void {
    const killPolicy = this.config.killPolicy;
    this.config.actions.onKill?.(event);

    if (!killPolicy?.enabled) return;

    // Warn callback runs immediately; termination is deferred by graceMs
    killPolicy.warningCallback?.(event.threatId);

    if (this.killTimers.has(event.threatId)) return; // already scheduled
    const timer = setTimeout(() => {
      this.killTimers.delete(event.threatId);
      this.config.terminator?.terminate({ threatId: event.threatId, ts: Date.now() });
    }, killPolicy.graceMs);
    this.killTimers.set(event.threatId, timer);
  }

  cancelPendingKills(): void {
    for (const timer of this.killTimers.values()) clearTimeout(timer);
    this.killTimers.clear();
  }
}
