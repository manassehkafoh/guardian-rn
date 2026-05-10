import type { Observable } from '../types/Observable.js';
import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { GuardianConfig } from '../config/GuardianConfig.js';

export interface EngineContext {
  readonly config: GuardianConfig;
  readonly sessionId: string;
  readonly platform: 'android' | 'ios';
  onFault(error: Error): void;
}

export interface EngineHealthTick {
  readonly engineId: string;
  readonly ts: number;
  readonly activeChecks?: readonly string[];
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
}
