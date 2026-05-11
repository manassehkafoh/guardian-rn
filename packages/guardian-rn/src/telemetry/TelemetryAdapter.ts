import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { EngineHealthTick } from '../engine/Engine.js';

/**
 * Closure that HMAC-signs an arbitrary string payload using the session key.
 * The adapter receives the signature capability without ever holding key material.
 * Per ADR-0014.
 */
export type SignPayload = (data: string) => string;

export interface TelemetryAdapter {
  /**
   * Record a threat event. The signPayload closure lets the adapter attach an
   * HMAC signature to the outbound payload without accessing the raw session key.
   */
  recordThreat(event: ThreatEvent, signPayload: SignPayload): void;
  recordHealthTick(tick: EngineHealthTick): void;
  flush(): Promise<void>;
}
