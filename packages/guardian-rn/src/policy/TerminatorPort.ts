import type { ThreatId } from '../generated/ThreatId.js';

export interface TerminationReason {
  readonly threatId: ThreatId;
  readonly ts: number;
}

/**
 * Per ADR-0005: the only place in guardian-rn that terminates the process.
 * Inject a custom implementation in tests to assert termination without actually killing.
 */
export interface TerminatorPort {
  terminate(reason: TerminationReason): void;
}
