import { verifyEnvelope } from '../core/HmacEnvelope.js';
import { SequenceTracker } from '../core/SequenceTracker.js';
import type { GuardianEnvelope } from '../core/HmacEnvelope.js';
import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { Engine, EngineHealthTick } from '../engine/Engine.js';

export interface BusConfig {
  dedupWindowMs: number;
  rateCapPerSecond: number;
}

const DEFAULT_BUS_CONFIG: BusConfig = {
  dedupWindowMs: 100,
  rateCapPerSecond: 50,
};

export type ThreatHandler = (event: ThreatEvent) => void;
export type HealthHandler = (tick: EngineHealthTick) => void;
export type FaultHandler = (engineId: string, error: Error) => void;

/**
 * Merges all engine onThreat streams, applies HMAC verification,
 * sequence tracking, deduplication, and rate-capping per ADR-0004.
 */
export class EventBus {
  private readonly config: BusConfig;
  private readonly sessionKey: Uint8Array;
  private readonly tracker: SequenceTracker;

  private threatHandlers = new Set<ThreatHandler>();
  private healthHandlers = new Set<HealthHandler>();
  private faultHandlers = new Set<FaultHandler>();

  // Dedup: threatId → timestamp of last forward
  private readonly dedupMap = new Map<string, number>();
  // Rate cap: engineId → { count, windowStart }
  private readonly rateMap = new Map<string, { count: number; windowStart: number }>();

  private droppedCount = 0;

  constructor(sessionKey: Uint8Array, sessionId: string, config?: Partial<BusConfig>) {
    this.sessionKey = sessionKey;
    this.tracker = new SequenceTracker(sessionId);
    this.config = { ...DEFAULT_BUS_CONFIG, ...config };
  }

  /** Attach an engine: subscribes to its onThreat and onHealthTick streams. */
  attachEngine(engine: Engine): () => void {
    const threatSub = engine.onThreat.subscribe({
      next: (event) => this.routeThreat(event, engine.id),
      error: (err) => this.routeFault(engine.id, err instanceof Error ? err : new Error(String(err))),
    });

    const healthSub = engine.onHealthTick.subscribe({
      next: (tick) => this.routeHealth(tick),
    });

    return () => {
      threatSub.unsubscribe();
      healthSub.unsubscribe();
    };
  }

  /**
   * Process a raw HMAC envelope from the native bridge.
   * Called by the JSI subscription path.
   */
  processEnvelope(envelope: GuardianEnvelope, engineId: string): void {
    const result = verifyEnvelope(envelope, this.sessionKey);
    if (!result.ok) {
      this.routeFault(engineId, new Error(`HMAC_MISMATCH — seq ${envelope.seq}`));
      return;
    }

    const seqResult = this.tracker.check(envelope.seq, envelope.sessionId);
    if (seqResult === 'replay' || seqResult === 'wrong_session') return;
    // 'gap' and 'rollover' are logged to telemetry but not dropped

    const event: ThreatEvent = {
      ...result.payload,
      engineId,
    };
    this.routeThreat(event, engineId);
  }

  onThreat(handler: ThreatHandler): () => void {
    this.threatHandlers.add(handler);
    return () => this.threatHandlers.delete(handler);
  }

  onHealth(handler: HealthHandler): () => void {
    this.healthHandlers.add(handler);
    return () => this.healthHandlers.delete(handler);
  }

  onFault(handler: FaultHandler): () => void {
    this.faultHandlers.add(handler);
    return () => this.faultHandlers.delete(handler);
  }

  get dropped(): number {
    return this.droppedCount;
  }

  // ── private routing ──────────────────────────────────────────────────────

  private routeThreat(event: ThreatEvent, engineId: string): void {
    if (this.isRateCapped(engineId)) {
      this.droppedCount++;
      return;
    }
    if (this.isDuplicate(event.threatId)) return;

    this.markSeen(event.threatId);
    this.threatHandlers.forEach((h) => h(event));
  }

  private routeHealth(tick: EngineHealthTick): void {
    this.healthHandlers.forEach((h) => h(tick));
  }

  private routeFault(engineId: string, error: Error): void {
    this.faultHandlers.forEach((h) => h(engineId, error));
  }

  private isDuplicate(threatId: string): boolean {
    const last = this.dedupMap.get(threatId);
    if (last !== undefined && Date.now() - last < this.config.dedupWindowMs) {
      return true;
    }
    return false;
  }

  private markSeen(threatId: string): void {
    this.dedupMap.set(threatId, Date.now());
  }

  private isRateCapped(engineId: string): boolean {
    const now = Date.now();
    const state = this.rateMap.get(engineId) ?? { count: 0, windowStart: now };

    if (now - state.windowStart >= 1000) {
      state.count = 1;
      state.windowStart = now;
      this.rateMap.set(engineId, state);
      return false;
    }

    state.count++;
    this.rateMap.set(engineId, state);
    return state.count > this.config.rateCapPerSecond;
  }
}
