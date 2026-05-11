import type { Observable } from '../types/Observable.js';
import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { GuardianConfig } from '../config/GuardianConfig.js';

export interface EngineContext {
  readonly config: GuardianConfig;
  readonly sessionId: string;
  readonly platform: 'android' | 'ios';
  /** True when the app is running inside an Android managed work profile. */
  readonly managedProfile: boolean;
  onFault(error: Error): void;
}

export interface EngineHealthTick {
  readonly engineId: string;
  readonly ts: number;
  readonly sessionId: string;
  readonly status: 'ok' | 'fault';
  readonly activeChecks?: readonly string[];
  readonly detectorResults?: ReadonlyArray<{
    readonly detectorId: string;
    readonly lastRunMs: number;
    readonly lastConfidence: number;
    readonly status: 'ok' | 'fault';
  }>;
  readonly reason?: string;
}

/**
 * Per ADR-0004: the only contract between guardian-rn and any detector.
 * start() must resolve before any event is emitted.
 * stop() is idempotent; events emitted after stop() resolves are dropped.
 * onHealthTick must emit at least once per 60 000 ms while running.
 */
export interface Engine {
  readonly id: string;
  start(context: EngineContext): Promise<void>;
  stop(): Promise<void>;
  readonly onThreat: Observable<ThreatEvent>;
  readonly onHealthTick: Observable<EngineHealthTick>;
  /**
   * Called by useGuardian when the app transitions between foreground/background.
   * Engines SHOULD reduce scan frequency in 'background' mode to conserve battery.
   * Optional — engines that ignore it remain valid.
   */
  throttle?(mode: 'foreground' | 'background'): void;
}
