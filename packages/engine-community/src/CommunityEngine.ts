import type { Engine, EngineContext, EngineHealthTick } from '@guardian/rn/src/engine/Engine.js';
import type { ThreatEvent } from '@guardian/rn/src/events/ThreatEvent.js';
import type { Observable, Observer, Subscription } from '@guardian/rn/src/types/Observable.js';
import type { Detector } from './detectors/Detector.js';
import { RootDetector } from './detectors/RootDetector.js';
import { DebuggerDetector } from './detectors/DebuggerDetector.js';
import { EmulatorDetector } from './detectors/EmulatorDetector.js';
import { HookDetector } from './detectors/HookDetector.js';
import { JailbreakDetector } from './detectors/JailbreakDetector.js';
import { SimulatorDetector } from './detectors/SimulatorDetector.js';
import { InstallationSourceDetector } from './detectors/InstallationSourceDetector.js';
import { PasscodeMissingDetector } from './detectors/PasscodeMissingDetector.js';
import { BiometricMissingDetector } from './detectors/BiometricMissingDetector.js';
import { ManagedProfileDetector } from './detectors/ManagedProfileDetector.js';

const ENGINE_ID = 'community@1.0.0';
const POLL_INTERVAL_FOREGROUND_MS = 30_000;
const POLL_INTERVAL_BACKGROUND_MS = 120_000;
const HEALTH_INTERVAL_MS = 30_000;
const CONFIDENCE_THRESHOLD = 0.5;

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

export class CommunityEngine implements Engine {
  readonly id = ENGINE_ID;

  private readonly threatSubject = new SimpleSubject<ThreatEvent>();
  private readonly healthSubject = new SimpleSubject<EngineHealthTick>();
  readonly onThreat: Observable<ThreatEvent> = this.threatSubject;
  readonly onHealthTick: Observable<EngineHealthTick> = this.healthSubject;

  private context: EngineContext | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private pollIntervalMs = POLL_INTERVAL_FOREGROUND_MS;

  private readonly detectors: readonly Detector[];

  /** Per-detector timing for health ticks. */
  private lastRunMs = new Map<string, number>();
  private lastConfidence = new Map<string, number>();

  constructor(detectors?: readonly Detector[]) {
    this.detectors = detectors ?? [
      new RootDetector(),
      new JailbreakDetector(),
      new DebuggerDetector(),
      new EmulatorDetector(),
      new SimulatorDetector(),
      new HookDetector(),
      new InstallationSourceDetector(),
      new PasscodeMissingDetector(),
      new BiometricMissingDetector(),
      new ManagedProfileDetector(),
    ];
  }

  async start(context: EngineContext): Promise<void> {
    if (this.running) return;
    this.context = context;
    this.running = true;

    await this.runScan();
    this.schedulePoll();

    this.healthTimer = setInterval(() => this.emitHealthTick(), HEALTH_INTERVAL_MS);
    this.emitHealthTick();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    this.context = null;
  }

  /**
   * Battery-aware scan throttle. Background mode quadruples the scan interval
   * to reduce CPU wake-ups while preserving liveness guarantees.
   */
  throttle(mode: 'foreground' | 'background'): void {
    const newInterval =
      mode === 'background' ? POLL_INTERVAL_BACKGROUND_MS : POLL_INTERVAL_FOREGROUND_MS;
    if (newInterval === this.pollIntervalMs) return;
    this.pollIntervalMs = newInterval;
    if (this.running) {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.schedulePoll();
    }
  }

  // ── private ──────────────────────────────────────────────────────────────

  private schedulePoll(): void {
    this.pollTimer = setInterval(
      () => { void this.runScan(); },
      this.pollIntervalMs,
    );
  }

  private async runScan(): Promise<void> {
    if (!this.running) return;
    const results = await Promise.allSettled(
      this.detectors.map(async (d) => {
        const start = Date.now();
        const r = await d.run();
        this.lastRunMs.set(d.threatId, Date.now() - start);
        this.lastConfidence.set(d.threatId, r.confidence);
        return { d, r };
      }),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        this.context?.onFault(
          result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        );
        continue;
      }
      const { d, r } = result.value;
      if (r.detected && r.confidence >= CONFIDENCE_THRESHOLD) {
        this.threatSubject.emit({
          threatId: d.threatId,
          severity: d.severity,
          confidence: r.confidence,
          evidence: r.evidence,
          ts: Date.now(),
          engineId: ENGINE_ID,
        });
      }
    }
  }

  private emitHealthTick(): void {
    const tick: EngineHealthTick = {
      engineId: ENGINE_ID,
      ts: Date.now(),
      sessionId: this.context?.sessionId ?? '',
      status: 'ok',
      activeChecks: this.detectors.map((d) => d.threatId),
      detectorResults: this.detectors.map((d) => ({
        detectorId: d.threatId,
        lastRunMs: this.lastRunMs.get(d.threatId) ?? 0,
        lastConfidence: this.lastConfidence.get(d.threatId) ?? 0,
        status: 'ok' as const,
      })),
    };
    this.healthSubject.emit(tick);
  }
}
