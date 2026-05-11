import type { Engine, EngineContext, EngineHealthTick } from '@guardian/rn/src/engine/Engine.js';
import type { ThreatEvent } from '@guardian/rn/src/events/ThreatEvent.js';
import type { Observable, Observer, Subscription } from '@guardian/rn/src/types/Observable.js';

const ENGINE_ID = 'community-behavioral@1.0.0';
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_ANOMALY_THRESHOLD = 5;
const HEALTH_INTERVAL_MS = 30_000;

class SimpleSubject<T> implements Observable<T> {
  private readonly observers = new Set<Observer<T>>();
  subscribe(observer: Observer<T>): Subscription {
    this.observers.add(observer);
    return { unsubscribe: () => this.observers.delete(observer) };
  }
  emit(value: T): void {
    for (const obs of this.observers) obs.next(value);
  }
}

export interface BehavioralBaselineConfig {
  /** Rolling window for counting distinct threat events. Default: 60_000 ms. */
  readonly windowMs?: number;
  /**
   * Number of distinct threats within the window that triggers a
   * behavioralAnomaly event. Default: 5.
   */
  readonly anomalyThreshold?: number;
}

/**
 * Implements the dynamic behavioral baseline detector (ADR-0016).
 *
 * This component implements the Engine interface rather than the Detector
 * interface because it must observe the live threat stream to compute its
 * rolling frequency baseline. It registers via `GuardianConfig.engines`
 * alongside CommunityEngine.
 *
 * When the number of distinct threat events within the rolling window
 * exceeds the anomaly threshold, it emits a `behavioralAnomaly` event.
 * This catches adversarial patterns that trigger many detectors in quick
 * succession — a signature of automated attack tooling.
 */
export class BehavioralBaselineEngine implements Engine {
  readonly id = ENGINE_ID;

  private readonly threatSubject = new SimpleSubject<ThreatEvent>();
  private readonly healthSubject = new SimpleSubject<EngineHealthTick>();
  readonly onThreat: Observable<ThreatEvent> = this.threatSubject;
  readonly onHealthTick: Observable<EngineHealthTick> = this.healthSubject;

  private readonly windowMs: number;
  private readonly anomalyThreshold: number;
  private eventTimestamps: number[] = [];
  private running = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private context: EngineContext | null = null;

  /** Injected subscription to another engine's onThreat stream. */
  private upstreamSub: Subscription | null = null;

  constructor(cfg: BehavioralBaselineConfig = {}) {
    this.windowMs = cfg.windowMs ?? DEFAULT_WINDOW_MS;
    this.anomalyThreshold = cfg.anomalyThreshold ?? DEFAULT_ANOMALY_THRESHOLD;
  }

  /**
   * Wires up this engine to observe `sourceEngine`'s threat stream.
   * Call this before `start()` — typically done by the host app after
   * constructing both CommunityEngine and BehavioralBaselineEngine.
   */
  observeEngine(sourceEngine: { onThreat: Observable<ThreatEvent> }): void {
    this.upstreamSub?.unsubscribe();
    this.upstreamSub = sourceEngine.onThreat.subscribe({
      next: (event) => this.record(event),
    });
  }

  async start(context: EngineContext): Promise<void> {
    if (this.running) return;
    this.context = context;
    this.running = true;

    this.healthTimer = setInterval(() => this.emitHealthTick(), HEALTH_INTERVAL_MS);
    this.emitHealthTick();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.upstreamSub?.unsubscribe();
    this.upstreamSub = null;
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    this.context = null;
  }

  /** Visible for testing. */
  get windowEventCount(): number {
    this.prune(Date.now());
    return this.eventTimestamps.length;
  }

  // ── private ──────────────────────────────────────────────────────────────

  private record(event: ThreatEvent): void {
    if (!this.running) return;
    const now = event.ts ?? Date.now();
    this.eventTimestamps.push(now);
    this.prune(now);

    if (this.eventTimestamps.length >= this.anomalyThreshold) {
      this.threatSubject.emit({
        threatId: 'behavioralAnomaly',
        severity: 'high',
        confidence: Math.min(1.0, this.eventTimestamps.length / this.anomalyThreshold),
        evidence: {
          windowMs: String(this.windowMs),
          eventCount: String(this.eventTimestamps.length),
          threshold: String(this.anomalyThreshold),
          triggeredBy: event.threatId,
        },
        ts: now,
        engineId: ENGINE_ID,
      });
    }
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.eventTimestamps = this.eventTimestamps.filter((t) => t >= cutoff);
  }

  private emitHealthTick(): void {
    this.healthSubject.emit({
      engineId: ENGINE_ID,
      ts: Date.now(),
      sessionId: this.context?.sessionId ?? '',
      status: 'ok',
    });
  }
}
