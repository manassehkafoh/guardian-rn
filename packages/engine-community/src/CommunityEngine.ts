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

const ENGINE_ID = 'community@1.0.0';
const POLL_INTERVAL_MS = 30_000;
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

  private readonly detectors: readonly Detector[];

  constructor(detectors?: readonly Detector[]) {
    this.detectors = detectors ?? [
      new RootDetector(),
      new JailbreakDetector(),
      new DebuggerDetector(),
      new EmulatorDetector(),
      new SimulatorDetector(),
      new HookDetector(),
    ];
  }

  async start(context: EngineContext): Promise<void> {
    if (this.running) return;
    this.context = context;
    this.running = true;

    // Initial scan
    await this.runScan();

    this.pollTimer = setInterval(() => { void this.runScan(); }, POLL_INTERVAL_MS);
    this.healthTimer = setInterval(() => {
      this.healthSubject.emit({
        engineId: ENGINE_ID,
        ts: Date.now(),
        activeChecks: this.detectors.map((d) => d.threatId),
      });
    }, HEALTH_INTERVAL_MS);

    // Emit first health tick immediately
    this.healthSubject.emit({
      engineId: ENGINE_ID,
      ts: Date.now(),
      activeChecks: this.detectors.map((d) => d.threatId),
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    this.context = null;
  }

  private async runScan(): Promise<void> {
    if (!this.running) return;
    const results = await Promise.allSettled(this.detectors.map((d) => d.run().then((r) => ({ d, r }))));
    for (const result of results) {
      if (result.status === 'rejected') {
        this.context?.onFault(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
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
}
